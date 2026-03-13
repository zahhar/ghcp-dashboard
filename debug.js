#!/usr/bin/env node

/**
 * debug.js
 *
 * Debug tool for verifying Copilot usage data against data.json.
 *
 * Usage:
 *   node debug.js YYYY-MM-DD   — re-download a single day and compare
 *   node debug.js latest       — download last 28 days and compare
 *
 * Downloads are saved to /data/debug and compared against data.json.
 * Comparison is on top-level activity fields only (see COMPARE_FIELDS).
 *
 * Requires: .env file with GITHUB_TOKEN
 *           config.json with org
 */

const fs   = require('fs');
const path = require('path');
const https = require('https');

// ── Load .env ─────────────────────────────────────────────────────────────
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

// ── Config ────────────────────────────────────────────────────────────────
const DATA_FILE = path.join(__dirname, 'data', 'data.json');
const DEBUG_DIR = path.join(__dirname, 'data', 'debug');
const config    = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'config.json'), 'utf8'));
const TOKEN     = process.env.GITHUB_TOKEN;
const ORG       = config.org;

if (!TOKEN) {
    console.error('❌ GITHUB_TOKEN not found. Create a .env file with GITHUB_TOKEN=<your token>');
    process.exit(1);
}
if (!ORG || ORG === 'YOUR_ORG_NAME') {
    console.error('❌ Set your GitHub org name in config.json');
    process.exit(1);
}

// Top-level scalar fields compared for every (user_id, day) pair.
// Nested arrays (totals_by_ide etc.) are intentionally skipped —
// their model/feature labels change over time in the API.
const COMPARE_FIELDS = [
    'user_initiated_interaction_count',
    'code_generation_activity_count',
    'code_acceptance_activity_count',
    'used_agent',
    'used_chat',
    'loc_suggested_to_add_sum',
    'loc_suggested_to_delete_sum',
    'loc_added_sum',
    'loc_deleted_sum',
];

// ── HTTP helpers ──────────────────────────────────────────────────────────
function httpsGet(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const options = {
            hostname: parsed.hostname,
            path: parsed.pathname + parsed.search,
            method: 'GET',
            headers: { 'User-Agent': 'ghcp-stats-debug', ...headers },
        };
        https.get(options, res => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
        }).on('error', reject);
    });
}

