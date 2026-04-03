/* ── Config ────────────────────────────────────────────────────────────────── */
const JIRA_BASE_URL = 'https://maxxton.atlassian.net';

/* ── State ─────────────────────────────────────────────────────────────────── */
let allTeams      = [];
let currentTeam   = null;
let teamTickets   = [];
let baseData      = {};
let dtInstance    = null;
let schedModal    = null;
let activeFilter  = 'all';

/* ── Init ──────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  schedModal = new bootstrap.Modal(document.getElementById('scheduleModal'));


  loadTeams();
  bindEvents();
});

/* ── Load teams (landing) ──────────────────────────────────────────────────── */
async function loadTeams() {
  document.getElementById('teamsGrid').innerHTML = `
    <div class="col-12 text-center py-5">
      <div class="spinner-border text-primary"></div>
      <p class="mt-2 text-muted">Reading TCM.xlsx...</p>
    </div>`;

  try {
    const res   = await fetch('/api/teams');
    allTeams    = await res.json();

    // Global stats
    const total     = allTeams.reduce((s, t) => s + t.total, 0);
    const scheduled = allTeams.reduce((s, t) => s + t.scheduled, 0);
    document.getElementById('gTotal').textContent     = total;
    document.getElementById('gScheduled').textContent = scheduled;
    document.getElementById('gPending').textContent   = total - scheduled;
    document.getElementById('gTeams').textContent     = allTeams.length;

    // Team cards
    document.getElementById('teamsGrid').innerHTML = allTeams.map(t => {
      const pct = t.total > 0 ? Math.round((t.scheduled / t.total) * 100) : 0;
      return `
        <div class="col-12 col-sm-6 col-md-4 col-lg-3">
          <div class="team-card" data-team="${t.name}">
            <div class="team-card-header d-flex align-items-center justify-content-between mb-3">
              <div class="team-icon"><i class="bi bi-people-fill"></i></div>
              ${t.pending > 0
                ? `<span class="badge bg-warning-subtle text-warning fw-semibold">${t.pending} pending</span>`
                : `<span class="badge bg-success-subtle text-success fw-semibold"><i class="bi bi-check-circle me-1"></i>Done</span>`
              }
            </div>
            <h6 class="fw-bold mb-1">${t.name}</h6>
            ${t.release ? `<div class="text-muted small mb-3"><i class="bi bi-tag me-1"></i>${t.release}</div>` : '<div class="mb-3"></div>'}
            <div class="progress team-progress mb-2" style="height:6px">
              <div class="progress-bar bg-success" style="width:${pct}%"></div>
            </div>
            <div class="d-flex justify-content-between small text-muted">
              <span><span class="fw-semibold text-dark">${t.scheduled}</span> scheduled</span>
              <span><span class="fw-semibold text-dark">${t.total}</span> total</span>
            </div>
          </div>
        </div>`;
    }).join('');

    // Click handlers
    document.querySelectorAll('.team-card').forEach(card => {
      card.addEventListener('click', () => openTeam(card.dataset.team));
    });

  } catch (err) {
    document.getElementById('teamsGrid').innerHTML =
      `<div class="col-12"><div class="alert alert-danger">Error loading teams: ${err.message}</div></div>`;
  }
}

