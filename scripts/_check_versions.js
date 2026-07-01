const fs = require('fs');
const raw = fs.readFileSync('./data/data.json', 'utf8');
// Handle NDJSON or JSON array
let entries;
try { entries = JSON.parse(raw); } catch(e) {
  entries = raw.split('\n').filter(l => l.trim()).map(l => { try { return JSON.parse(l); } catch(e2) { return null; } }).filter(Boolean);
}
if (!Array.isArray(entries)) entries = [entries];

function versionToInt(v) {
  if (!v || typeof v !== 'string') return -1;
  const base = v.split('-')[0];
  const parts = base.split('.').map(p => parseInt(p, 10)).filter(n => !isNaN(n));
  if (!parts.length) return -1;
  const p0 = parts[0] || 0;
  const p1 = parts[1] || 0;
  const p2 = Math.min(parts[2] || 0, 99999);
  return p0 * 100000000000 + p1 * 1000000 + p2;
}

// Collect ALL distinct versions per IDE/plugin
const ideVersions = {};
const pluginVersions = {};
for (const e of entries) {
  if (!Array.isArray(e.totals_by_ide)) continue;
  for (const ti of e.totals_by_ide) {
    if (!ti.ide) continue;
    const ver = ti.last_known_ide_version?.ide_version;
    if (ver) {
      if (!ideVersions[ti.ide]) ideVersions[ti.ide] = new Set();
      ideVersions[ti.ide].add(ver);
    }
    const plugin = ti.last_known_plugin_version?.plugin;
    const pluginVer = ti.last_known_plugin_version?.plugin_version;
    if (plugin && pluginVer) {
      if (!pluginVersions[plugin]) pluginVersions[plugin] = new Set();
      pluginVersions[plugin].add(pluginVer);
    }
  }
}

console.log('IDE versions (sorted by versionToInt desc):');
for (const [ide, vset] of Object.entries(ideVersions).sort()) {
  const sorted = [...vset].sort((a,b) => versionToInt(b) - versionToInt(a));
  const maxInt = versionToInt(sorted[0]);
  console.log(`  ${ide}:`);
  sorted.forEach(v => console.log(`    ${v}  (int=${versionToInt(v)})${versionToInt(v) === maxInt ? '  <-- LATEST' : ''}`));
}
console.log('\nPlugin versions (sorted by versionToInt desc):');
for (const [p, vset] of Object.entries(pluginVersions).sort()) {
  const sorted = [...vset].sort((a,b) => versionToInt(b) - versionToInt(a));
  const maxInt = versionToInt(sorted[0]);
  console.log(`  ${p}:`);
  sorted.forEach(v => console.log(`    ${v}  (int=${versionToInt(v)})${versionToInt(v) === maxInt ? '  <-- LATEST' : ''}`));
}
