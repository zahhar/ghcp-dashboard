const http = require('http');
const fs = require('fs');
const readline = require('readline');
const path = require('path');

// ── Load .env ───────────────────────────────────────────────────────────
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf('=');
        if (idx > 0) {
            process.env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
        }
    }
}

// Set USE_MOCK_DATA=true in .env to serve data from /mock instead of /data (useful for local UI dev)
const USE_MOCK_DATA = process.env.USE_MOCK_DATA === 'true';
// Root directory for all data files — switches between live data and mock data automatically
const DATA_ROOT = USE_MOCK_DATA ? path.join(__dirname, 'mock') : path.join(__dirname, 'data');

if (USE_MOCK_DATA) {
    console.log('⚠️  Mock mode enabled — loading data from /mock');
}

// HTTP port the dashboard server listens on
const PORT = 8080;
// Path to the main NDJSON data file containing one user×day record per line
const DATA_FILE = path.join(DATA_ROOT, 'data.json');
// Directory that contains static frontend assets (HTML, JS, CSS)
const PUBLIC_DIR = path.join(__dirname, 'public');
// Value for the Access-Control-Allow-Origin header; restrict to a specific domain in production
const CORS_ORIGIN = '*';

// Helper to handle static files
const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
};

// Source: https://github.com/microsoft/vscode-docs/blob/main/docs/languages/identifiers.md
// Languages treated as documentation/steering (Markdown, prompts, etc.) rather than code;
// LOC for these is counted separately as doc_loc instead of code_loc
const documentingLanguages = ['markdown', 'text', 'prompt', 'instructions', 'mermaid', 'plaintext', 'bibtex', 'snippets', 'latex', 'restructuredtext', 'search-result', 'skill', 'tex', 'chatagent'];

function serveStaticFile(req, res) {
    let filePath = path.join(PUBLIC_DIR, req.url === '/' ? 'index.html' : req.url);
    const extname = String(path.extname(filePath)).toLowerCase();
    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code == 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/html' });
                res.end('<h1>404 Not Found</h1>', 'utf-8');
            } else {
                res.writeHead(500);
                res.end('Sorry, check with the site admin for error: ' + error.code + ' ..\n');
            }
        } else {
            const headers = { 'Content-Type': contentType };
            if (extname === '.js' || extname === '.css') {
                headers['Cache-Control'] = 'no-store';
            }
            res.writeHead(200, headers);
            res.end(content, 'utf-8');
        }
    });
}

// Path to the JSON file mapping GitHub logins to display names, teams, and revoked status
const USERS_FILE = path.join(DATA_ROOT, 'users.json');

let cachedParsedData = null;

