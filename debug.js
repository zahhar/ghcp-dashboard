#!/usr/bin/env node

/**
 * debug.js
 *
 * All-in-one debug and analysis utility for Copilot metrics.
 *
 * Usage:
 *   node debug.js                        — show this help
 *   node debug.js YYYY-MM-DD             — re-download one day, compare with data.json
 *   node debug.js latest                 — re-download last 28 days, compare with data.json
 *   node debug.js org fetch              — download latest 28-day org-level metrics
 *   node debug.js org discover           — compare key vocabulary vs data.json
 *   node debug.js org compare YYYY-MM-DD — compare one day totals: user aggregate vs org
 *
 * Downloads are saved to data/debug/ and compared against data.json.
 *
 * Requires: .env file with GITHUB_TOKEN
 *           data/config.json with org
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
                if (rec.user_login) rec.user_login = rec.user_login.toLowerCase();
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

// ── Org-level analysis constants ─────────────────────────────────────────
const METRIC_FIELDS = [
    'user_initiated_interaction_count',
    'code_generation_activity_count',
    'code_acceptance_activity_count',
    'loc_suggested_to_add_sum',
    'loc_suggested_to_delete_sum',
    'loc_added_sum',
    'loc_deleted_sum',
];
const ORG_ONLY_FIELDS = [
    'daily_active_users',
    'weekly_active_users',
    'monthly_active_users',
    'monthly_active_chat_users',
    'monthly_active_agent_users',
];

// ── Org-metrics file finder ───────────────────────────────────────────────
function findOrgMetricsFile(forDay) {
    if (!fs.existsSync(DEBUG_DIR)) return null;
    const candidates = fs.readdirSync(DEBUG_DIR).filter(f => f.startsWith('org-metrics_'));
    if (forDay) {
        for (const f of candidates.sort().reverse()) {
            const m = f.match(/org-metrics_(\d{4}-\d{2}-\d{2})_to_(\d{4}-\d{2}-\d{2})/);
            if (m && forDay >= m[1] && forDay <= m[2]) return path.join(DEBUG_DIR, f);
        }
    }
    const sorted = candidates.sort().reverse();
    return sorted.length ? path.join(DEBUG_DIR, sorted[0]) : null;
}

function loadOrgMetrics(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// ── Aggregate user-level records for one day ──────────────────────────────
function aggregateUserDay(day) {
    if (!fs.existsSync(DATA_FILE)) return null;
    const records = [];
    for (const line of fs.readFileSync(DATA_FILE, 'utf8').split('\n').filter(l => l.trim())) {
        try { const r = JSON.parse(line); if (r.day === day) records.push(r); } catch { /* skip */ }
    }
    if (records.length === 0) return null;

    const totals = { _user_count: records.length };
    for (const f of METRIC_FIELDS) totals[f] = records.reduce((s, r) => s + (r[f] || 0), 0);

    const sumBreakdown = (key, pkFn) => {
        const map = new Map();
        for (const rec of records) {
            for (const entry of (rec[key] || [])) {
                const pk = pkFn(entry);
                if (!map.has(pk)) map.set(pk, Object.fromEntries(METRIC_FIELDS.map(f => [f, 0])));
                const agg = map.get(pk);
                for (const f of METRIC_FIELDS) agg[f] += (entry[f] || 0);
            }
        }
        return map;
    };

    return {
        totals,
        by_ide:           sumBreakdown('totals_by_ide',              e => e.ide),
        by_feature:       sumBreakdown('totals_by_feature',          e => e.feature),
        by_lang_feature:  sumBreakdown('totals_by_language_feature', e => `${e.language}\u256a${e.feature}`),
        by_lang_model:    sumBreakdown('totals_by_language_model',   e => `${e.language}\u256a${e.model}`),
        by_model_feature: sumBreakdown('totals_by_model_feature',    e => `${e.model}\u256a${e.feature}`),
    };
}

// ── Org print helpers ─────────────────────────────────────────────────────
function fmtDiff(user, org) {
    const diff = user - org;
    const pct  = org !== 0 ? (diff / org * 100).toFixed(1) : (user !== 0 ? '\u221e' : '0.0');
    const sign = diff >= 0 ? '+' : '';
    return `${sign}${diff} (${sign}${pct}%)`;
}

