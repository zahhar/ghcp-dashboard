const http = require('http');
const fs = require('fs');
const readline = require('readline');
const path = require('path');

const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

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

const documentingLanguages = ['markdown', 'text', 'unknown', 'prompt', 'instructions', 'chatagent', 'mermaid', 'plaintext', 'others', 'bibtex', 'snippets', 'latex', 'restructuredtext', 'search-result', 'skill', 'tex'];
const configLanguages = ['csv', 'csv (semicolon)', 'dockercompose', 'dockerfile', 'dotenv', 'gitignore', 'ignore', 'ini', 'json', 'jsonc', 'jsonl', 'makefile', 'properties', 'spring-boot-properties', 'vscode', 'xml', 'yaml', 'code-text-binary', 'log'];

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
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
}

const USERS_FILE = path.join(__dirname, 'users.json');

let cachedParsedData = null;

// Process data on the fly
async function getAggregatedData(monthFilter = null) {
    let userMapping = {};
    try {
        if (fs.existsSync(USERS_FILE)) {
            userMapping = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('Failed to read users.json:', e);
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
            }

            const user = entry.user_login || 'unknown';

            if (!userStats[user]) {
                userStats[user] = {
                    user_login: user,
                    loc_added_sum: 0,
                    loc_deleted_sum: 0,
                    doc_loc_added_sum: 0,
                    doc_loc_deleted_sum: 0,
                    config_loc_added_sum: 0,
                    config_loc_deleted_sum: 0,
                    user_initiated_interaction_count: 0,
                    code_generation_activity_count: 0,
                    code_acceptance_activity_count: 0,
                    active_days: new Set(),
                    agent_days: new Set(),
                    chat_days: new Set(),
                    last_active_day: '',
                    last_ide_name: null,
                    last_plugin: null,
                    last_plugin_version: null,
                    last_ide_version: null,
                    models: {},
                    ides: {},
                    languages: {},
                    doc_languages: new Set(),
                    config_languages: new Set(),
                    daily: {}
                };
            }

            const stats = userStats[user];
            stats.user_initiated_interaction_count += (entry.user_initiated_interaction_count || 0);
            stats.code_generation_activity_count += (entry.code_generation_activity_count || 0);
            stats.code_acceptance_activity_count += (entry.code_acceptance_activity_count || 0);

            if (entry.day) {
                if (!stats.daily[entry.day]) {
                    stats.daily[entry.day] = { user_initiated: 0, code_generation: 0, code_loc: 0, doc_loc: 0, config_loc: 0 };
                }
                stats.daily[entry.day].user_initiated += (entry.user_initiated_interaction_count || 0);
                stats.daily[entry.day].code_generation += (entry.code_generation_activity_count || 0);
            }

            stats.loc_added_sum += (entry.loc_added_sum || 0);
            stats.loc_deleted_sum += (entry.loc_deleted_sum || 0);

            if (Array.isArray(entry.totals_by_language_feature)) {
                let entryDocLoc = 0, entryConfigLoc = 0, entryTotalLoc = 0;
                for (const lf of entry.totals_by_language_feature) {
                    const lang = (lf.language || 'unknown').toLowerCase();
                    const lfLoc = (lf.loc_added_sum || 0) + (lf.loc_deleted_sum || 0);
                    if (documentingLanguages.includes(lang)) {
                        stats.doc_loc_added_sum += (lf.loc_added_sum || 0);
                        stats.doc_loc_deleted_sum += (lf.loc_deleted_sum || 0);
                        if (lfLoc > 0) stats.doc_languages.add(lf.language);
                        entryDocLoc += lfLoc;
                    } else if (configLanguages.includes(lang)) {
                        stats.config_loc_added_sum += (lf.loc_added_sum || 0);
                        stats.config_loc_deleted_sum += (lf.loc_deleted_sum || 0);
                        if (lfLoc > 0) stats.config_languages.add(lf.language);
                        entryConfigLoc += lfLoc;
                    }
                    entryTotalLoc += lfLoc;
                }
                if (entry.day && stats.daily[entry.day]) {
                    stats.daily[entry.day].doc_loc += entryDocLoc;
                    stats.daily[entry.day].config_loc += entryConfigLoc;
                    stats.daily[entry.day].code_loc += entryTotalLoc - entryDocLoc - entryConfigLoc;
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
                if (entry.used_agent) stats.agent_days.add(entry.day);
                if (entry.used_chat) stats.chat_days.add(entry.day);
            }

            if (Array.isArray(entry.totals_by_language_model)) {
                for (const tm of entry.totals_by_language_model) {
                    const lang = (tm.language || 'unknown').toLowerCase();
                    if (documentingLanguages.includes(lang) || configLanguages.includes(lang)) continue;

                    const changedLoc = (tm.loc_added_sum || 0) + (tm.loc_deleted_sum || 0);
                    if (tm.model) {
                        stats.models[tm.model] = (stats.models[tm.model] || 0) + changedLoc;
                    }
                    if (tm.language) {
                        stats.languages[tm.language] = (stats.languages[tm.language] || 0) + changedLoc;
                    }
                }
            }

            if (Array.isArray(entry.totals_by_ide)) {
                for (const ti of entry.totals_by_ide) {
                    // IDE LOC is not broken down by language in data.json
                    if (ti.ide) {
                        const iLoc = (ti.loc_added_sum || 0) + (ti.loc_deleted_sum || 0);
                        stats.ides[ti.ide] = (stats.ides[ti.ide] || 0) + iLoc;
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

        const configLocAdded = user.config_loc_added_sum;
        const configLocDeleted = user.config_loc_deleted_sum;
        const configLocChanged = configLocAdded + configLocDeleted;

        const codeLocAdded = totalLocAdded - docLocAdded - configLocAdded;
        const codeLocDeleted = totalLocDeleted - docLocDeleted - configLocDeleted;
        const codeLocChanged = totalLocChanged - docLocChanged - configLocChanged;

        totalOrgLocChanged += totalLocChanged;

        let favModel = 'None';
        let favModelLoc = 0;
        for (const [m, loc] of Object.entries(user.models)) {
            if (loc > favModelLoc) {
                favModelLoc = loc;
                favModel = m;
            }
        }
        const favModelPct = codeLocChanged > 0 ? Math.round((favModelLoc / codeLocChanged) * 100) + '%' : '0%';

        let favIde = 'None';
        let favIdeLoc = 0;
        for (const [i, loc] of Object.entries(user.ides)) {
            if (loc > favIdeLoc) {
                favIdeLoc = loc;
                favIde = i;
            }
        }
        const favIdePct = totalLocChanged > 0 ? Math.round((favIdeLoc / totalLocChanged) * 100) + '%' : '0%';

        let favLanguage = 'None';
        let favLanguageLoc = 0;

        for (const [l, loc] of Object.entries(user.languages)) {
            if (loc > favLanguageLoc) {
                favLanguageLoc = loc;
                favLanguage = l;
            }
        }
        const favLanguagePct = codeLocChanged > 0 ? Math.round((favLanguageLoc / codeLocChanged) * 100) + '%' : '0%';

        // Map human name and revoked
        const mapping = userMapping[user.user_login] || {};
        const humanName = mapping.name || user.user_login;
        const isRevoked = mapping.revoked === true;
        const userTeam = mapping.team || '';

        return {
            ...user,
            human_name: humanName,
            revoked: isRevoked,
            team: userTeam,
            total_loc_changed: totalLocChanged,
            total_loc_added: totalLocAdded,
            total_loc_deleted: totalLocDeleted,
            doc_loc_changed: docLocChanged,
            doc_loc_added: docLocAdded,
            doc_loc_deleted: docLocDeleted,
            config_loc_changed: configLocChanged,
            config_loc_added: configLocAdded,
            config_loc_deleted: configLocDeleted,
            code_loc_changed: codeLocChanged,
            code_loc_added: codeLocAdded,
            code_loc_deleted: codeLocDeleted,
            active_days_count: user.active_days.size,
            agent_days_count: user.agent_days.size,
            chat_days_count: user.chat_days.size,
            turns: user.user_initiated_interaction_count + user.code_generation_activity_count,
            acceptance_rate: Math.round(generationRatio * 100) + '%',
            avg_loc_added_daily: user.active_days.size > 0 ? Math.round(codeLocAdded / user.active_days.size) : 0,
            favorite_model: favModel !== 'None' ? `${favModel}<br><span style="font-size:0.8em;color:var(--text-muted)">${favModelPct}</span>` : '-',
            favorite_ide: favIde !== 'None' ? `${favIde}<br><span style="font-size:0.8em;color:var(--text-muted)">${favIdePct}</span>` : '-',
            favorite_language: favLanguage !== 'None' ? `${favLanguage}<br><span style="font-size:0.8em;color:var(--text-muted)">${favLanguagePct}</span>` : '-',
            active_days: undefined,
            agent_days: undefined,
            chat_days: undefined,
            all_languages_list: Object.keys(user.languages).sort(),
            all_models_list: Object.keys(user.models).sort(),
            all_ides_list: Object.keys(user.ides).sort(),
            all_doc_languages_list: [...user.doc_languages].sort(),
            all_config_languages_list: [...user.config_languages].sort(),
            daily: Object.entries(user.daily)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([day, d]) => ({ day, user_initiated: d.user_initiated, code_generation: d.code_generation, code_loc: d.code_loc, doc_loc: d.doc_loc, config_loc: d.config_loc })),
            models: undefined,
            ides: undefined,
            languages: undefined,
            doc_languages: undefined,
            config_languages: undefined
        };
    });

    const allUsers = [...results].sort((a, b) => b.code_loc_changed - a.code_loc_changed);

    // Sort available months nicely
    const orderedMonths = Array.from(availableMonths).sort();

    // Collect all languages seen across all users (already filtered of excluded langs)
    const allLanguages = [...new Set(
        Object.values(userStats).flatMap(u => Object.keys(u.languages))
    )].sort();

    // Collect available teams from user mapping
    const availableTeams = [...new Set(Object.values(userMapping).map(u => u.team).filter(Boolean))].sort();

    return {
        users: allUsers,
        totalUsers: results.length,
        totalInteractions: results.reduce((acc, user) => acc + user.turns, 0),
        totalOrgLocChanged: totalOrgLocChanged,
        availableMonths: orderedMonths,
        availableTeams,
        allLanguages
    };
}

const server = http.createServer(async (req, res) => {
    // Basic CORS
    res.setHeader('Access-Control-Allow-Origin', '*');

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
                    const prevData = await getAggregatedData(prevMonth);
                    const prevMap = {};
                    for (const u of prevData.users) {
                        prevMap[u.user_login] = {
                            code_loc_changed: u.code_loc_changed,
                            avg_loc_added_daily: u.avg_loc_added_daily,
                            doc_loc_changed: u.doc_loc_changed,
                            config_loc_changed: u.config_loc_changed,
                            turns: u.turns,
                            active_days_count: u.active_days_count
                        };
                    }
                    data.prevMonthStats = prevMap;
                    data.prevMonthTotals = {
                        totalUsers: prevData.totalUsers,
                        totalInteractions: prevData.totalInteractions,
                        totalOrgLocChanged: prevData.totalOrgLocChanged
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
