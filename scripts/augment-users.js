'use strict';
const fs = require('fs');
const path = require('path');

const usersPath = path.join(__dirname, '../data/users.json');
const newUsersPath = path.join(__dirname, '../data/new_users.json');

const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
const newUsers = JSON.parse(fs.readFileSync(newUsersPath, 'utf8'));

// Build lookup: lowercase account login -> user index
const accountToIdx = new Map();
for (let i = 0; i < users.length; i++) {
  for (const acc of users[i].accounts) {
    accountToIdx.set(acc.toLowerCase(), i);
  }
}

let updated = 0;
let added = 0;

for (const nu of newUsers) {
  const login = nu.login;
  const email = nu.saml_name_id;
  const idx = accountToIdx.get(login.toLowerCase());

  if (idx !== undefined) {
    const u = users[idx];
    if (!u.emails) u.emails = [];
    if (!u.emails.some(e => e.toLowerCase() === email.toLowerCase())) {
      u.emails.push(email);
    }
    updated++;
  } else {
    const entry = {
      accounts: [login],
      name: nu.name || null,
      emails: [email],
      revoked: false,
      team: 'epam',
      role: 'Engineer'
    };
    users.push(entry);
    accountToIdx.set(login.toLowerCase(), users.length - 1);
    added++;
    console.log('NEW:', login, '|', email);
  }
}

fs.writeFileSync(usersPath, JSON.stringify(users, null, 2) + '\n');
console.log(`Done. Updated: ${updated} | Added: ${added}`);