// Process data on the fly
// dayLimit: if set, only include days of the month whose day-of-month number is <= dayLimit
async function getAggregatedData(monthFilter = null, dayLimit = null) {
    let userMapping = {};
    try {
        if (fs.existsSync(USERS_FILE)) {
            userMapping = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('Failed to read users.json:', e);
    }

    // Load enterprise / organization label maps from config.json
    let config = {};
    try {
        const cfgPath = path.join(DATA_ROOT, 'config.json');
        if (fs.existsSync(cfgPath)) config = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    } catch (e) { /* ignore — labels will fall back to raw IDs */ }
    const enterpriseLabelMap = {};
    const orgLabelMap = {};
    if (Array.isArray(config.enterprises)) {
        for (const e of config.enterprises) {
            if (e.id != null) enterpriseLabelMap[String(e.id)] = e.label || String(e.id);
            if (Array.isArray(e.organizations)) {
                for (const o of e.organizations) {
                    if (o.id != null) orgLabelMap[String(o.id)] = o.label || String(o.id);
                }
            }
        }
    }

    const userStats = {};
    const availableMonths = new Set();

    if (!cachedParsedData) {
        let parsedData = [];
        try {
            const fileContent = fs.readFileSync(DATA_FILE, 'utf8');
            try {
                parsedData = JSON.parse(fileContent);
            } catch (e1) {
                try {
                    // If the user formatted NDJSON into pretty-printed consecutive objects
                    const modified = '[' + fileContent.replace(/\}\s*\{/g, '},{') + ']';
                    parsedData = JSON.parse(modified);
                } catch (e2) {
                    // Fallback for strict NDJSON line-by-line mapping
                    parsedData = fileContent.split('\n').filter(l => l.trim()).map(line => {
                        try { return JSON.parse(line); } catch (e) { return null; }
                    }).filter(Boolean);
                }
            }
            if (!Array.isArray(parsedData)) parsedData = [parsedData];

            // Deduplicate: same user_id + day + organization_id + enterprise_id may appear
            // across multiple report windows (different report_start_day/report_end_day).
            // Keep only the first occurrence of each logical key.
            const seen = new Set();
            parsedData = parsedData.filter(entry => {
                if (entry.user_login) entry.user_login = entry.user_login.toLowerCase();
                const key = `${entry.user_login}|${entry.day}|${entry.organization_id}|${entry.enterprise_id}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });

            cachedParsedData = parsedData;
        } catch (e) {
            console.error('Failed to load data.json', e);
            cachedParsedData = [];
        }
    }

    for (const entry of cachedParsedData) {
        try {
            if (entry.day) {
                const month = entry.day.substring(0, 7); // 'YYYY-MM'
                availableMonths.add(month);
                if (monthFilter && month !== monthFilter) continue;
                // When a day-of-month cap is specified, skip days beyond it
                if (dayLimit !== null) {
                    const dom = parseInt(entry.day.slice(8, 10), 10);
                    if (dom > dayLimit) continue;
                }
            }

            const user = entry.user_login || 'unknown';

            if (!userStats[user]) {
                userStats[user] = {
                    user_login: user,
                    loc_added_sum: 0,
                    loc_deleted_sum: 0,
                    loc_suggested_to_add_sum: 0,
                    loc_suggested_to_delete_sum: 0,
                    doc_loc_added_sum: 0,
                    doc_loc_deleted_sum: 0,
                    user_initiated_interaction_count: 0,
                    code_generation_activity_count: 0,
                    code_acceptance_activity_count: 0,
                    cli_prompt_count: 0,
                    active_days: new Set(),
                    agent_days: new Set(),
                    chat_days: new Set(),
                    cli_days: new Set(),
                    last_active_day: '',
                    last_ide_name: null,
                    last_plugin: null,
                    last_plugin_version: null,
                    last_ide_version: null,
                    models: {},
                    ides: {},
                    languages: {},
                    features: {},
                    doc_languages: new Set(),
                    enterprise_ids: new Set(),
                    organization_ids: new Set(),
                    code_loc_from_models: 0,
                    daily: {},
                    allLocByModel: {},
                    allLocByLanguage: {},
                    ideVersions: {},  // { [ide_name]: { last_seen_day, ide_version, plugin, plugin_version } }
                    cli_version_info: null,  // { last_seen_day, cli_version }
                };
            }

            const stats = userStats[user];
            stats.user_initiated_interaction_count += (entry.user_initiated_interaction_count || 0);
            if (entry.enterprise_id != null) stats.enterprise_ids.add(String(entry.enterprise_id));
            if (entry.organization_id != null) stats.organization_ids.add(String(entry.organization_id));
            stats.code_generation_activity_count += (entry.code_generation_activity_count || 0);
            stats.code_acceptance_activity_count += (entry.code_acceptance_activity_count || 0);
            stats.cli_prompt_count += (entry.totals_by_cli?.prompt_count || 0);
            if (entry.day && entry.totals_by_cli?.last_known_cli_version?.cli_version) {
                const cv = entry.totals_by_cli.last_known_cli_version.cli_version;
                if (!stats.cli_version_info || entry.day >= stats.cli_version_info.last_seen_day) {
                    stats.cli_version_info = { last_seen_day: entry.day, cli_version: cv };
                }
            }

            if (entry.day) {
                if (!stats.daily[entry.day]) {
                    stats.daily[entry.day] = { user_initiated: 0, code_generation: 0, code_loc: 0, doc_loc: 0, cli_turns: 0 };
                }
                stats.daily[entry.day].user_initiated += (entry.user_initiated_interaction_count || 0);
                stats.daily[entry.day].code_generation += (entry.code_generation_activity_count || 0);
                stats.daily[entry.day].cli_turns += (entry.totals_by_cli?.prompt_count || 0);
            }

            stats.loc_added_sum += (entry.loc_added_sum || 0);
            stats.loc_deleted_sum += (entry.loc_deleted_sum || 0);
            stats.loc_suggested_to_add_sum += (entry.loc_suggested_to_add_sum || 0);
            stats.loc_suggested_to_delete_sum += (entry.loc_suggested_to_delete_sum || 0);

            if (Array.isArray(entry.totals_by_language_feature)) {
                let entryDocLoc = 0, entryTotalLoc = 0;
                for (const lf of entry.totals_by_language_feature) {
                    const lang = (lf.language || 'unknown').toLowerCase();
                    const lfLoc = (lf.loc_added_sum || 0) + (lf.loc_deleted_sum || 0);
                    if (documentingLanguages.includes(lang)) {
                        stats.doc_loc_added_sum += (lf.loc_added_sum || 0);
                        stats.doc_loc_deleted_sum += (lf.loc_deleted_sum || 0);
                        if (lfLoc > 0) stats.doc_languages.add(lf.language);
                        entryDocLoc += lfLoc;
                    }
                    if (lfLoc > 0) stats.allLocByLanguage[lf.language || 'unknown'] = (stats.allLocByLanguage[lf.language || 'unknown'] || 0) + lfLoc;
                    entryTotalLoc += lfLoc;
                }
                if (entry.day && stats.daily[entry.day]) {
                    stats.daily[entry.day].doc_loc += entryDocLoc;
                    stats.daily[entry.day].code_loc += entryTotalLoc - entryDocLoc;
                }
            }

            if (entry.day) {
                stats.active_days.add(entry.day);
                if (!stats.last_active_day || entry.day > stats.last_active_day) {
                    stats.last_active_day = entry.day;
                    if (Array.isArray(entry.totals_by_ide) && entry.totals_by_ide.length > 0) {
                        const bestIde = entry.totals_by_ide.reduce((best, ide) => {
                            const loc = (ide.loc_added_sum || 0) + (ide.loc_deleted_sum || 0);
                            const bestLoc = (best.loc_added_sum || 0) + (best.loc_deleted_sum || 0);
                            return loc > bestLoc ? ide : best;
                        });
                        stats.last_ide_name = bestIde.ide || null;
                        stats.last_plugin = bestIde.last_known_plugin_version?.plugin || null;
                        stats.last_plugin_version = bestIde.last_known_plugin_version?.plugin_version || null;
                        stats.last_ide_version = bestIde.last_known_ide_version?.ide_version || null;
                    }
                }
                if (entry.used_agent || entry.used_copilot_coding_agent) stats.agent_days.add(entry.day);
                if (entry.used_chat) stats.chat_days.add(entry.day);
                if (entry.used_cli) stats.cli_days.add(entry.day);
            }

            if (Array.isArray(entry.totals_by_language_model)) {
                for (const tm of entry.totals_by_language_model) {
                    const lang = (tm.language || 'unknown').toLowerCase();
                    
                    // Track total activity: suggested + accepted LOC for ALL languages (including doc langs)
                    const acceptedLoc = (tm.loc_added_sum || 0) + (tm.loc_deleted_sum || 0);
                    const suggestedLoc = (tm.loc_suggested_to_add_sum || 0) + (tm.loc_suggested_to_delete_sum || 0);
                    const totalActivity = acceptedLoc + suggestedLoc;
                    
                    // Track in comprehensive maps (used for donut charts and now also for favorites)
                    if (tm.model && totalActivity > 0) {
                        stats.allLocByModel[tm.model] = (stats.allLocByModel[tm.model] || 0) + totalActivity;
                        stats.models[tm.model] = (stats.models[tm.model] || 0) + totalActivity;
                    }
                    if (tm.language && totalActivity > 0) {
                        stats.allLocByLanguage[tm.language] = (stats.allLocByLanguage[tm.language] || 0) + totalActivity;
                        stats.languages[tm.language] = (stats.languages[tm.language] || 0) + totalActivity;
                    }
                    
                    // Track coding LOC separately for aggregate metrics (exclude doc langs from code_loc_from_models)
                    if (!documentingLanguages.includes(lang)) {
                        stats.code_loc_from_models += acceptedLoc;
                    }
                }
            }

            // Fallback: If totals_by_language_model is empty (e.g., Visual Studio code completion),
            // extract language data from totals_by_language_feature to ensure we track language usage
            if (Array.isArray(entry.totals_by_language_model) && entry.totals_by_language_model.length === 0) {
                if (Array.isArray(entry.totals_by_language_feature)) {
                    for (const lf of entry.totals_by_language_feature) {
                        const lang = (lf.language || 'unknown').toLowerCase();
                        const acceptedLoc = (lf.loc_added_sum || 0) + (lf.loc_deleted_sum || 0);
                        const suggestedLoc = (lf.loc_suggested_to_add_sum || 0) + (lf.loc_suggested_to_delete_sum || 0);
                        const totalActivity = acceptedLoc + suggestedLoc;
                        
                        if (lf.language && totalActivity > 0) {
                            stats.languages[lf.language] = (stats.languages[lf.language] || 0) + totalActivity;
                        }
                        
                        // Track coding LOC for metrics (exclude doc langs)
                        if (!documentingLanguages.includes(lang)) {
                            stats.code_loc_from_models += acceptedLoc;
                        }
                    }
                }
            }

            if (Array.isArray(entry.totals_by_ide)) {
                for (const ti of entry.totals_by_ide) {
                    // IDE LOC is not broken down by language in data.json
                    if (ti.ide) {
                        // Track IDE based on any activity (suggested + accepted)
                        const acceptedLoc = (ti.loc_added_sum || 0) + (ti.loc_deleted_sum || 0);
                        const suggestedLoc = (ti.loc_suggested_to_add_sum || 0) + (ti.loc_suggested_to_delete_sum || 0);
                        const totalActivity = acceptedLoc + suggestedLoc;
                        if (totalActivity > 0) {
                            stats.ides[ti.ide] = (stats.ides[ti.ide] || 0) + totalActivity;
                        }
                        // Keep the latest known version info for this IDE (by most recent day)
                        if (entry.day && (!stats.ideVersions[ti.ide] || entry.day >= stats.ideVersions[ti.ide].last_seen_day)) {
                            stats.ideVersions[ti.ide] = {
                                last_seen_day: entry.day,
                                ide_version: ti.last_known_ide_version?.ide_version || null,
                                plugin: ti.last_known_plugin_version?.plugin || null,
                                plugin_version: ti.last_known_plugin_version?.plugin_version || null
                            };
                        }
                    }
                }
            }

            if (Array.isArray(entry.totals_by_feature)) {
                for (const tf of entry.totals_by_feature) {
                    if (!tf.feature) continue;
                    const fLoc = (tf.loc_suggested_to_add_sum || 0) + (tf.loc_suggested_to_delete_sum || 0)
                               + (tf.loc_added_sum || 0) + (tf.loc_deleted_sum || 0);
                    // When a feature produces no LOC output (e.g. chat_panel_plan_mode finishing
                    // with 0 suggestions, or chat_panel_unknown_mode), fall back to interaction
                    // counts so the feature still appears in the breakdown.
                    // Using the fallback only when fLoc=0 prevents double-accounting LOC.
                    const fValue = fLoc > 0 ? fLoc
                                 : (tf.user_initiated_interaction_count || 0)
                                   + (tf.code_generation_activity_count || 0)
                                   + (tf.code_acceptance_activity_count || 0);
                    if (fValue > 0) {
                        stats.features[tf.feature] = (stats.features[tf.feature] || 0) + fValue;
                    }
                }
            }

        } catch (e) {
            console.error('Failed to process entry:', e);
        }
    }

    let totalOrgLocChanged = 0;

    // Convert to array and finalize metrics
    const results = Object.values(userStats).map(user => {
        const generationRatio = user.code_generation_activity_count > 0
            ? user.code_acceptance_activity_count / user.code_generation_activity_count
            : 0;

        const totalLocAdded = user.loc_added_sum;
        const totalLocDeleted = user.loc_deleted_sum;
        const totalLocChanged = totalLocAdded + totalLocDeleted;

        const docLocAdded = user.doc_loc_added_sum;
        const docLocDeleted = user.doc_loc_deleted_sum;
        const docLocChanged = docLocAdded + docLocDeleted;

        const codeLocAdded = totalLocAdded - docLocAdded;
        const codeLocDeleted = totalLocDeleted - docLocDeleted;
        const codeLocChanged = totalLocChanged - docLocChanged;

        totalOrgLocChanged += totalLocChanged;

        let favModel = 'None';
        let favModelLoc = 0;
        for (const [m, loc] of Object.entries(user.models)) {
            if (loc > favModelLoc) {
                favModelLoc = loc;
                favModel = m;
            }
        }
        // Calculate percentage based on total activity (suggested + accepted) across ALL models
        const totalModelActivity = Object.values(user.models).reduce((sum, loc) => sum + loc, 0);
        const favModelPct = totalModelActivity > 0 ? Math.round((favModelLoc / totalModelActivity) * 100) + '%' : '0%';

        let favIde = 'None';
        let favIdeLoc = 0;
        for (const [i, loc] of Object.entries(user.ides)) {
            if (loc > favIdeLoc) {
                favIdeLoc = loc;
                favIde = i;
            }
        }
        // Calculate percentage based on total activity (suggested + accepted) across ALL IDEs
        const totalIdeActivity = Object.values(user.ides).reduce((sum, loc) => sum + loc, 0);
        const favIdePct = totalIdeActivity > 0 ? Math.round((favIdeLoc / totalIdeActivity) * 100) + '%' : '0%';

        let favLanguage = 'None';
        let favLanguageLoc = 0;

        for (const [l, loc] of Object.entries(user.languages)) {
            if (loc > favLanguageLoc) {
                favLanguageLoc = loc;
                favLanguage = l;
            }
        }
        // Calculate percentage based on total activity (suggested + accepted) across ALL languages
        const totalLangActivity = Object.values(user.languages).reduce((sum, loc) => sum + loc, 0);
        const favLanguagePct = totalLangActivity > 0 ? Math.round((favLanguageLoc / totalLangActivity) * 100) + '%' : '0%';

        // Map human name and revoked
        const mapping = userMapping[user.user_login] || {};
        const humanName = mapping.name || user.user_login;
        const isRevoked = mapping.revoked === true;
        const userTeam = mapping.team || '';
        const userRole = mapping.role || '';

        const enterpriseIds = [...user.enterprise_ids];
        const organizationIds = [...user.organization_ids];
        const enterpriseLabel = enterpriseIds.map(id => enterpriseLabelMap[id] || id).join(', ');
        const organizationLabel = organizationIds.map(id => orgLabelMap[id] || id).join(', ');

        return {
            ...user,
            human_name: humanName,
            revoked: isRevoked,
            team: userTeam,
            role: userRole,
            enterprise_ids: enterpriseIds,
            organization_ids: organizationIds,
            enterprise_label: enterpriseLabel,
            organization_label: organizationLabel,
            total_loc_changed: totalLocChanged,
            total_loc_added: totalLocAdded,
            total_loc_deleted: totalLocDeleted,
            total_suggested_changed: user.loc_suggested_to_add_sum + user.loc_suggested_to_delete_sum,
            doc_loc_changed: docLocChanged,
            doc_loc_added: docLocAdded,
            doc_loc_deleted: docLocDeleted,
            code_loc_changed: codeLocChanged,
            code_loc_added: codeLocAdded,
            code_loc_deleted: codeLocDeleted,
            active_days_count: user.active_days.size,
            agent_days_count: user.agent_days.size,
            chat_days_count: user.chat_days.size,
            cli_days_count: user.cli_days.size,
            turns: user.user_initiated_interaction_count + user.code_generation_activity_count + user.cli_prompt_count,
            acceptance_rate: Math.round(generationRatio * 100) + '%',
            avg_loc_added_daily: user.active_days.size > 0 ? Math.round(codeLocAdded / user.active_days.size) : 0,
            perf_score: user.active_days.size > 0 ? Math.round(Math.max(codeLocAdded, codeLocDeleted) / user.active_days.size) : 0,
            favorite_model: favModel !== 'None' ? `${favModel}<br><span style="font-size:0.8em;color:var(--text-muted)">${favModelPct}</span>` : '-',
            favorite_ide: favIde !== 'None' ? `${favIde}<br><span style="font-size:0.8em;color:var(--text-muted)">${favIdePct}</span>` : '-',
            favorite_language: favLanguage !== 'None' ? `${favLanguage}<br><span style="font-size:0.8em;color:var(--text-muted)">${favLanguagePct}</span>` : '-',
            active_days: undefined,
            agent_days: undefined,
            chat_days: undefined,
            cli_days: undefined,
            all_languages_list: Object.keys(user.languages).sort(),
            all_models_list: Object.keys(user.models).sort(),
            all_ides_list: Object.keys(user.ides).sort(),
            ide_versions: Object.fromEntries(
                Object.entries(user.ideVersions).map(([ide, v]) => [ide, {
                    ide_version: v.ide_version,
                    plugin: v.plugin,
                    plugin_version: v.plugin_version
                }])
            ),
            cli_version: user.cli_version_info?.cli_version || null,
            all_doc_languages_list: [...user.doc_languages].sort(),
            daily: Object.entries(user.daily)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([day, d]) => ({ day, user_initiated: d.user_initiated, code_generation: d.code_generation, cli_turns: d.cli_turns, code_loc: d.code_loc, doc_loc: d.doc_loc })),
            loc_by_model: user.allLocByModel,
            loc_by_language: user.allLocByLanguage,
            loc_by_code_language: Object.fromEntries(
                Object.entries(user.allLocByLanguage).filter(([l]) => !documentingLanguages.includes(l.toLowerCase()))
            ),
            loc_by_doc_language: Object.fromEntries(
                Object.entries(user.allLocByLanguage).filter(([l]) => documentingLanguages.includes(l.toLowerCase()))
            ),
            loc_by_feature: user.features,
            loc_by_ide: user.ides,
            models: undefined,
            ides: undefined,
            languages: undefined,
            features: undefined,
            doc_languages: undefined,
            allLocByModel: undefined,
            allLocByLanguage: undefined,
            ideVersions: undefined,
            cli_version_info: undefined
        };
    });

    const allUsers = [...results].sort((a, b) => b.code_loc_changed - a.code_loc_changed);

    // Append users from users.json who have no telemetry at all (never used Copilot)
    const activeLogins = new Set(results.map(u => u.user_login));
    for (const [login, mapping] of Object.entries(userMapping)) {
        if (activeLogins.has(login)) continue;
        // Skip if revoked — they never used it and aren't active anyway
        // (keep revoked-never-active if you want, but it adds noise; change condition to include them)
        allUsers.push({
            user_login: login,
            human_name: mapping.name || login,
            revoked: mapping.revoked === true,
            team: mapping.team || '',
            role: mapping.role || '',
            enterprise_ids: [],
            organization_ids: [],
            enterprise_label: '',
            organization_label: '',
            never_active: true,
            total_loc_changed: 0, total_loc_added: 0, total_loc_deleted: 0,
            total_suggested_changed: 0,
            doc_loc_changed: 0, doc_loc_added: 0, doc_loc_deleted: 0,
            code_loc_changed: 0, code_loc_added: 0, code_loc_deleted: 0,
            active_days_count: 0, agent_days_count: 0, chat_days_count: 0, cli_days_count: 0,
            turns: 0, acceptance_rate: '0%',
            avg_loc_added_daily: 0, perf_score: 0,
            favorite_model: '-', favorite_ide: '-', favorite_language: '-',
            last_active_day: '',
            all_languages_list: [], all_models_list: [], all_ides_list: [],
            ide_versions: {}, cli_version: null,
            all_doc_languages_list: [], daily: [],
            loc_by_model: {}, loc_by_language: {}, loc_by_code_language: {},
            loc_by_doc_language: {}, loc_by_feature: {}, loc_by_ide: {},
        });
    }

    // Sort available months nicely
    const orderedMonths = Array.from(availableMonths).sort();

    // Collect all languages seen across all users (already filtered of excluded langs)
    const allLanguages = [...new Set(
        Object.values(userStats).flatMap(u => Object.keys(u.languages))
    )].sort();

    // Collect available teams from user mapping
    const availableTeams = [...new Set(Object.values(userMapping).map(u => u.team).filter(Boolean))].sort();

    // Collect enterprises and organizations seen in actual data, with nested hierarchy
    const seenEnterpriseIds = [...new Set(results.flatMap(u => u.enterprise_ids))].sort();
    const seenOrgIds = new Set(results.flatMap(u => u.organization_ids));
    const availableEnterprises = seenEnterpriseIds.map(id => {
        const eCfg = (config.enterprises || []).find(e => String(e.id) === id);
        const orgs = (eCfg?.organizations || [])
            .map(o => ({ id: String(o.id), label: o.label || String(o.id) }))
            .filter(o => seenOrgIds.has(o.id));
        return { id, label: enterpriseLabelMap[id] || id, organizations: orgs };
    });

    return {
        users: allUsers,
        totalUsers: results.length,
        totalInteractions: results.reduce((acc, user) => acc + user.turns, 0),
        totalOrgLocChanged: totalOrgLocChanged,
        availableMonths: orderedMonths,
        availableTeams,
        availableEnterprises,
        allLanguages
    };
}

const server = http.createServer(async (req, res) => {
    // Basic CORS
    res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);

    if (req.url.startsWith('/api/stats') && req.method === 'GET') {
        try {
            const urlObj = new URL(req.url, `http://${req.headers.host}`);
            const monthFilter = urlObj.searchParams.get('month');

            const data = await getAggregatedData(monthFilter);

            // If a month is selected, also compute previous month for comparison
            if (monthFilter) {
                const [yyyy, mm] = monthFilter.split('-').map(Number);
                const prevDate = new Date(yyyy, mm - 2, 1);
                const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
                if (data.availableMonths && data.availableMonths.includes(prevMonth)) {
                    // Determine how many days of the current month we have data for,
                    // then cap the previous month to the same day-of-month for a fair comparison.
                    let prevDayLimit = null;
                    try {
                        const cfg = JSON.parse(fs.readFileSync(path.join(DATA_ROOT, 'config.json'), 'utf8'));
                        // Find the max last_report_day across all configured organizations
                        let cfgLastReportDay = null;
                        for (const ent of (cfg.enterprises || [])) {
                            for (const org of (ent.organizations || [])) {
                                if (org.last_report_day && (!cfgLastReportDay || org.last_report_day > cfgLastReportDay)) {
                                    cfgLastReportDay = org.last_report_day;
                                }
                            }
                        }
                        if (cfgLastReportDay) {
                            const lastDay = cfgLastReportDay; // YYYY-MM-DD
                            const lastDayMonth = lastDay.substring(0, 7);
                            if (lastDayMonth === monthFilter) {
                                // Current month is incomplete — cap prev month to same day-of-month
                                const currentDom = parseInt(lastDay.slice(8, 10), 10);
                                // Days in previous month
                                const daysInPrevMonth = new Date(prevDate.getFullYear(), prevDate.getMonth() + 1, 0).getDate();
                                // Only cap if the current month's last day is within prev month's range
                                if (currentDom < daysInPrevMonth) {
                                    prevDayLimit = currentDom;
                                }
                                // else: current dom >= days in prev month → use full prev month (prevDayLimit stays null)
                            }
                            // If monthFilter is a past complete month, no cap needed (prevDayLimit stays null)
                        }
                    } catch (e) { /* config read failure — compare full months */ }
                    const prevData = await getAggregatedData(prevMonth, prevDayLimit);
                    const prevMap = {};
                    for (const u of prevData.users) {
                        prevMap[u.user_login] = {
                            total_loc_changed: u.total_loc_changed,
                            code_loc_changed: u.code_loc_changed,
                            avg_loc_added_daily: u.avg_loc_added_daily,
                            perf_score: u.perf_score,
                            doc_loc_changed: u.doc_loc_changed,
                            config_loc_changed: u.config_loc_changed,
                            turns: u.turns,
                            active_days_count: u.active_days_count
                        };
                    }
                    data.prevMonthStats = prevMap;

                    // Compute avg DAU % for previous month while we have per-user daily data
                    const prevDayCountMap = {};
                    for (const u of prevData.users) {
                        if (Array.isArray(u.daily)) {
                            for (const d of u.daily) {
                                prevDayCountMap[d.day] = (prevDayCountMap[d.day] || 0) + 1;
                            }
                        }
                    }
                    const prevBizActiveDays = Object.entries(prevDayCountMap).filter(([day]) => {
                        const dow = new Date(day + 'T00:00:00').getDay();
                        return dow !== 0 && dow !== 6;
                    });
                    let prevAvgDauPct = null;
                    if (prevBizActiveDays.length > 0 && prevData.totalUsers > 0) {
                        const prevDauSum = prevBizActiveDays.reduce((s, [, n]) => s + n, 0);
                        const prevAvgDAU = prevDauSum / prevBizActiveDays.length;
                        prevAvgDauPct = Math.round(prevAvgDAU / prevData.totalUsers * 100);
                    }

                    data.prevMonthTotals = {
                        totalUsers: prevData.totalUsers,
                        totalInteractions: prevData.totalInteractions,
                        totalOrgLocChanged: prevData.totalOrgLocChanged,
                        avgDauPct: prevAvgDauPct
                    };
                }
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
        } catch (error) {
            console.error(error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal Server Error' }));
        }
    } else {
        serveStaticFile(req, res);
    }
});

server.listen(PORT, () => {
    console.log(`MVP Dashboard running on http://localhost:${PORT}`);
});
