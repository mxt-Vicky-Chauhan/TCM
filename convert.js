/**
 * convert.js — Run this whenever TCM.xlsx is updated:
 *   node convert.js
 *
 * Reads TCM.xlsx and writes tcmv2.json so the server
 * never needs to parse Excel at runtime.
 */

const XLSX = require('xlsx');
const fs   = require('fs');
const path = require('path');

const EXCEL_PATH = path.join(__dirname, 'TCM.xlsx');
const JSON_PATH  = path.join(__dirname, 'tcmv2.json');
const NON_TEAM_SHEETS = new Set(['Instructions', 'Summary', 'BaseData']);

if (!fs.existsSync(EXCEL_PATH)) {
  console.error('TCM.xlsx not found');
  process.exit(1);
}

console.log('Reading TCM.xlsx...');
const wb = XLSX.readFile(EXCEL_PATH);

// ── BaseData ──────────────────────────────────────────────────────────────────
function parseBaseData() {
  const ws = wb.Sheets['BaseData'];
  if (!ws) return {};
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const map  = {};
  for (let i = 1; i < rows.length; i++) {
    const name = String(rows[i][0] || '').trim();
    const id   = String(rows[i][1] || '').trim();
    if (name && id) map[name] = id;
  }
  return map;
}

// ── Team sheet ────────────────────────────────────────────────────────────────
function parseTeamSheet(ws) {
  const rows  = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const stats = { total: 0, scheduled: 0, newCases: 0 };
  let release = '';

  for (let i = 0; i < Math.min(6, rows.length); i++) {
    const r     = rows[i];
    const label = String(r[5] || '').trim();
    const value = r[6];
    if (/total test cases/i.test(label))  stats.total     = Number(value) || 0;
    if (/schedule\? y/i.test(label))      stats.scheduled = Number(value) || 0;
    if (/new test cases/i.test(label))    stats.newCases  = Number(value) || 0;
    if (r[5] && /^\d{4}_Week_\d+$/.test(String(r[5]).trim())) release = String(r[5]).trim();
    if (r[7] && /^\d{4}_Week_\d+$/.test(String(r[7]).trim())) release = String(r[7]).trim();
  }

  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === 'Key') { headerIdx = i; break; }
  }
  if (headerIdx === -1) return { stats, tickets: [], release };

  const tickets = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r   = rows[i];
    const key = String(r[0] || '').trim();
    if (!key || !/^[A-Z]+-\d+$/.test(key)) continue;
    tickets.push({
      key,
      summary:           String(r[1]  || '').trim(),
      priority:          String(r[2]  || '').trim(),
      component:         String(r[3]  || '').trim(),
      epicLink:          String(r[4]  || '').trim(),
      assignee:          String(r[5]  || '').trim(),
      estimate:          String(r[6]  || '').trim(),
      scheduled:         String(r[7]  || '').trim().toUpperCase(),
      executionPriority: String(r[8]  || '').trim(),
      executionBy:       String(r[9]  || '').trim(),
      testResultTicket:  String(r[10] || '').trim(),
      comments:          String(r[11] || '').trim(),
    });
  }
  return { stats, tickets, release };
}

// ── Build output ──────────────────────────────────────────────────────────────
const baseData = parseBaseData();
const teams    = [];

for (const name of wb.SheetNames) {
  if (NON_TEAM_SHEETS.has(name)) continue;
  try {
    const d = parseTeamSheet(wb.Sheets[name]);
    teams.push({ name, stats: d.stats, release: d.release, tickets: d.tickets });
    console.log(`  ✓ ${name} — ${d.tickets.length} tickets`);
  } catch (e) {
    console.warn(`  ✗ Skipped "${name}": ${e.message}`);
  }
}

const output = { generatedAt: new Date().toISOString(), baseData, teams };
fs.writeFileSync(JSON_PATH, JSON.stringify(output, null, 2));
console.log(`\nDone → tcmv2.json (${teams.length} teams, ${Object.keys(baseData).length} members)`);