function printScalarRow(label, user, org) {
    console.log(
        `  ${label.padEnd(42)}` +
        `${String(user).padStart(10)}` +
        `${String(org).padStart(10)}` +
        `${fmtDiff(user, org).padStart(20)}`
    );
}

function printBreakdownCompare(title, userMap, orgEntries, pkFn, field) {
    const orgMap = new Map();
    for (const e of (orgEntries || [])) orgMap.set(pkFn(e), e);

    const allKeys = [...new Set([...userMap.keys(), ...orgMap.keys()])].sort();
    console.log(`\n  \u2500\u2500 ${title} ${'\u2500'.repeat(Math.max(0, 52 - title.length))}`);
    console.log(`  ${'Key'.padEnd(40)} ${'User'.padStart(8)} ${'Org'.padStart(8)} ${'Diff'.padStart(18)}`);
    for (const key of allKeys) {
        const u   = userMap.has(key) ? (userMap.get(key)[field] || 0) : null;
        const o   = orgMap.has(key)  ? (orgMap.get(key)[field]  || 0) : null;
        const lbl = key.replace('\u256a', ' / ');
        if (u === null) {
            console.log(`  [ORG ONLY]  ${lbl.slice(0, 29).padEnd(40)} ${'\u2014'.padStart(8)} ${String(o).padStart(8)}`);
        } else if (o === null) {
            console.log(`  [USER ONLY] ${lbl.slice(0, 28).padEnd(40)} ${String(u).padStart(8)} ${'\u2014'.padStart(8)}`);
        } else {
            console.log(`  ${lbl.slice(0, 40).padEnd(40)} ${String(u).padStart(8)} ${String(o).padStart(8)} ${fmtDiff(u, o).padStart(18)}`);
        }
    }
}

// ── org fetch ─────────────────────────────────────────────────────────────
async function orgFetch() {
    if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });

    console.log(`\n\ud83d\udcca Fetching org-level Copilot metrics for: ${ORG}`);
    console.log('\u2500'.repeat(60));

    const endpoint = `/orgs/${ORG}/copilot/metrics/reports/organization-28-day/latest`;
    const res = await apiGet(endpoint);

    if (res.status === 404) {
        console.error('\u274c 404 \u2014 no data found. Check org name and token permissions.');
        process.exit(1);
    }
    if (res.status !== 200) {
        console.error(`\u274c API error ${res.status}: ${res.body.slice(0, 300)}`);
        process.exit(1);
    }

    const report = JSON.parse(res.body);
    const { report_start_day, report_end_day, download_links: links } = report;

    console.log(`\ud83d\udcc5 Report range : ${report_start_day} \u2192 ${report_end_day}`);
    console.log(`\ud83d� Download links: ${links?.length ?? 0}`);

    if (!links?.length) {
        console.log('\u26a0\ufe0f  No download links in response \u2014 saving raw API response only.');
        const outPath = path.join(DEBUG_DIR, `org-metrics_${report_start_day}_to_${report_end_day}_report.json`);
        fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
        console.log(`\ud83d\udcbe Saved to data/debug/${path.basename(outPath)}`);
        return;
    }

    let allLines = [];
    for (let i = 0; i < links.length; i++) {
        console.log(`   Downloading file ${i + 1}/${links.length}\u2026`);
        const content = await downloadFile(links[i]);
        const lines = content.split('\n').filter(l => l.trim());
        console.log(`   \u2192 ${lines.length} line(s)`);
        allLines = allLines.concat(lines);
    }
    console.log(`   Total lines: ${allLines.length}`);

    const outPath = path.join(DEBUG_DIR, `org-metrics_${report_start_day}_to_${report_end_day}_raw.json`);
    fs.writeFileSync(outPath, allLines.join('\n') + '\n');
    console.log(`\n\ud83d\udcbe Saved to data/debug/${path.basename(outPath)}`);
    console.log('\n\ud83c\udf89 Done!');
}

