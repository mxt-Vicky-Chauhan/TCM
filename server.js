const express = require('express');
const axios   = require('axios');
const path    = require('path');
const XLSX    = require('xlsx');
const fs      = require('fs');

const app  = express();
const PORT = 3000;
const EXCEL_PATH = path.join(__dirname, 'TCM.xlsx');
const NON_TEAM_SHEETS = new Set(['Instructions', 'Summary', 'BaseData', 'Template']);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Excel helpers ────────────────────────────────────────────────────────────

function loadWorkbook() {
  if (!fs.existsSync(EXCEL_PATH)) throw new Error('TCM.xlsx not found');
  return XLSX.readFile(EXCEL_PATH);
}

function parseTeamSheet(ws) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const stats = { total: 0, scheduled: 0, newCases: 0 };
  let apiToken = '', release = '';

  for (let i = 0; i < Math.min(6, rows.length); i++) {
    const r = rows[i];
    const label = String(r[5] || '').trim();
    const value = r[6];
    if (/total test cases/i.test(label))  stats.total     = Number(value) || 0;
    if (/schedule\? y/i.test(label))      stats.scheduled = Number(value) || 0;
    if (/new test cases/i.test(label))    stats.newCases  = Number(value) || 0;
    const tokenLabel = String(r[4] || '').trim();
    if (/api\s*token|token/i.test(tokenLabel) && r[5]) apiToken = String(r[5]).trim();
    if (r[5] && /^\d{4}_Week_\d+$/.test(String(r[5]).trim())) release = String(r[5]).trim();
    if (r[7] && /^\d{4}_Week_\d+$/.test(String(r[7]).trim())) release = String(r[7]).trim();
  }

  // Find header row where col 0 = "Key"
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === 'Key') { headerIdx = i; break; }
  }
  if (headerIdx === -1) return { stats, tickets: [], apiToken, release };

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
  return { stats, tickets, apiToken, release };
}

function parseBaseData(wb) {
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

// ─── API: Teams list ──────────────────────────────────────────────────────────

app.get('/api/teams', (req, res) => {
  try {
    const wb    = loadWorkbook();
    const teams = wb.SheetNames
      .filter(n => !NON_TEAM_SHEETS.has(n))
      .map(name => {
        const d = parseTeamSheet(wb.Sheets[name]);
        return {
          name,
          total:     d.stats.total,
          scheduled: d.stats.scheduled,
          pending:   d.stats.total - d.stats.scheduled,
          release:   d.release
        };
      });
    res.json(teams);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Team tickets ────────────────────────────────────────────────────────

app.get('/api/teams/:name', (req, res) => {
  try {
    const wb       = loadWorkbook();
    const ws       = wb.Sheets[req.params.name];
    if (!ws) return res.status(404).json({ error: 'Team not found' });
    const parsed   = parseTeamSheet(ws);
    const baseData = parseBaseData(wb);
    res.json({ ...parsed, baseData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Schedule (create JIRA sub-tasks) ────────────────────────────────────

app.post('/api/schedule', async (req, res) => {
  const { email, apiToken, baseUrl, tickets } = req.body;
  if (!email || !apiToken || !baseUrl)
    return res.status(400).json({ error: 'email, apiToken and baseUrl are required' });
  if (!tickets || !tickets.length)
    return res.status(400).json({ error: 'No tickets to schedule' });

  const creds   = Buffer.from(`${email}:${apiToken}`).toString('base64');
  const headers = { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json', Accept: 'application/json' };
  const results = [];

  for (const t of tickets) {
    const release = req.body.release || 'N/A';

    // Fetch parent ticket description from JIRA
    let parentDescription = null;
    try {
      const parent = await axios.get(`${baseUrl}/rest/api/3/issue/${t.key}?fields=description`, { headers });
      parentDescription = parent.data?.fields?.description || null;
    } catch (e) {
      console.warn(`Could not fetch description for ${t.key}:`, e.message);
    }

    const fields = {
      project:     { key: t.projectKey },
      summary:     `Test Result for ${t.summary} - Release ${release}`,
      issuetype:   { name: 'Sub-task' },
      parent:      { key: t.key },
      duedate:     req.body.dueDate || null,
      description: parentDescription || {
        type: 'doc', version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: `Test result for ${t.key} — Release: ${release}` }] }]
      }
    };
    if (t.assigneeId) fields.assignee = { accountId: t.assigneeId };

    try {
      const { data } = await axios.post(`${baseUrl}/rest/api/3/issue`, { fields }, { headers });
      results.push({ key: t.key, created: data.key, success: true });
    } catch (err) {
      const jiraErr = err.response?.data;
      const msg = jiraErr?.errorMessages?.[0]
        || (jiraErr?.errors ? JSON.stringify(jiraErr.errors) : null)
        || err.message;
      console.error(`Failed ${t.key}:`, JSON.stringify(jiraErr || err.message));
      results.push({ key: t.key, success: false, error: msg });
    }
  }
  res.json(results);
});

function mapPriority(p) {
  return { P1:'Highest', P2:'High', P3:'Medium', P4:'Low', P5:'Lowest' }[p] || p || 'Medium';
}
function parseEstimate(est) {
  const s = String(est); let secs = 0;
  const h = s.match(/(\d+(?:\.\d+)?)\s*h/i);
  const m = s.match(/(\d+(?:\.\d+)?)\s*m/i);
  if (h) secs += parseFloat(h[1]) * 3600;
  if (m) secs += parseFloat(m[1]) * 60;
  if (!h && !m) secs = parseFloat(s) * 3600;
  return Math.round(secs) || undefined;
}

app.listen(PORT, () => console.log(`Regression Manager → http://localhost:${PORT}`));