function apiGet(endpoint) {
    return httpsGet(`https://api.github.com${endpoint}`, {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${TOKEN}`,
        'X-GitHub-Api-Version': '2026-03-10',
    });
}

async function downloadFile(url) {
    let current = url;
    for (let i = 0; i < 5; i++) {
        const res = await httpsGet(current);
        if (res.status >= 300 && res.status < 400 && res.headers.location) {
            current = res.headers.location;
            continue;
        }
        if (res.status !== 200) throw new Error(`Download failed: HTTP ${res.status}`);
        return res.body;
    }
    throw new Error('Too many redirects');
}

// ── Download helpers ──────────────────────────────────────────────────────
async function fetchLinks(endpoint, label) {
    const res = await apiGet(endpoint);
    if (res.status === 404) { console.log(`⚠️  404 — no data for ${label}`); return null; }
    if (res.status !== 200) {
        console.error(`❌ API error ${res.status} for ${label}: ${res.body.slice(0, 200)}`);
        return null;
    }
    return JSON.parse(res.body);
}

async function downloadLinks(links, label) {
    console.log(`📦 ${links.length} download link(s) for ${label}`);
    let allLines = [];
    for (let i = 0; i < links.length; i++) {
        const content = await downloadFile(links[i]);
        const lines = content.split('\n').filter(l => l.trim());
        console.log(`   File ${i + 1}/${links.length}: ${lines.length} lines`);
        allLines = allLines.concat(lines);
    }
    console.log(`   Total: ${allLines.length} lines`);
    return allLines;
}

// ── Compare downloaded lines against data.json ───────────────────────────
function compareWithDataJson(allLines, dayRange) {
    if (!fs.existsSync(DATA_FILE)) {
        console.log('⚠️  data.json not found — skipping comparison.');
        return;
    }

    const dataJsonLines = fs.readFileSync(DATA_FILE, 'utf8').split('\n').filter(l => l.trim());
    const dataInRange   = dataJsonLines.filter(l => {
        const m = l.match(/"day":"(\d{4}-\d{2}-\d{2})"/);
        return m && m[1] >= dayRange.start && m[1] <= dayRange.end;
    });

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`📂 Comparing with data.json`);
    console.log(`   Range                : ${dayRange.start} → ${dayRange.end}`);
    console.log(`   data.json total lines: ${dataJsonLines.length}`);
    console.log(`   data.json in range   : ${dataInRange.length}`);
    console.log(`   freshly downloaded   : ${allLines.length}`);
    console.log(`   comparing fields     : ${COMPARE_FIELDS.join(', ')}`);

    function buildMap(lines, label) {
        const map = new Map();
        for (const line of lines) {
            try {
                const rec = JSON.parse(line);
                const key = `${rec.user_id}:${rec.day}`;
                if (map.has(key)) console.log(`  ⚠️  Duplicate key ${key} in ${label}`);
                map.set(key, rec);
            } catch {
                console.log(`  ⚠️  Unparseable line in ${label}: ${line.slice(0, 80)}…`);
            }
        }
        return map;
    }

    const debugMap = buildMap(allLines, 'debug download');
    const dataMap  = buildMap(dataInRange, 'data.json');
    const allKeys  = new Set([...debugMap.keys(), ...dataMap.keys()]);

    let matched = 0, changed = 0, onlyDebug = 0, onlyData = 0;

    console.log('');
    for (const key of [...allKeys].sort()) {
        const inDebug = debugMap.has(key);
        const inData  = dataMap.has(key);

        if (!inDebug) {
            onlyData++;
            const r = dataMap.get(key);
            console.log(`  ➖ ONLY IN data.json  user_id=${r.user_id} (${r.user_login || '?'}) day=${r.day}`);
            continue;
        }
        if (!inData) {
            onlyDebug++;
            const r = debugMap.get(key);
            console.log(`  ➕ ONLY IN DEBUG      user_id=${r.user_id} (${r.user_login || '?'}) day=${r.day}`);
            continue;
        }

        const dRec = debugMap.get(key);
        const xRec = dataMap.get(key);
        const diffs = COMPARE_FIELDS.filter(f => {
            const dv = dRec[f], xv = xRec[f];
            // Both present: compare value
            if (dv !== undefined && xv !== undefined) return dv !== xv;
            // One missing
            return dv !== xv;
        });

        if (diffs.length === 0) {
            matched++;
        } else {
            changed++;
            console.log(`  🔄 CHANGED  user_id=${dRec.user_id} (${dRec.user_login || '?'}) day=${dRec.day}`);
            for (const f of diffs) {
                const dv = dRec[f];
                const xv = xRec[f];
                if (dv === undefined) {
                    console.log(`     ➖ ${f}: MISSING IN DEBUG     data.json=${JSON.stringify(xv)}`);
                } else if (xv === undefined) {
                    console.log(`     ➕ ${f}: MISSING IN DATA.JSON debug=${JSON.stringify(dv)}`);
                } else {
                    console.log(`     ≠  ${f}: debug=${JSON.stringify(dv)}  data.json=${JSON.stringify(xv)}`);
                }
            }
        }
    }

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`   ✅ Matched  : ${matched}`);
    console.log(`   🔄 Changed  : ${changed}`);
    console.log(`   ➕ Only debug    : ${onlyDebug}`);
    console.log(`   ➖ Only data.json: ${onlyData}`);
    if (changed === 0 && onlyDebug === 0 && onlyData === 0) {
        console.log('\n✅ data.json is FULLY IN SYNC with the fresh download');
    } else {
        console.log('\n⚠️  Discrepancies found — see above');
    }
}

// ── Single-day debug ──────────────────────────────────────────────────────
async function debugDay(day) {
    if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR);

    console.log(`\n🔍 DEBUG — single day: ${day}`);
    console.log('─'.repeat(60));

    const report = await fetchLinks(
        `/orgs/${ORG}/copilot/metrics/reports/users-1-day?day=${day}`, day);
    if (!report?.download_links?.length) { console.log('No download links.'); return; }

    const allLines = await downloadLinks(report.download_links, day);

    const debugPath = path.join(DEBUG_DIR, `${day}_raw.json`);
    fs.writeFileSync(debugPath, allLines.join('\n') + '\n');
    console.log(`💾 Saved to data/debug/${day}_raw.json`);

    compareWithDataJson(allLines, { start: day, end: day });
    console.log('\n🎉 Done!');
}

// ── Bulk 28-day debug ─────────────────────────────────────────────────────
async function debugLatest() {
    if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR);

    console.log('\n🔍 DEBUG — users-28-day/latest');
    console.log('─'.repeat(60));

    const report = await fetchLinks(
        `/orgs/${ORG}/copilot/metrics/reports/users-28-day/latest`, 'latest');
    if (!report?.download_links?.length) { console.log('No download links.'); return; }

    const { report_start_day, report_end_day, download_links: links } = report;
    console.log(`📅 Report range: ${report_start_day} → ${report_end_day}`);

    const allLines = await downloadLinks(links, 'latest');

    // Day breakdown
    const byDay = new Map();
    for (const line of allLines) {
        try {
            const r = JSON.parse(line);
            byDay.set(r.day, (byDay.get(r.day) || 0) + 1);
        } catch { /* ignore */ }
    }
    console.log('\n📆 Users per day:');
    for (const [d, n] of [...byDay.entries()].sort()) {
        console.log(`   ${d} : ${n}`);
    }

    const debugPath = path.join(DEBUG_DIR, `${report_start_day}_to_${report_end_day}_raw.json`);
    fs.writeFileSync(debugPath, allLines.join('\n') + '\n');
    console.log(`\n💾 Saved to data/debug/${report_start_day}_to_${report_end_day}_raw.json`);

    compareWithDataJson(allLines, { start: report_start_day, end: report_end_day });
    console.log('\n🎉 Done!');
}

// ── Entry point ───────────────────────────────────────────────────────────
const arg = process.argv[2];
if (arg === 'latest') {
    debugLatest().catch(err => { console.error('Fatal:', err); process.exit(1); });
} else if (arg && /^\d{4}-\d{2}-\d{2}$/.test(arg)) {
    debugDay(arg).catch(err => { console.error('Fatal:', err); process.exit(1); });
} else {
    console.error('Usage: node debug.js YYYY-MM-DD');
    console.error('       node debug.js latest');
    process.exit(1);
}