// ── org discover ──────────────────────────────────────────────────────────
function orgDiscover() {
    const orgFile = findOrgMetricsFile();
    if (!orgFile) { console.error('\u274c No org-metrics file found. Run: node debug.js org fetch'); process.exit(1); }
    if (!fs.existsSync(DATA_FILE)) { console.error('\u274c data.json not found.'); process.exit(1); }

    console.log('\n\ud83d\udd0d DATA DISCOVERY');
    console.log('\u2500'.repeat(60));
    console.log(`   Org metrics : ${path.basename(orgFile)}`);
    console.log(`   User data   : data/data.json`);

    const user = { ides: new Set(), features: new Set(), languages: new Set(), models: new Set() };
    for (const line of fs.readFileSync(DATA_FILE, 'utf8').split('\n').filter(l => l.trim())) {
        try {
            const r = JSON.parse(line);
            for (const e of (r.totals_by_ide             || [])) user.ides.add(e.ide);
            for (const e of (r.totals_by_feature         || [])) user.features.add(e.feature);
            for (const e of (r.totals_by_language_feature || [])) {
                user.languages.add(e.language); user.features.add(e.feature);
            }
            for (const e of (r.totals_by_language_model  || [])) {
                user.languages.add(e.language); user.models.add(e.model);
            }
            for (const e of (r.totals_by_model_feature   || [])) {
                user.models.add(e.model); user.features.add(e.feature);
            }
        } catch { /* skip */ }
    }

    const org = { ides: new Set(), features: new Set(), languages: new Set(), models: new Set() };
    const orgData = loadOrgMetrics(orgFile);
    for (const day of (orgData.day_totals || [])) {
        for (const e of (day.totals_by_ide             || [])) org.ides.add(e.ide);
        for (const e of (day.totals_by_feature         || [])) org.features.add(e.feature);
        for (const e of (day.totals_by_language_feature || [])) {
            org.languages.add(e.language); org.features.add(e.feature);
        }
        for (const e of (day.totals_by_language_model  || [])) {
            org.languages.add(e.language); org.models.add(e.model);
        }
        for (const e of (day.totals_by_model_feature   || [])) {
            org.models.add(e.model); org.features.add(e.feature);
        }
    }

    function reportDiff(label, userSet, orgSet) {
        const newInOrg  = [...orgSet].filter(v => !userSet.has(v)).sort();
        const newInUser = [...userSet].filter(v => !orgSet.has(v)).sort();
        console.log(`\n  ${label}:`);
        console.log(`    data.json   : ${userSet.size}  \u2192  ${[...userSet].sort().join(', ')}`);
        console.log(`    org-metrics : ${orgSet.size}   \u2192  ${[...orgSet].sort().join(', ')}`);
        if (newInOrg.length)  console.log(`    \u2728 NEW in org (not in user data): ${newInOrg.join(', ')}`);
        else                  console.log(`    \u2705 No new values in org`);
        if (newInUser.length) console.log(`    \u2796 In user data only            : ${newInUser.join(', ')}`);
    }

    reportDiff('IDEs',      user.ides,      org.ides);
    reportDiff('Features',  user.features,  org.features);
    reportDiff('Languages', user.languages, org.languages);
    reportDiff('Models',    user.models,    org.models);

    console.log('\n  Org-level-only scalar fields (not in user records):');
    for (const f of ORG_ONLY_FIELDS) console.log(`    \u2728 ${f}`);
    console.log('\n  User-level-only fields (not in org-level totals):');
    for (const f of ['user_id', 'user_login', 'used_agent', 'used_chat',
                     'last_known_plugin_version (per IDE entry)',
                     'last_known_ide_version (per IDE entry)']) {
        console.log(`    \u2796 ${f}`);
    }
    console.log('\n\ud83c\udf89 Discovery done!');
}

