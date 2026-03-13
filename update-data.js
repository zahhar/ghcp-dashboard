#!/usr/bin/env node

/**
 * update-data.js
 *
 * Fetches new Copilot usage metrics from the GitHub API for each day
 * between the last known report day (from config.json) and yesterday.
 *
 * Downloads raw NDJSON files to /data, appends new entries to data.json,
 * and updates config.json with the new last report day.
 *
 * Requires: .env file with GITHUB_TOKEN
 *           config.json with org and last_report_day
 *
 * For data verification use: node debug.js YYYY-MM-DD | node debug.js latest
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ── Load .env manually (no external deps) ──────────────────────────────
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

// ── Mock-mode guard ─────────────────────────────────────────────────────
if (process.env.USE_MOCK_DATA === 'true') {
    console.error('❌ USE_MOCK_DATA=true is set. Refusing to run in mock mode to protect real data.');
    process.exit(1);
}

// ── Config ──────────────────────────────────────────────────────────────
const CONFIG_PATH = path.join(__dirname, 'data', 'config.json');
const DATA_FILE = path.join(__dirname, 'data', 'data.json');
const DATA_DIR = path.join(__dirname, 'data', 'raw');

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const TOKEN = process.env.GITHUB_TOKEN;
const ORG = config.org;

if (!TOKEN) {
    console.error('❌ GITHUB_TOKEN not found. Create a .env file with GITHUB_TOKEN=<your token>');
    process.exit(1);
}
if (!ORG || ORG === 'YOUR_ORG_NAME') {
    console.error('❌ Set your GitHub org name in config.json');
    process.exit(1);
}

// ── Helpers ─────────────────────────────────────────────────────────────
function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

function getYesterday() {
    return addDays(new Date().toISOString().slice(0, 10), -1);
}

function httpsGet(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const options = {
            hostname: parsed.hostname,
            path: parsed.pathname + parsed.search,
            method: 'GET',
            headers: {
                'User-Agent': 'ghcp-stats-updater',
                ...headers
            }
        };
        https.get(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
        }).on('error', reject);
    });
}

async function fetchReportLinks(day) {
    const url = `https://api.github.com/orgs/${ORG}/copilot/metrics/reports/users-1-day?day=${day}`;
    const res = await httpsGet(url, {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${TOKEN}`,
        'X-GitHub-Api-Version': '2026-03-10'
    });

    if (res.status === 404) {
        console.log(`  ⚠️  No report for ${day} (404)`);
        return null;
    }
    if (res.status !== 200) {
        console.error(`  ❌ API error for ${day}: HTTP ${res.status}`);
        console.error(`     ${res.body.slice(0, 200)}`);
        return null;
    }

    return JSON.parse(res.body);
}

async function downloadFile(url) {
    // Follow redirects manually (signed URLs may redirect)
    let currentUrl = url;
    for (let i = 0; i < 5; i++) {
        const res = await httpsGet(currentUrl);
        if (res.status >= 300 && res.status < 400 && res.headers.location) {
            currentUrl = res.headers.location;
            continue;
        }
        if (res.status !== 200) {
            throw new Error(`Download failed: HTTP ${res.status}`);
        }
        return res.body;
    }
    throw new Error('Too many redirects');
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
    const lastDay = config.last_report_day;
    const yesterday = getYesterday();

    console.log(`📊 Last report day: ${lastDay}`);
    console.log(`📅 Yesterday:       ${yesterday}`);

    if (lastDay >= yesterday) {
        console.log('✅ Already up to date!');
        return;
    }

    // Ensure /data/raw directory exists
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    const daysToFetch = [];
    let current = addDays(lastDay, 1);
    while (current <= yesterday) {
        daysToFetch.push(current);
        current = addDays(current, 1);
    }

    console.log(`📥 Fetching ${daysToFetch.length} day(s): ${daysToFetch[0]} → ${daysToFetch[daysToFetch.length - 1]}\n`);

    let allNewLines = [];
    let latestSuccessDay = lastDay;

    for (const day of daysToFetch) {
        process.stdout.write(`  ${day}... `);

        const report = await fetchReportLinks(day);
        if (!report || !report.download_links || report.download_links.length === 0) {
            console.log('no data');
            continue;
        }

        let dayLines = [];

        for (let i = 0; i < report.download_links.length; i++) {
            const content = await downloadFile(report.download_links[i]);
            const lines = content.split('\n').filter(l => l.trim());
            dayLines = dayLines.concat(lines);
        }

        // Save raw file
        const rawPath = path.join(DATA_DIR, `${day}_raw.json`);
        fs.writeFileSync(rawPath, dayLines.join('\n') + '\n');

        allNewLines = allNewLines.concat(dayLines);
        latestSuccessDay = day;

        console.log(`✅ ${dayLines.length} entries`);
    }

    if (allNewLines.length > 0) {
        // Append to data.json
        const appendData = '\n' + allNewLines.join('\n') + '\n';
        fs.appendFileSync(DATA_FILE, appendData);
        console.log(`\n📝 Appended ${allNewLines.length} entries to data.json`);
    } else {
        console.log('\n⚠️  No new data downloaded');
    }

    // Update config
    if (latestSuccessDay > lastDay) {
        config.last_report_day = latestSuccessDay;
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
        console.log(`✅ Updated last_report_day to ${latestSuccessDay}`);
    }

    console.log('\n🎉 Done!');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
