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
    const excludedLangs = ['markdown', 'text', 'unknown', 'prompt', 'instructions'];
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
                    user_initiated_interaction_count: 0,
                    code_generation_activity_count: 0,
                    code_acceptance_activity_count: 0,
                    active_days: new Set(),
                    agent_days: new Set(),
                    chat_days: new Set(),
                    last_active_day: '',
                    models: {},
                    ides: {},
                    languages: {}
                };
            }

            const stats = userStats[user];
            stats.user_initiated_interaction_count += (entry.user_initiated_interaction_count || 0);
            stats.code_generation_activity_count += (entry.code_generation_activity_count || 0);
            stats.code_acceptance_activity_count += (entry.code_acceptance_activity_count || 0);

            stats.loc_added_sum += (entry.loc_added_sum || 0);
            stats.loc_deleted_sum += (entry.loc_deleted_sum || 0);

            if (Array.isArray(entry.totals_by_language_feature)) {
                for (const lf of entry.totals_by_language_feature) {
                    const lang = (lf.language || 'unknown').toLowerCase();
                    if (excludedLangs.includes(lang)) {
                        stats.doc_loc_added_sum += (lf.loc_added_sum || 0);
                        stats.doc_loc_deleted_sum += (lf.loc_deleted_sum || 0);
                    }
                }
            }

            if (entry.day) {
                stats.active_days.add(entry.day);
                if (!stats.last_active_day || entry.day > stats.last_active_day) {
                    stats.last_active_day = entry.day;
                }
                if (entry.used_agent) stats.agent_days.add(entry.day);
                if (entry.used_chat) stats.chat_days.add(entry.day);
            }

            if (Array.isArray(entry.totals_by_language_model)) {
                for (const tm of entry.totals_by_language_model) {
                    const lang = (tm.language || 'unknown').toLowerCase();
                    if (excludedLangs.includes(lang)) continue;

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
        const favModelPct = codeLocChanged > 0 ? ((favModelLoc / codeLocChanged) * 100).toFixed(1) + '%' : '0%';

        let favIde = 'None';
        let favIdeLoc = 0;
        for (const [i, loc] of Object.entries(user.ides)) {
            if (loc > favIdeLoc) {
                favIdeLoc = loc;
                favIde = i;
            }
        }
        const favIdePct = totalLocChanged > 0 ? ((favIdeLoc / totalLocChanged) * 100).toFixed(1) + '%' : '0%';

        let favLanguage = 'None';
        let favLanguageLoc = 0;

        for (const [l, loc] of Object.entries(user.languages)) {
            if (loc > favLanguageLoc) {
                favLanguageLoc = loc;
                favLanguage = l;
            }
        }
        const favLanguagePct = codeLocChanged > 0 ? ((favLanguageLoc / codeLocChanged) * 100).toFixed(1) + '%' : '0%';

        // Map human name and revoked
        const mapping = userMapping[user.user_login] || {};
        const humanName = mapping.name || user.user_login;
        const isRevoked = mapping.revoked === true;

        return {
            ...user,
            human_name: humanName,
            revoked: isRevoked,
            total_loc_changed: totalLocChanged,
            total_loc_added: totalLocAdded,
            total_loc_deleted: totalLocDeleted,
            doc_loc_changed: docLocChanged,
            doc_loc_added: docLocAdded,
            doc_loc_deleted: docLocDeleted,
            code_loc_changed: codeLocChanged,
            code_loc_added: codeLocAdded,
            code_loc_deleted: codeLocDeleted,
            active_days_count: user.active_days.size,
            agent_days_count: user.agent_days.size,
            chat_days_count: user.chat_days.size,
            acceptance_rate: Math.round(generationRatio * 100) + '%',
            favorite_model: favModel !== 'None' ? `${favModel}<br><span style="font-size:0.8em;color:var(--text-muted)">${favModelPct}</span>` : '-',
            favorite_ide: favIde !== 'None' ? `${favIde}<br><span style="font-size:0.8em;color:var(--text-muted)">${favIdePct}</span>` : '-',
            favorite_language: favLanguage !== 'None' ? `${favLanguage}<br><span style="font-size:0.8em;color:var(--text-muted)">${favLanguagePct}</span>` : '-',
            active_days: undefined,
            agent_days: undefined,
            chat_days: undefined,
            models: undefined,
            ides: undefined,
            languages: undefined
        };
    });

    const allUsers = [...results].sort((a, b) => b.code_loc_changed - a.code_loc_changed);

    // Sort available months nicely
    const orderedMonths = Array.from(availableMonths).sort();

    return {
        users: allUsers,
        totalUsers: results.length,
        totalInteractions: results.reduce((acc, user) => acc + user.user_initiated_interaction_count, 0),
        totalOrgLocChanged: totalOrgLocChanged,
        availableMonths: orderedMonths
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
