#!/usr/bin/env node

/**
 * update-data.js
 *
 * Fetches Copilot usage metrics with a resilient, gap-aware strategy:
 *   1) Pull latest 28-day data from users-28-day/latest
 *   2) Merge into data.json by unique key (user_id + day)
 *   3) Detect calendar gaps and try per-day backfill (users-1-day)
 *   4) Persist unresolved gaps in config.missing_data_days for catch-up
 *
 * Downloads raw NDJSON files to /data/raw, appends only missing entries
 * to data.json, and updates config.json.
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

function dateRange(startDay, endDay) {
    const out = [];
    let current = startDay;
    while (current <= endDay) {
        out.push(current);
        current = addDays(current, 1);
    }
    return out;
}

function uniqueSortedDates(days) {
    return [...new Set((days || []).filter(Boolean))].sort();
}

function getRecordKey(rec) {
    if (!rec || rec.user_id === undefined || !rec.day) return null;
    return `${rec.user_id}:${rec.day}`;
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

async function fetchLatestReport() {
    const url = `https://api.github.com/orgs/${ORG}/copilot/metrics/reports/users-28-day/latest`;
    const res = await httpsGet(url, {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${TOKEN}`,
        'X-GitHub-Api-Version': '2026-03-10'
    });

    if (res.status === 404) {
        console.log('  ⚠️  No latest 28-day report (404)');
        return null;
    }
    if (res.status !== 200) {
        console.error(`  ❌ API error for latest report: HTTP ${res.status}`);
        console.error(`     ${res.body.slice(0, 300)}`);
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

async function downloadLinks(links) {
    let allLines = [];
    for (let i = 0; i < links.length; i++) {
        const content = await downloadFile(links[i]);
        const lines = content.split('\n').filter(l => l.trim());
        allLines = allLines.concat(lines);
    }
    return allLines;
}

function readDataFileLines(filePath) {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim());
}

function parseNdjsonLines(lines, label) {
    const parsed = [];
    for (const line of lines) {
        try {
            const rec = JSON.parse(line);
            if (rec.user_login) rec.user_login = rec.user_login.toLowerCase();
            parsed.push({ line: JSON.stringify(rec), rec });
        } catch {
            console.log(`  ⚠️  Skipping unparseable line in ${label}: ${line.slice(0, 100)}…`);
        }
    }
    return parsed;
}

function collectExistingDataState(lines) {
    const existingKeys = new Set();
    let maxDay = null;

    for (const { rec } of parseNdjsonLines(lines, 'data.json')) {
        const key = getRecordKey(rec);
        if (key) existingKeys.add(key);
        if (rec.day && (!maxDay || rec.day > maxDay)) maxDay = rec.day;
    }

    return { existingKeys, maxDay };
}

function getDaysWithData(lines) {
    const days = new Set();
    for (const { rec } of parseNdjsonLines(lines, 'downloaded data')) {
        if (rec.day) days.add(rec.day);
    }
    return days;
}

function prepareMissingLines(candidateLines, existingKeys) {
    const missingLines = [];
    let duplicates = 0;

    for (const { line, rec } of parseNdjsonLines(candidateLines, 'candidate lines')) {
        const key = getRecordKey(rec);
        if (!key) continue;
        if (existingKeys.has(key)) {
            duplicates++;
            continue;
        }
        existingKeys.add(key);
        missingLines.push({ line, day: rec.day });
    }

    return { missingLines, duplicates };
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
    if (!Array.isArray(config.missing_data_days)) {
        config.missing_data_days = [];
    }

    const lastDay = config.last_report_day;
    const yesterday = getYesterday();

    console.log(`📊 Last report day: ${lastDay}`);
    console.log(`📅 Yesterday:       ${yesterday}`);
    if (config.missing_data_days.length) {
        console.log(`🕳️  Tracked missing days: ${config.missing_data_days.join(', ')}`);
    }

    // Ensure /data/raw directory exists
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    const latestReport = await fetchLatestReport();
    if (!latestReport || !latestReport.download_links || latestReport.download_links.length === 0) {
        console.log('⚠️  Latest endpoint returned no data links.');

        const unresolved = uniqueSortedDates(
            config.missing_data_days.filter(d => d <= yesterday)
        );
        config.missing_data_days = unresolved;
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');

        console.log(`📝 Updated missing_data_days (${unresolved.length}) in config.`);
        console.log('🎉 Done!');
        return;
    }

    const reportStart = latestReport.report_start_day;
    const reportEnd = latestReport.report_end_day;
    const latestLinks = latestReport.download_links;

    console.log(`📥 Latest report range: ${reportStart} → ${reportEnd}`);
    console.log(`🔗 Latest report files: ${latestLinks.length}`);

    const latestLines = await downloadLinks(latestLinks);
    console.log(`✅ Downloaded ${latestLines.length} line(s) from latest endpoint`);

    const latestRawPath = path.join(DATA_DIR, `${reportStart}_to_${reportEnd}_latest_raw.json`);
    fs.writeFileSync(latestRawPath, latestLines.join('\n') + '\n');
    console.log(`💾 Saved raw latest report to data/raw/${path.basename(latestRawPath)}`);

    const existingDataLines = readDataFileLines(DATA_FILE);
    const { existingKeys, maxDay: maxDayInData } = collectExistingDataState(existingDataLines);

    const latestMerge = prepareMissingLines(latestLines, existingKeys);
    if (latestMerge.missingLines.length > 0) {
        const appendData = '\n' + latestMerge.missingLines.map(x => x.line).join('\n') + '\n';
        fs.appendFileSync(DATA_FILE, appendData);
    }

    console.log(`🧩 Latest merge: +${latestMerge.missingLines.length} new line(s), ${latestMerge.duplicates} duplicate key(s) skipped`);

    const daysWithLatestData = getDaysWithData(latestLines);
    const windowDays = dateRange(reportStart, yesterday);
    const gapsFromLatest = windowDays.filter(day => !daysWithLatestData.has(day));

    const carryMissingDays = (config.missing_data_days || []).filter(day => day <= yesterday);
    const backfillCandidates = uniqueSortedDates([...gapsFromLatest, ...carryMissingDays]);

    if (backfillCandidates.length > 0) {
        console.log(`\n🛠️  Backfill candidates (${backfillCandidates.length}): ${backfillCandidates.join(', ')}`);
    } else {
        console.log('\n✅ No missing-day gaps detected after latest sync');
    }

    const unresolvedMissing = [];
    let backfillAdded = 0;
    let backfillDuplicate = 0;

    for (const day of backfillCandidates) {
        process.stdout.write(`  ${day}... `);

        const report = await fetchReportLinks(day);
        if (!report || !report.download_links || report.download_links.length === 0) {
            console.log('no data');
            unresolvedMissing.push(day);
            continue;
        }

        const dayLines = await downloadLinks(report.download_links);

        // Save raw file
        const rawPath = path.join(DATA_DIR, `${day}_raw.json`);
        fs.writeFileSync(rawPath, dayLines.join('\n') + '\n');

        const dayMerge = prepareMissingLines(dayLines, existingKeys);
        backfillAdded += dayMerge.missingLines.length;
        backfillDuplicate += dayMerge.duplicates;

        if (dayMerge.missingLines.length > 0) {
            const appendData = '\n' + dayMerge.missingLines.map(x => x.line).join('\n') + '\n';
            fs.appendFileSync(DATA_FILE, appendData);
        }

        console.log(`✅ ${dayLines.length} entries (${dayMerge.missingLines.length} new, ${dayMerge.duplicates} duplicate)`);
    }

    console.log(`\n📝 Backfill merge: +${backfillAdded} new line(s), ${backfillDuplicate} duplicate key(s) skipped`);

    const refreshedLines = readDataFileLines(DATA_FILE);
    const { maxDay: refreshedMaxDay } = collectExistingDataState(refreshedLines);
    const nextLastReportDay = refreshedMaxDay || maxDayInData || lastDay;

    if (nextLastReportDay > lastDay) {
        config.last_report_day = nextLastReportDay;
        console.log(`✅ Updated last_report_day to ${nextLastReportDay}`);
    }

    config.missing_data_days = uniqueSortedDates(unresolvedMissing);
    if (config.missing_data_days.length > 0) {
        console.log(`🕳️  Still missing (${config.missing_data_days.length}): ${config.missing_data_days.join(', ')}`);
    } else {
        console.log('✅ No unresolved missing days');
    }

    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');

    console.log('\n🎉 Done!');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
