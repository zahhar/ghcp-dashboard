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

// Process data on the fly
async function getAggregatedData() {
    const fileStream = fs.createReadStream(DATA_FILE);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    const userStats = {};

    for await (const line of rl) {
        if (!line.trim()) continue;
        try {
            const entry = JSON.parse(line);
            const user = entry.user_login || 'unknown';

            if (!userStats[user]) {
                userStats[user] = {
                    user_login: user,
                    loc_added_sum: 0,
                    loc_deleted_sum: 0,
                    user_initiated_interaction_count: 0,
                    code_generation_activity_count: 0,
                    code_acceptance_activity_count: 0,
                    active_days: new Set(),
                    agent_chat_days: new Set(),
                    models: {},
                    ides: {}
                };
            }

            const stats = userStats[user];
            stats.loc_added_sum += (entry.loc_added_sum || 0);
            stats.loc_deleted_sum += (entry.loc_deleted_sum || 0);
            stats.user_initiated_interaction_count += (entry.user_initiated_interaction_count || 0);
            stats.code_generation_activity_count += (entry.code_generation_activity_count || 0);
            stats.code_acceptance_activity_count += (entry.code_acceptance_activity_count || 0);

            if (entry.day) stats.active_days.add(entry.day);
            if (entry.used_agent || entry.used_chat) {
                if (entry.day) stats.agent_chat_days.add(entry.day);
            }

            if (Array.isArray(entry.totals_by_language_model)) {
                for (const tm of entry.totals_by_language_model) {
                    if (tm.model) {
                        const mLoc = (tm.loc_added_sum || 0) + (tm.loc_deleted_sum || 0);
                        stats.models[tm.model] = (stats.models[tm.model] || 0) + mLoc;
                    }
                }
            }

            if (Array.isArray(entry.totals_by_ide)) {
                for (const ti of entry.totals_by_ide) {
                    if (ti.ide) {
                        const iLoc = (ti.loc_added_sum || 0) + (ti.loc_deleted_sum || 0);
                        stats.ides[ti.ide] = (stats.ides[ti.ide] || 0) + iLoc;
                    }
                }
            }

        } catch (e) {
            console.error('Failed to parse line:', e);
        }
    }

    // Convert to array and finalize metrics
    const results = Object.values(userStats).map(user => {
        const generationRatio = user.code_generation_activity_count > 0
            ? user.code_acceptance_activity_count / user.code_generation_activity_count
            : 0;

        const totalLocChanged = user.loc_added_sum + user.loc_deleted_sum;

        let favModel = 'None';
        let favModelLoc = 0;
        for (const [m, loc] of Object.entries(user.models)) {
            if (loc > favModelLoc) {
                favModelLoc = loc;
                favModel = m;
            }
        }
        const favModelPct = totalLocChanged > 0 ? ((favModelLoc / totalLocChanged) * 100).toFixed(1) + '%' : '0%';

        let favIde = 'None';
        let favIdeLoc = 0;
        for (const [i, loc] of Object.entries(user.ides)) {
            if (loc > favIdeLoc) {
                favIdeLoc = loc;
                favIde = i;
            }
        }
        const favIdePct = totalLocChanged > 0 ? ((favIdeLoc / totalLocChanged) * 100).toFixed(1) + '%' : '0%';

        return {
            ...user,
            active_days_count: user.active_days.size,
            agent_chat_days_count: user.agent_chat_days.size,
            acceptance_rate: (generationRatio * 100).toFixed(1) + '%',
            favorite_model: favModel !== 'None' ? `${favModel}<br><span style="font-size:0.8em;color:var(--text-muted)">${favModelPct}</span>` : '-',
            favorite_ide: favIde !== 'None' ? `${favIde}<br><span style="font-size:0.8em;color:var(--text-muted)">${favIdePct}</span>` : '-',
            active_days: undefined,
            agent_chat_days: undefined,
            models: undefined,
            ides: undefined
        };
    });

    const allUsers = [...results].sort((a, b) => b.user_initiated_interaction_count - a.user_initiated_interaction_count);

    return {
        users: allUsers,
        totalUsers: results.length,
        totalInteractions: results.reduce((acc, user) => acc + user.user_initiated_interaction_count, 0)
    };
}

const server = http.createServer(async (req, res) => {
    // Basic CORS
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.url === '/api/stats' && req.method === 'GET') {
        try {
            const data = await getAggregatedData();
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
