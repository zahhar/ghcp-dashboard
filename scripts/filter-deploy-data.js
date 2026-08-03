#!/usr/bin/env node
'use strict';

// Produces a filtered copy of data.json for deployment only. Enterprises (or orgs) with
// filter_to_known_users=true keep only records whose user_login is a known account in
// users.json; everything else passes through unchanged. The source data.json is never modified.
//
// Usage: node filter-deploy-data.js <sourceRoot> <outputPath>

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const [sourceRoot, outputPath] = process.argv.slice(2);
if (!sourceRoot || !outputPath) {
    console.error('Usage: node filter-deploy-data.js <sourceRoot> <outputPath>');
    process.exit(1);
}

const configPath = path.join(sourceRoot, 'data', 'config.json');
const usersPath = path.join(sourceRoot, 'data', 'users.json');
const dataPath = path.join(sourceRoot, 'data', 'data.json');

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));

// Known logins across all accounts (case-insensitive), matching server.js's loginToUser lookup.
const knownLogins = new Set();
for (const user of users) {
    if (!Array.isArray(user.accounts)) continue;
    for (const login of user.accounts) {
        if (login) knownLogins.add(String(login).toLowerCase());
    }
}

// Mirrors server.js's scope resolution: org-level flag overrides enterprise-level; otherwise inherit.
const enterpriseFilterMap = {};
const orgFilterMap = {};
if (Array.isArray(config.enterprises)) {
    for (const e of config.enterprises) {
        if (e.id != null) enterpriseFilterMap[String(e.id)] = e.filter_to_known_users === true;
        if (Array.isArray(e.organizations)) {
            for (const o of e.organizations) {
                if (o.id == null) continue;
                const orgFilterValue = o.filter_to_known_users;
                const entFilterValue = e.filter_to_known_users;
                orgFilterMap[String(o.id)] = orgFilterValue === true || (orgFilterValue !== false && entFilterValue === true);
            }
        }
    }
}

function shouldKeep(entry) {
    const organizationId = entry.organization_id != null ? String(entry.organization_id) : null;
    const enterpriseId = entry.enterprise_id != null ? String(entry.enterprise_id) : null;

    const shouldFilter = organizationId && organizationId in orgFilterMap
        ? orgFilterMap[organizationId]
        : (enterpriseId && enterpriseId in enterpriseFilterMap
            ? enterpriseFilterMap[enterpriseId]
            : false);

    if (!shouldFilter) return true;
    const login = entry.user_login ? String(entry.user_login).toLowerCase() : null;
    return login != null && knownLogins.has(login);
}

async function run() {
    const rl = readline.createInterface({
        input: fs.createReadStream(dataPath, 'utf8'),
        crlfDelay: Infinity
    });
    const out = fs.createWriteStream(outputPath, { encoding: 'utf8' });

    let total = 0;
    let kept = 0;

    for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        total++;

        let entry;
        try {
            entry = JSON.parse(trimmed);
        } catch (e) {
            // Unparsable line: pass through rather than silently dropping data.
            out.write(line + '\n');
            kept++;
            continue;
        }

        if (shouldKeep(entry)) {
            out.write(line + '\n');
            kept++;
        }
    }

    await new Promise((resolve, reject) => {
        out.end(err => (err ? reject(err) : resolve()));
    });

    console.error(`📊 Deploy data filter: kept ${kept}/${total} records (${total - kept} removed via filter_to_known_users)`);
}

run().catch(err => {
    console.error('Failed to filter deploy data:', err);
    process.exit(1);
});