/* ── Open team view ────────────────────────────────────────────────────────── */
async function openTeam(teamName) {
  currentTeam = teamName;
  document.getElementById('landingSection').classList.add('d-none');
  document.getElementById('teamSection').classList.remove('d-none');
  document.getElementById('teamTitle').textContent = teamName;
  document.getElementById('teamRelease').textContent = '';
  document.getElementById('teamLoader').classList.remove('d-none');
  document.getElementById('teamTableWrapper').classList.add('d-none');
  if (dtInstance) { dtInstance.destroy(); dtInstance = null; }
  clearSelection();

  try {
    const res  = await fetch(`/api/teams/${encodeURIComponent(teamName)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    teamTickets = data.tickets;
    baseData    = data.baseData || {};
    activeFilter = 'all';
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === 'all'));

    // Stats
    document.getElementById('tTotal').textContent     = data.stats.total;
    document.getElementById('tScheduled').textContent = data.stats.scheduled;
    document.getElementById('tPending').textContent   = data.stats.total - data.stats.scheduled;
    document.getElementById('tRelease').textContent   = data.release || '—';
    document.getElementById('teamRelease').textContent = data.release ? `Release: ${data.release}` : '';

    // Pre-fill release in modal
    if (data.release) document.getElementById('schedRelease').value = data.release;

    renderTable(teamTickets);

  } catch (err) {
    document.getElementById('teamLoader').classList.add('d-none');
    document.getElementById('teamTableWrapper').innerHTML =
      `<div class="alert alert-danger m-3">Error: ${err.message}</div>`;
    document.getElementById('teamTableWrapper').classList.remove('d-none');
  }
}

/* ── Render table ──────────────────────────────────────────────────────────── */
function renderTable(tickets) {
  document.getElementById('teamLoader').classList.remove('d-none');
  document.getElementById('teamTableWrapper').classList.add('d-none');

  const jiraBase = JIRA_BASE_URL;
  const tbody    = document.getElementById('ticketsBody');

  tbody.innerHTML = tickets.map(t => {
    const isScheduled = t.scheduled === 'Y';
    return `
      <tr data-key="${t.key}" class="${isScheduled ? 'row-scheduled' : ''}">
        <td class="text-center align-middle">
          <input type="checkbox" class="form-check-input row-check" data-key="${t.key}" style="cursor:pointer"/>
        </td>
        <td>
          <a class="key-link" href="${jiraBase}/browse/${t.key}" target="_blank">${t.key}</a>
        </td>
        <td class="summary-cell" title="${escHtml(t.summary)}">${escHtml(t.summary)}</td>
        <td>${priorityBadge(t.priority)}</td>
        <td class="small text-muted">${escHtml(t.component) || '—'}</td>
        <td>
          ${t.epicLink
            ? `<a class="key-link" href="${jiraBase}/browse/${t.epicLink}" target="_blank">${t.epicLink}</a>`
            : '<span class="text-muted">—</span>'}
        </td>
        <td class="assignee-cell small" data-key="${t.key}">
          <span class="assignee-display editable-field" title="Click to change assignee">${escHtml(t.assignee) || '—'}</span>
          <select class="assignee-select form-select form-select-sm d-none" style="min-width:140px"></select>
        </td>
        <td class="estimate-cell" data-key="${t.key}">
          <span class="estimate-display">${t.estimate || '—'}</span>
          <input class="estimate-input form-control form-control-sm d-none" value="${t.estimate || ''}" style="width:80px"/>
        </td>
        <td class="text-center">
          <span class="schedule-toggle ${isScheduled ? 'sched-done' : 'sched-pending'} sched-badge"
            data-key="${t.key}" data-value="${t.scheduled || 'N'}" style="cursor:pointer" title="Click to toggle">
            ${isScheduled ? '<i class="bi bi-check-circle-fill me-1"></i>Y' : 'N'}
          </span>
        </td>
        <td>${t.executionPriority ? priorityBadge(t.executionPriority) : '<span class="text-muted">—</span>'}</td>
        <td class="small">${escHtml(t.executionBy) || '—'}</td>
        <td>
          ${t.testResultTicket
            ? `<a class="key-link" href="${jiraBase}/browse/${t.testResultTicket}" target="_blank">${t.testResultTicket}</a>`
            : '<span class="text-muted">—</span>'}
        </td>
        <td class="comment-cell small text-muted" title="${escHtml(t.comments)}">${escHtml(t.comments) || '—'}</td>
      </tr>`;
  }).join('');

  if (dtInstance) { dtInstance.destroy(); dtInstance = null; }
  dtInstance = $('#ticketsTable').DataTable({
    pageLength: 25,
    order:      [],
    columnDefs: [{ orderable: false, targets: [0, 7, 8] }],
    language:   { search: 'Filter:', emptyTable: 'No tickets found' }
  });

  document.getElementById('teamLoader').classList.add('d-none');
  document.getElementById('teamTableWrapper').classList.remove('d-none');

  // Checkbox change handlers
  document.querySelectorAll('.row-check').forEach(cb => {
    cb.addEventListener('change', updateSelection);
  });

  // ── Schedule? toggle (Y ↔ N) ──────────────────────────────────────────────
  document.querySelectorAll('.schedule-toggle').forEach(badge => {
    badge.addEventListener('click', () => {
      const key     = badge.dataset.key;
      const current = badge.dataset.value;
      const next    = current === 'Y' ? 'N' : 'Y';

      // Update local data
      const ticket = teamTickets.find(t => t.key === key);
      if (ticket) ticket.scheduled = next;

      // Update badge
      badge.dataset.value = next;
      if (next === 'Y') {
        badge.className = 'schedule-toggle sched-done sched-badge';
        badge.style.cursor = 'pointer';
        badge.title = 'Click to toggle';
        badge.innerHTML = '<i class="bi bi-check-circle-fill me-1"></i>Y';
        badge.closest('tr').classList.add('row-scheduled');
      } else {
        badge.className = 'schedule-toggle sched-pending sched-badge';
        badge.style.cursor = 'pointer';
        badge.title = 'Click to toggle';
        badge.innerHTML = 'N';
        badge.closest('tr').classList.remove('row-scheduled');
      }
    });
  });

  // ── Test Case Assignee inline edit (dropdown from BaseData) ─────────────
  document.querySelectorAll('.assignee-cell').forEach(cell => {
    const key     = cell.dataset.key;
    const display = cell.querySelector('.assignee-display');
    const select  = cell.querySelector('.assignee-select');

    // Populate dropdown from baseData
    const currentName = display.textContent.trim();
    select.innerHTML = `<option value="">— Unassigned —</option>` +
      Object.keys(baseData).map(name =>
        `<option value="${escHtml(name)}" ${name === currentName ? 'selected' : ''}>${escHtml(name)}</option>`
      ).join('');

    // Click display → show dropdown
    display.addEventListener('click', () => {
      display.classList.add('d-none');
      select.classList.remove('d-none');
      select.focus();
    });

    // Change → save
    select.addEventListener('change', () => {
      const name = select.value;
      display.textContent = name || '—';
      display.classList.remove('d-none');
      select.classList.add('d-none');
      const ticket = teamTickets.find(t => t.key === key);
      if (ticket) {
        ticket.assignee   = name;
        ticket.assigneeId = baseData[name] || '';
      }
    });

    // Blur → close without change
    select.addEventListener('blur', () => {
      display.classList.remove('d-none');
      select.classList.add('d-none');
    });
  });

  // ── Estimate inline edit ──────────────────────────────────────────────────
  document.querySelectorAll('.estimate-cell').forEach(cell => {
    const key     = cell.dataset.key;
    const display = cell.querySelector('.estimate-display');
    const input   = cell.querySelector('.estimate-input');

    // Click display → show input
    display.style.cursor = 'pointer';
    display.title = 'Click to edit';
    display.addEventListener('click', () => {
      display.classList.add('d-none');
      input.classList.remove('d-none');
      input.focus();
      input.select();
    });

    // Blur / Enter → save
    const save = () => {
      const val = input.value.trim();
      display.textContent = val || '—';
      display.classList.remove('d-none');
      input.classList.add('d-none');
      const ticket = teamTickets.find(t => t.key === key);
      if (ticket) ticket.estimate = val;
    };
    input.addEventListener('blur', save);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { input.value = display.textContent === '—' ? '' : display.textContent; save(); } });
  });
}

/* ── Selection ─────────────────────────────────────────────────────────────── */
function updateSelection() {
  const checked = document.querySelectorAll('.row-check:checked');
  const count   = checked.length;
  document.getElementById('selectedCount').textContent = `${count} selected`;
  document.getElementById('scheduleSelectedBtn').disabled = count === 0;

  // Show/hide floating button
  const floatBtn = document.getElementById('floatScheduleBtn');
  const floatCount = document.getElementById('floatCount');
  if (count > 0) {
    floatCount.textContent = count;
    floatBtn.classList.remove('d-none');
  } else {
    floatBtn.classList.add('d-none');
  }
}

function clearSelection() {
  document.getElementById('selectedCount').textContent = '0 selected';
  document.getElementById('scheduleSelectedBtn').disabled = true;
  document.getElementById('floatScheduleBtn').classList.add('d-none');
  const cb = document.getElementById('selectAllPending');
  if (cb) cb.checked = false;
}

function getSelectedTickets() {
  const checked = document.querySelectorAll('.row-check:checked');
  return Array.from(checked).map(cb => {
    const key    = cb.dataset.key;
    const ticket = teamTickets.find(t => t.key === key);
    return {
      key,
      projectKey:      key.split('-')[0],
      summary:         ticket?.summary || key,
      component:       ticket?.component || '',
      epicLink:        ticket?.epicLink || '',
      priority:        ticket?.priority || '',
      assigneeName:    ticket?.assignee || '',
      executionByName: ticket?.executionBy || '',
      assigneeId:      baseData[ticket?.executionBy] || '',
      estimate:        ticket?.estimate || ''
    };
  });
}

/* ── Filter buttons ────────────────────────────────────────────────────────── */
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    activeFilter = btn.dataset.filter;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    clearSelection();
    const filtered = activeFilter === 'all'
      ? teamTickets
      : teamTickets.filter(t => t.scheduled === activeFilter);
    renderTable(filtered);
  });
});

/* ── Select All: only selects Y (scheduled) rows. N rows must be picked manually ── */
document.getElementById('selectAllBtn').addEventListener('click', () => {
  document.querySelectorAll('.row-check').forEach(cb => {
    const row   = cb.closest('tr');
    const badge = row.querySelector('.schedule-toggle');
    const isY   = badge && badge.dataset.value === 'Y';
    cb.checked  = isY;
  });
  updateSelection();
});

document.getElementById('deselectAllBtn').addEventListener('click', () => {
  document.querySelectorAll('.row-check').forEach(cb => { cb.checked = false; });
  updateSelection();
});

/* ── Open schedule modal ───────────────────────────────────────────────────── */
document.getElementById('scheduleSelectedBtn').addEventListener('click', () => {
  const selected = getSelectedTickets();
  document.getElementById('schedTicketCount').textContent =
    `${selected.length} ticket${selected.length !== 1 ? 's' : ''} selected`;
  // Reset to form state (hide success view)
  document.getElementById('schedSuccessState').classList.add('d-none');
  document.getElementById('schedFormState').classList.remove('d-none');
  document.getElementById('schedError').classList.add('d-none');
  document.getElementById('schedApiToken').value = '';  // never remember token

  // Restore saved values (except API token)
  document.getElementById('schedEmail').value   = localStorage.getItem('schedEmail')   || '';
  document.getElementById('schedDueDate').value = localStorage.getItem('schedDueDate') || '';
  // Release: prefer team's Excel value, fallback to last used
  if (!document.getElementById('schedRelease').value)
    document.getElementById('schedRelease').value = localStorage.getItem('schedRelease') || '';

  // JIRA URL is hardcoded — keep field hidden
  document.getElementById('schedBaseUrl').value = JIRA_BASE_URL;
  document.getElementById('baseUrlField').classList.add('d-none');

  schedModal.show();
});

/* ── Submit schedule ───────────────────────────────────────────────────────── */
document.getElementById('scheduleSubmitBtn').addEventListener('click', async () => {
  const errBox  = document.getElementById('schedError');
  const spinner = document.getElementById('schedSpinner');
  const btn     = document.getElementById('scheduleSubmitBtn');

  errBox.classList.add('d-none');

  const email    = document.getElementById('schedEmail').value.trim();
  const apiToken = document.getElementById('schedApiToken').value.trim();
  const dueDate  = document.getElementById('schedDueDate').value;
  const release  = document.getElementById('schedRelease').value.trim();
  const baseUrl  = JIRA_BASE_URL;

  if (!email || !apiToken) {
    errBox.textContent = 'Email and API Token are required.';
    errBox.classList.remove('d-none'); return;
  }

  // Save form values for future sessions (never save API token)
  localStorage.setItem('schedEmail',   email);
  localStorage.setItem('schedDueDate', dueDate);
  localStorage.setItem('schedRelease', release);

  const tickets = getSelectedTickets();
  if (!tickets.length) {
    errBox.textContent = 'No tickets selected.';
    errBox.classList.remove('d-none'); return;
  }

  btn.disabled = true;
  spinner.classList.remove('d-none');

  try {
    const res     = await fetch('/api/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, apiToken, baseUrl, dueDate, release, tickets })
    });
    const results = await res.json();
    if (!res.ok) throw new Error(results.error || 'Schedule failed');

    const ok   = results.filter(r => r.success);
    const fail = results.filter(r => !r.success);

    // Mark rows green, uncheck checkboxes, update Test Result Ticket
    ok.forEach(r => {
      const row = document.querySelector(`tr[data-key="${r.key}"]`);
      if (!row) return;
      row.classList.add('row-scheduled');
      const cb = row.querySelector('.row-check');
      if (cb) cb.checked = false;

      // Schedule? → Y
      row.querySelector('td:nth-child(9)').innerHTML =
        `<span class="sched-badge sched-done"><i class="bi bi-check-circle-fill me-1"></i>Y</span>`;

      // Test Result Ticket → newly created key
      row.querySelector('td:nth-child(12)').innerHTML =
        `<a class="key-link" href="${JIRA_BASE_URL}/browse/${r.created}" target="_blank">${r.created}</a>`;

      // Comments → creation info
      const today   = new Date().toISOString().slice(0, 10);
      const comment = `Created on ${today} for release ${release}`;
      row.querySelector('td:nth-child(13)').textContent = comment;
      row.querySelector('td:nth-child(13)').title       = comment;

      // Update local data too
      const ticket = teamTickets.find(t => t.key === r.key);
      if (ticket) { ticket.testResultTicket = r.created; ticket.scheduled = 'Y'; ticket.comments = comment; }
    });

    clearSelection();

    if (ok.length) {
      const jiraBase = JIRA_BASE_URL;

      // Build enriched result rows (attach parent summary from tickets array)
      const enriched = ok.map(r => {
        const parent = teamTickets.find(t => t.key === r.key) || {};
        return { parentKey: r.key, createdKey: r.created, summary: parent.summary || r.key,
                 url: `${jiraBase}/browse/${r.created}`, release, dueDate };
      });

      // Store for download
      window._lastScheduled = enriched;

      // Switch to success state
      document.getElementById('schedFormState').classList.add('d-none');
      document.getElementById('schedSuccessState').classList.remove('d-none');
      document.getElementById('schedSuccessMsg').textContent =
        `${ok.length} ticket${ok.length !== 1 ? 's' : ''} created successfully` +
        (fail.length ? `, ${fail.length} failed` : '');

      // Show as full URLs
      document.getElementById('schedCreatedKeys').innerHTML = enriched.map(r => `
        <div class="created-ticket-row">
          <span class="badge bg-success-subtle text-success fw-semibold me-2">${r.createdKey}</span>
          <a href="${r.url}" target="_blank" class="small text-break">${r.url}</a>
        </div>`
      ).join('');
    }
    if (fail.length && !ok.length) {
      const firstErr = fail[0].error;
      errBox.textContent = `${fail.length} ticket(s) failed. JIRA error: ${typeof firstErr === 'object' ? JSON.stringify(firstErr) : firstErr}`;
      errBox.classList.remove('d-none');
      btn.disabled = false;
      spinner.classList.add('d-none');
    }

    // Update stats
    const oldPending   = parseInt(document.getElementById('tPending').textContent)   || 0;
    const oldScheduled = parseInt(document.getElementById('tScheduled').textContent) || 0;
    document.getElementById('tPending').textContent   = Math.max(0, oldPending - ok.length);
    document.getElementById('tScheduled').textContent = oldScheduled + ok.length;

  } catch (err) {
    errBox.textContent = `Error: ${err.message}`;
    errBox.classList.remove('d-none');
    // Re-enable only on error so user can retry
    btn.disabled = false;
    spinner.classList.add('d-none');
  }
});

/* ── Bind events ───────────────────────────────────────────────────────────── */
function bindEvents() {
  document.getElementById('backBtn').addEventListener('click', () => {
    document.getElementById('teamSection').classList.add('d-none');
    document.getElementById('landingSection').classList.remove('d-none');
    if (dtInstance) { dtInstance.destroy(); dtInstance = null; }
    currentTeam = null;
  });

  document.getElementById('refreshTeamsBtn').addEventListener('click', loadTeams);

  document.getElementById('floatScheduleTrigger').addEventListener('click', () => {
    document.getElementById('scheduleSelectedBtn').click();
  });

  document.getElementById('downloadScheduledBtn').addEventListener('click', () => {
    const rows = window._lastScheduled || [];
    if (!rows.length) return;
    const sep    = '\t';
    const header = ['Parent Key','Created Key','Summary','URL','Release','Due Date'].join(sep);
    const lines  = rows.map(r =>
      [r.parentKey, r.createdKey, r.summary, r.url, r.release, r.dueDate].join(sep)
    );
    const tsv  = [header, ...lines].join('\n');
    // \uFEFF = UTF-8 BOM so Excel opens with correct encoding and splits columns
    const blob = new Blob(['\uFEFF' + tsv], { type: 'text/tab-separated-values;charset=utf-8;' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `scheduled_${rows[0]?.release || 'export'}_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  document.getElementById('copyUrlsBtn').addEventListener('click', () => {
    const rows = window._lastScheduled || [];
    if (!rows.length) return;
    const text = rows.map(r => r.url).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      const btn  = document.getElementById('copyUrlsBtn');
      const orig = btn.innerHTML;
      btn.innerHTML = '<i class="bi bi-clipboard-check me-1"></i>Copied!';
      btn.classList.replace('btn-outline-primary', 'btn-primary');
      setTimeout(() => {
        btn.innerHTML = orig;
        btn.classList.replace('btn-primary', 'btn-outline-primary');
      }, 2000);
    });
  });

  document.getElementById('toggleSchedToken').addEventListener('click', () => {
    const inp  = document.getElementById('schedApiToken');
    const icon = document.querySelector('#toggleSchedToken i');
    inp.type   = inp.type === 'password' ? 'text' : 'password';
    icon.className = inp.type === 'password' ? 'bi bi-eye' : 'bi bi-eye-slash';
  });
}

/* ── Helpers ───────────────────────────────────────────────────────────────── */
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function priorityBadge(p) {
  const map = {
    P1:['p-highest','bi-arrow-up-circle-fill'], P2:['p-high','bi-arrow-up-circle'],
    P3:['p-medium','bi-dash-circle'],           P4:['p-low','bi-arrow-down-circle'],
    P5:['p-lowest','bi-arrow-down-circle-fill'],
    Highest:['p-highest','bi-arrow-up-circle-fill'], High:['p-high','bi-arrow-up-circle'],
    Medium:['p-medium','bi-dash-circle'],            Low:['p-low','bi-arrow-down-circle'],
    Lowest:['p-lowest','bi-arrow-down-circle-fill'],
  };
  const [cls, icon] = map[p] || ['p-medium','bi-dash-circle'];
  return `<span class="badge-priority ${cls}"><i class="bi ${icon}"></i>${p}</span>`;
}
