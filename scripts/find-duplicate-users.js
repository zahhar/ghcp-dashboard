'use strict';
const fs = require('fs');
const path = require('path');

const users = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/users.json'), 'utf8'));

function normName(s) {
  if (!s) return '';
  return s.toLowerCase().replace(/[^a-z]/g, ' ').replace(/\s+/g, ' ').trim();
}

function emailUser(email) {
  if (!email) return '';
  return email.split('@')[0].toLowerCase().replace(/[-_.]/g, '');
}

function wordSim(a, b) {
  const wa = new Set(a.split(' ').filter(Boolean));
  const wb = new Set(b.split(' ').filter(Boolean));
  const inter = [...wa].filter(x => wb.has(x)).length;
  const union = new Set([...wa, ...wb]).size;
  return union === 0 ? 0 : inter / union;
}

function stripSuffix(acc) {
  return acc.toLowerCase().replace(/[-_]/g, '').replace(/(external|epam|scor|\d+)$/g, '');
}

const candidates = [];

for (let i = 0; i < users.length; i++) {
  for (let j = i + 1; j < users.length; j++) {
    const a = users[i];
    const b = users[j];
    const reasons = [];

    // 1. Name similarity
    const na = normName(a.name);
    const nb = normName(b.name);
    if (na && nb) {
      const sim = wordSim(na, nb);
      if (sim >= 0.5) {
        reasons.push(`similar name (${Math.round(sim * 100)}%): "${a.name}" / "${b.name}"`);
      }
    }

    // 2. Email username overlap
    const aEmails = (a.emails || []).map(emailUser);
    const bEmails = (b.emails || []).map(emailUser);
    for (const ae of aEmails) {
      for (const be of bEmails) {
        if (!ae || !be) continue;
        if (ae === be) {
          reasons.push(`same email-user: ${ae}`);
        } else if (ae.length > 6 && (ae.includes(be) || be.includes(ae))) {
          reasons.push(`email-user overlap: ${ae} / ${be}`);
        }
      }
    }

    // 3. Account name similarity after stripping suffixes
    for (const aa of a.accounts) {
      for (const ba of b.accounts) {
        const as = stripSuffix(aa);
        const bs = stripSuffix(ba);
        if (as.length > 5 && bs.length > 5 && (as === bs || as.startsWith(bs) || bs.startsWith(as))) {
          reasons.push(`account overlap: ${aa} / ${ba}`);
        }
      }
    }

    if (reasons.length > 0) {
      candidates.push({
        a: { name: a.name, accounts: a.accounts, emails: a.emails },
        b: { name: b.name, accounts: b.accounts, emails: b.emails },
        reasons,
      });
    }
  }
}

candidates.sort((x, y) => y.reasons.length - x.reasons.length);

for (const c of candidates) {
  console.log('---');
  console.log(`A: ${c.a.name || '(no name)'}  ${JSON.stringify(c.a.accounts)}  emails: ${JSON.stringify(c.a.emails || [])}`);
  console.log(`B: ${c.b.name || '(no name)'}  ${JSON.stringify(c.b.accounts)}  emails: ${JSON.stringify(c.b.emails || [])}`);
  console.log(`   => ${c.reasons.join(' | ')}`);
}
console.log(`\nTotal candidates: ${candidates.length}`);