// ── org compare ───────────────────────────────────────────────────────────
function orgCompare(day) {
    const orgFile = findOrgMetricsFile(day);
    if (!orgFile) { console.error('\u274c No org-metrics file found. Run: node debug.js org fetch'); process.exit(1); }

    console.log(`\n\ud83d\udcca DAY COMPARISON: ${day}`);
    console.log('\u2500'.repeat(60));
    console.log(`   Org metrics : ${path.basename(orgFile)}`);

    const orgData = loadOrgMetrics(orgFile);
    const orgDay  = (orgData.day_totals || []).find(d => d.day === day);
    if (!orgDay) { console.error(`\u274c Day ${day} not found in org-metrics file.`); process.exit(1); }

    const userAgg = aggregateUserDay(day);
    if (!userAgg) { console.error(`\u274c No user records for ${day} in data.json.`); process.exit(1); }

    console.log(`   Users in data.json for ${day}: ${userAgg.totals._user_count}`);

    console.log('\n  \u2500\u2500 Org-level-only metrics \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
    for (const f of ORG_ONLY_FIELDS) console.log(`  ${f.padEnd(38)}: ${orgDay[f] ?? '\u2014'}`);

    console.log('\n  \u2500\u2500 Top-level scalar comparison \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
    console.log(`  ${'Field'.padEnd(42)} ${'User sum'.padStart(10)} ${'Org total'.padStart(10)} ${'Diff (user\u2212org)'.padStart(20)}`);
    console.log(`  ${'\u2500'.repeat(84)}`);
    for (const f of METRIC_FIELDS) printScalarRow(f, userAgg.totals[f] || 0, orgDay[f] || 0);

    const BF = 'code_generation_activity_count';
    printBreakdownCompare('totals_by_ide  [code_generation]',
        userAgg.by_ide, orgDay.totals_by_ide, e => e.ide, BF);
    printBreakdownCompare('totals_by_feature  [code_generation]',
        userAgg.by_feature, orgDay.totals_by_feature, e => e.feature, BF);

    const top15 = arr => [...(arr || [])].sort((a, b) => (b[BF] || 0) - (a[BF] || 0)).slice(0, 15);
    printBreakdownCompare('totals_by_language_feature  [code_generation, top 15]',
        userAgg.by_lang_feature, top15(orgDay.totals_by_language_feature),
        e => `${e.language}\u256a${e.feature}`, BF);
    printBreakdownCompare('totals_by_language_model  [code_generation, top 15]',
        userAgg.by_lang_model, top15(orgDay.totals_by_language_model),
        e => `${e.language}\u256a${e.model}`, BF);
    printBreakdownCompare('totals_by_model_feature  [code_generation, top 15]',
        userAgg.by_model_feature, top15(orgDay.totals_by_model_feature),
        e => `${e.model}\u256a${e.feature}`, BF);

    console.log('\n\ud83c\udf89 Comparison done!');
}

// ── Entry point ───────────────────────────────────────────────────────────
function printHelp() {
    console.log('');
    console.log('\ud83d\udcd6 debug.js \u2014 Copilot metrics debug & analysis utility');
    console.log('\u2500'.repeat(60));
    console.log('  User-level verification (re-downloads & compares with data.json):');
    console.log('    node debug.js YYYY-MM-DD             \u2014 re-download one day and compare');
    console.log('    node debug.js latest                 \u2014 re-download last 28 days and compare');
    console.log('');
    console.log('  Org-level metrics:');
    console.log('    node debug.js org fetch              \u2014 download latest 28-day org metrics');
    console.log('    node debug.js org discover           \u2014 compare key vocabulary vs data.json');
    console.log('    node debug.js org compare YYYY-MM-DD \u2014 compare one day totals: user vs org');
    console.log('');
    console.log('Prerequisites:');
    console.log('  .env             \u2014 must contain GITHUB_TOKEN=<your PAT>');
    console.log('  data/config.json \u2014 must contain { "org": "<your-org>" }');
    console.log('');
}

const [,, arg, arg2, arg3] = process.argv;

if (!arg || arg === 'help' || arg === '--help' || arg === '-h') {
    printHelp();
} else if (arg === 'latest') {
    debugLatest().catch(err => { console.error('Fatal:', err); process.exit(1); });
} else if (/^\d{4}-\d{2}-\d{2}$/.test(arg)) {
    debugDay(arg).catch(err => { console.error('Fatal:', err); process.exit(1); });
} else if (arg === 'org') {
    if (arg2 === 'fetch') {
        orgFetch().catch(err => { console.error('Fatal:', err); process.exit(1); });
    } else if (arg2 === 'discover') {
        orgDiscover();
    } else if (arg2 === 'compare' && arg3 && /^\d{4}-\d{2}-\d{2}$/.test(arg3)) {
        orgCompare(arg3);
    } else if (arg2 === 'compare' && !arg3) {
        console.error('\u274c org compare requires a date: node debug.js org compare YYYY-MM-DD');
        process.exit(1);
    } else {
        console.error(`\u274c Unknown org subcommand: ${arg2 || '(none)'}`);
        printHelp();
        process.exit(1);
    }
} else {
    console.error(`\u274c Unknown command: ${arg}`);
    printHelp();
    process.exit(1);
}
