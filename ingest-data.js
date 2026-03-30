#!/usr/bin/env node

/**
 * ingest-data.js
 *
 * Imports user-provided NDJSON files into data.json without touching the GitHub API.
 *
 * Workflow:
 *   1) Scan data/raw/inbox/ for *.json files
 *   2) Parse each file as NDJSON (one JSON object per line)
 *   3) Merge new records into data/data.json using unique key (user_id + day)
 *   4) Move each processed file to data/raw/processed/
 *
 * Usage:
 *   npm run ingest
 *   node ingest-data.js
 *
 * Drop your NDJSON files into data/raw/inbox/ before running.
 */

const fs = require('fs');
const path = require('path');

// ── Mock-mode guard ─────────────────────────────────────────────────────
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

if (process.env.USE_MOCK_DATA === 'true') {
    console.error('❌ USE_MOCK_DATA=true is set. Refusing to run in mock mode to protect real data.');
    process.exit(1);
}

// ── Paths ───────────────────────────────────────────────────────────────
const DATA_FILE   = path.join(__dirname, 'data', 'data.json');
const INBOX_DIR   = path.join(__dirname, 'data', 'raw', 'inbox');
const DONE_DIR    = path.join(__dirname, 'data', 'raw', 'processed');

// ── Helpers (mirrors update-data.js conventions) ────────────────────────
function getRecordKey(rec) {
    if (!rec || rec.user_id === undefined || !rec.day) return null;
    return `${rec.user_id}:${rec.day}`;
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

function collectExistingKeys(lines) {
    const keys = new Set();
    for (const { rec } of parseNdjsonLines(lines, 'data.json')) {
        const key = getRecordKey(rec);
        if (key) keys.add(key);
    }
    return keys;
}

function prepareMissingLines(candidateLines, existingKeys, label) {
    const missing = [];
    let duplicates = 0;

    for (const { line, rec } of parseNdjsonLines(candidateLines, label)) {
        const key = getRecordKey(rec);
        if (!key) continue;
        if (existingKeys.has(key)) {
            duplicates++;
            continue;
        }
        existingKeys.add(key);
        missing.push(line);
    }

    return { missing, duplicates };
}

// ── Main ────────────────────────────────────────────────────────────────
function main() {
    // Ensure directories exist
    fs.mkdirSync(INBOX_DIR, { recursive: true });
    fs.mkdirSync(DONE_DIR,  { recursive: true });

    // Collect *.json files from inbox
    const files = fs.readdirSync(INBOX_DIR)
        .filter(f => f.toLowerCase().endsWith('.json'))
        .sort();

    if (files.length === 0) {
        console.log('📭 No files found in data/raw/inbox/. Nothing to ingest.');
        console.log('   Drop your NDJSON files there and re-run npm run ingest.');
        return;
    }

    console.log(`📂 Found ${files.length} file(s) in data/raw/inbox/`);

    // Load existing state once (updated in-memory as we go)
    const existingLines = readDataFileLines(DATA_FILE);
    const existingKeys  = collectExistingKeys(existingLines);
    console.log(`📊 data.json currently holds ${existingKeys.size} unique record(s)`);

    let totalNew   = 0;
    let totalDupes = 0;

    for (const filename of files) {
        const srcPath  = path.join(INBOX_DIR, filename);
        const destPath = path.join(DONE_DIR,  filename);

        console.log(`\n📄 Processing: ${filename}`);

        const raw   = fs.readFileSync(srcPath, 'utf8');
        const lines = raw.split('\n').filter(l => l.trim());
        console.log(`   Lines found: ${lines.length}`);

        const { missing, duplicates } = prepareMissingLines(lines, existingKeys, filename);

        if (missing.length > 0) {
            // Ensure data.json ends with a newline before appending
            const appendData = '\n' + missing.join('\n') + '\n';
            fs.appendFileSync(DATA_FILE, appendData);
        }

        totalNew   += missing.length;
        totalDupes += duplicates;

        console.log(`   ✅ Imported: ${missing.length} new record(s), ${duplicates} duplicate(s) skipped`);

        // Resolve name conflict in processed/ by appending a counter suffix
        let finalDest = destPath;
        if (fs.existsSync(finalDest)) {
            const ext  = path.extname(filename);
            const base = path.basename(filename, ext);
            let counter = 1;
            while (fs.existsSync(finalDest)) {
                finalDest = path.join(DONE_DIR, `${base}_${counter}${ext}`);
                counter++;
            }
        }

        fs.renameSync(srcPath, finalDest);
        console.log(`   📦 Moved to: data/raw/processed/${path.basename(finalDest)}`);
    }

    console.log(`\n🎉 Ingest complete: +${totalNew} new record(s) added, ${totalDupes} duplicate(s) skipped across ${files.length} file(s).`);
}

main();
