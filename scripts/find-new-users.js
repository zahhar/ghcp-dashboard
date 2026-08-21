#!/usr/bin/env node

/**
 * find-new-users.js
 *
 * Scans data.json for user_login values matching known patterns:
 *   - ends with "-external"
 *   - starts with "u" followed by digits
 *   - ends with "_epam"
 *
 * Prints any logins NOT already listed in users.json accounts as
 * "Potential new users" candidates. Does not modify any files.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_FILE = path.join(ROOT_DIR, 'data', 'data.json');
const USERS_FILE = path.join(ROOT_DIR, 'data', 'users.json');

const PATTERNS = [
    /^.+-external$/,
    /^u\d+$/,
    /^.+_epam$/,
];

function matchesPattern(login) {
    return PATTERNS.some(p => p.test(login));
}

function run() {
    if (!fs.existsSync(DATA_FILE)) {
        console.warn('⚠️  data.json not found, skipping new-user scan');
        return;
    }
    if (!fs.existsSync(USERS_FILE)) {
        console.warn('⚠️  users.json not found, skipping new-user scan');
        return;
    }

    // Build the set of all known accounts from users.json
    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    const knownAccounts = new Set(
        users.flatMap(u => (u.accounts || []).map(a => a.trim().toLowerCase()))
    );

    // Scan data.json (NDJSON) for matching logins not in knownAccounts
    const lines = fs.readFileSync(DATA_FILE, 'utf8').split('\n');
    const candidates = new Set();

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let rec;
        try { rec = JSON.parse(trimmed); } catch { continue; }
        const login = rec.user_login;
        if (!login) continue;
        const loginNorm = login.trim().toLowerCase();
        if (matchesPattern(loginNorm) && !knownAccounts.has(loginNorm)) {
            candidates.add(login.trim());
        }
    }

    if (candidates.size === 0) return;

    const sorted = [...candidates].sort();
    console.log('\n' + '═'.repeat(60));
    console.log('🔍✨  POTENTIAL NEW USERS DETECTED  ✨🔍');
    console.log('   The following logins appear in data.json but are');
    console.log('   NOT listed in users.json. Consider adding them:');
    console.log('─'.repeat(60));
    for (const login of sorted) {
        console.log(`   👤  ${login}`);
    }
    console.log('═'.repeat(60) + '\n');
}

run();
