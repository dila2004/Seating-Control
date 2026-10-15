import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from './firebase.js';
import { friendlyError } from './auth.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[c]);

function colomboDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

const activeStatus = (status) => !['CANCELLED', 'TRANSFERRED', 'REJECTED'].includes(String(status || '').toUpperCase());
const normalized = (value) => String(value ?? '').trim().toUpperCase();

function issue(severity, type, title, details, employeeId = '', platformId = '', date = '', shift = '') {
  return { severity, type, title, details, employeeId, platformId, date, shift };
}

function scanCompliance({ seatings, employees, platforms, businessDate }) {
  const issues = [];
  const employeeById = new Map();
  for (const employee of employees) {
    const id = String(employee.employeeId || employee.id || '');
    if (id) employeeById.set(id, employee);
  }
  const platformIds = new Set(platforms.map((p) => String(p.id || p.platformId || '')));

  const activeSeatings = seatings.filter((s) => activeStatus(s.status));
  const groupedByEmployeeShift = new Map();
  const groupedByPlatformShiftLaptop = new Map();

  for (const seating of activeSeatings) {
    const employeeId = String(seating.employeeId || '');
    const date = String(seating.businessDate || seating.date || '');
    const shift = normalized(seating.shift);
    const platformId = String(seating.platformId || '');
    const key = `${employeeId}|${date}|${shift}`;
    if (!groupedByEmployeeShift.has(key)) groupedByEmployeeShift.set(key, []);
    groupedByEmployeeShift.get(key).push(seating);

    const laptop = normalized(seating.laptopName);
    if (laptop) {
      const laptopKey = `${platformId}|${date}|${shift}|${laptop}`;
      if (!groupedByPlatformShiftLaptop.has(laptopKey)) groupedByPlatformShiftLaptop.set(laptopKey, []);
      groupedByPlatformShiftLaptop.get(laptopKey).push(seating);
    }

    const employee = employeeById.get(employeeId);
    if (employee && normalized(employee.status) !== 'ACTIVE') {
      issues.push(issue('HIGH', 'INACTIVE_EMPLOYEE', 'Seating assigned to inactive employee',
        `${employeeId} has an active seating record but employee status is ${employee.status || 'missing'}.`,
        employeeId, platformId, date, shift));
    } else if (!employee) {
      issues.push(issue('MEDIUM', 'EMPLOYEE_NOT_FOUND', 'Employee record not found',
        `No matching employee document was found for ${employeeId || '(missing employee ID)'}.`,
        employeeId, platformId, date, shift));
    }

    if (!platformId || !platformIds.has(platformId)) {
      issues.push(issue('HIGH', 'INVALID_PLATFORM', 'Platform record missing',
        `The seating references platform "${platformId || '(empty)'}", which was not found in the platform list.`,
        employeeId, platformId, date, shift));
    }

    if (normalized(seating.status) === 'PENDING') {
      issues.push(issue('LOW', 'PENDING_APPROVAL', 'Seating awaiting approval',
        'This seating record is still pending review.', employeeId, platformId, date, shift));
    }

    if (!date || !shift || !employeeId) {
      issues.push(issue('MEDIUM', 'INCOMPLETE_RECORD', 'Required seating data is missing',
        'The record is missing employee ID, business date, or shift.', employeeId, platformId, date, shift));
    }
  }

  for (const [key, rows] of groupedByEmployeeShift) {
    if (rows.length > 1) {
      const [employeeId, date, shift] = key.split('|');
      const platformsText = [...new Set(rows.map((r) => r.platformName || r.platformId || 'Unknown'))].join(', ');
      issues.push(issue('CRITICAL', 'DUPLICATE_SEATING', 'Employee has multiple active seating records',
        `${rows.length} active records found for the same employee/date/shift. Platforms: ${platformsText}.`,
        employeeId, rows[0].platformId || '', date, shift));
    }
  }

  for (const [, rows] of groupedByPlatformShiftLaptop) {
    const distinctEmployees = new Set(rows.map((r) => String(r.employeeId || '')));
    if (distinctEmployees.size > 1) {
      const first = rows[0];
      issues.push(issue('HIGH', 'WORKSTATION_CONFLICT', 'Workstation assigned to multiple employees',
        `${first.laptopName} on ${first.platformName || first.platformId} is assigned to ${distinctEmployees.size} employees for the same date/shift.`,
        [...distinctEmployees].join(', '), first.platformId || '', first.businessDate || first.date || '', normalized(first.shift)));
    }
  }

  const todayPending = activeSeatings.filter((s) =>
    String(s.businessDate || s.date || '') === businessDate && normalized(s.status) === 'PENDING').length;

  return { issues, activeSeatings, todayPending };
}

export async function renderCompliancePage(root, profile) {
  const role = normalized(profile?.role || 'STAFF');
  const canView = ['PIC', 'TL', 'SPV', 'ADMIN'].includes(role);
  if (!canView) {
    root.innerHTML = `<section class="panel cm-card"><h2>Access restricted</h2><p>Compliance is available to PIC, TL, SPV and Admin accounts.</p></section>`;
    return;
  }

  root.innerHTML = `
    <section class="cm-page">
      <div class="page-heading">
        <div><div class="eyebrow">OPERATIONS / CONTROL</div><h1>Compliance Center</h1>
        <p>Review seating data integrity and operational exceptions from Firestore.</p></div>
        <button class="button button-outline" id="cm-refresh" type="button">↻ Refresh checks</button>
      </div>
      <div id="cm-alert" class="alert hidden" role="status"></div>
      <div class="cm-stats" id="cm-stats">
        <article class="panel cm-stat"><span>Total findings</span><strong>—</strong><small>Loading records</small></article>
        <article class="panel cm-stat"><span>Critical / high</span><strong>—</strong><small>Needs attention</small></article>
        <article class="panel cm-stat"><span>Pending approvals</span><strong>—</strong><small>Review queue</small></article>
        <article class="panel cm-stat"><span>Active seatings checked</span><strong>—</strong><small>Firestore records</small></article>
      </div>
      <section class="panel cm-card">
        <div class="cm-toolbar">
          <div><h2>Findings</h2><p id="cm-count">Run checks to load findings.</p></div>
          <div class="cm-filters">
            <select id="cm-severity" aria-label="Filter by severity">
              <option value="">All severities</option><option value="CRITICAL">Critical</option>
              <option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option>
            </select>
            <select id="cm-type" aria-label="Filter by issue type"><option value="">All issue types</option></select>
            <input id="cm-search" type="search" placeholder="Search employee / platform…" aria-label="Search findings">
          </div>
        </div>
        <div class="cm-table-wrap"><table class="cm-table">
          <thead><tr><th>Severity</th><th>Finding</th><th>Employee / record</th><th>Platform</th><th>Date / shift</th></tr></thead>
          <tbody id="cm-rows"><tr><td colspan="5" class="cm-empty">Loading compliance checks…</td></tr></tbody>
        </table></div>
      </section>
      <p class="cm-footnote">Checks are read-only. This page identifies potential issues; it does not change seating or approve records.</p>
      <style>
        .cm-page{display:flex;flex-direction:column;gap:18px}.cm-page .hidden{display:none!important}
        .cm-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
        .cm-stat{padding:17px;display:flex;flex-direction:column;gap:7px}.cm-stat span,.cm-stat small{font-size:12px;color:var(--muted,#718096)}
        .cm-stat strong{font-size:28px;color:var(--text,#172b4d)}.cm-card{padding:0;overflow:hidden}
        .cm-toolbar{padding:18px 20px;display:flex;justify-content:space-between;gap:14px;align-items:flex-start;flex-wrap:wrap;border-bottom:1px solid var(--border,#e3e8ef)}
        .cm-toolbar h2{font-size:17px;margin:0}.cm-toolbar p{font-size:12px;color:var(--muted,#718096);margin:5px 0 0}
        .cm-filters{display:flex;gap:8px;flex-wrap:wrap}.cm-filters select,.cm-filters input{min-height:38px;padding:8px 10px;border:1px solid var(--border,#dbe3ee);border-radius:8px;background:var(--surface,#fff);color:var(--text,#172b4d);font:inherit;font-size:12px}
        .cm-table-wrap{overflow:auto}.cm-table{width:100%;border-collapse:collapse;font-size:12px}.cm-table th,.cm-table td{padding:13px 15px;border-bottom:1px solid var(--border,#e3e8ef);text-align:left;vertical-align:top}
        .cm-table th{font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted,#718096);background:var(--surface-subtle,#f8fafc);white-space:nowrap}
        .cm-table td strong{display:block;color:var(--text,#172b4d);font-size:12px}.cm-table td small{display:block;color:var(--muted,#718096);margin-top:4px;max-width:360px;white-space:normal;line-height:1.45}
        .cm-severity{display:inline-flex;border-radius:999px;padding:5px 8px;font-size:10px;font-weight:800;white-space:nowrap}
        .cm-CRITICAL{background:#fee2e2;color:#991b1b}.cm-HIGH{background:#ffedd5;color:#9a3412}.cm-MEDIUM{background:#fef3c7;color:#92400e}.cm-LOW{background:#dbeafe;color:#1d4ed8}
        .cm-empty{text-align:center!important;padding:28px!important;color:var(--muted,#718096)}.cm-footnote{font-size:11px;color:var(--muted,#718096);margin:0}
        @media(max-width:900px){.cm-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.cm-toolbar{flex-direction:column}.cm-filters{width:100%}.cm-filters input{flex:1;min-width:140px}}
        @media(max-width:520px){.cm-stats{grid-template-columns:1fr 1fr}.cm-stat strong{font-size:23px}.cm-filters select{flex:1}}
      </style>
    </section>`;

  const $ = (selector) => root.querySelector(selector);
  const alertBox = $('#cm-alert');
  let findings = [];

  function showError(message) {
    alertBox.textContent = message;
    alertBox.classList.remove('hidden');
    alertBox.classList.add('alert-error');
  }

  function renderRows() {
    const severity = $('#cm-severity').value;
    const type = $('#cm-type').value;
    const search = $('#cm-search').value.trim().toLowerCase();
    const filtered = findings.filter((f) =>
      (!severity || f.severity === severity) &&
      (!type || f.type === type) &&
      (!search || `${f.title} ${f.details} ${f.employeeId} ${f.platformId} ${f.type}`.toLowerCase().includes(search))
    );
    $('#cm-count').textContent = `${filtered.length} finding(s) shown · ${findings.length} total`;
    $('#cm-rows').innerHTML = filtered.length ? filtered.map((f) => `
      <tr>
        <td><span class="cm-severity cm-${esc(f.severity)}">${esc(f.severity)}</span></td>
        <td><strong>${esc(f.title)}</strong><small>${esc(f.details)}</small></td>
        <td>${esc(f.employeeId || '—')}<small>${esc(f.type)}</small></td>
        <td>${esc(f.platformId || '—')}</td>
        <td>${esc(f.date || '—')}<small>${esc(f.shift || '—')}</small></td>
      </tr>`).join('') : `<tr><td colspan="5" class="cm-empty">No findings match these filters.</td></tr>`;
  }

  async function loadChecks() {
    const button = $('#cm-refresh');
    button.disabled = true;
    button.textContent = 'Checking…';
    alertBox.classList.add('hidden');
    $('#cm-rows').innerHTML = `<tr><td colspan="5" class="cm-empty">Reading Firestore records…</td></tr>`;
    try {
      const [seatingSnap, employeeSnap, platformSnap] = await Promise.all([
        getDocs(query(collection(db, 'seatings'), limit(2000))),
        getDocs(query(collection(db, 'employees'), limit(2000))),
        getDocs(query(collection(db, 'platforms'), limit(1000)))
      ]);
      const seatings = seatingSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const employees = employeeSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const platforms = platformSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const result = scanCompliance({ seatings, employees, platforms, businessDate: colomboDate() });
      findings = result.issues.sort((a, b) => {
        const rank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
        return rank[a.severity] - rank[b.severity] || a.title.localeCompare(b.title);
      });

      const criticalHigh = findings.filter((f) => ['CRITICAL', 'HIGH'].includes(f.severity)).length;
      $('#cm-stats').innerHTML = `
        <article class="panel cm-stat"><span>Total findings</span><strong>${findings.length}</strong><small>Across loaded records</small></article>
        <article class="panel cm-stat"><span>Critical / high</span><strong>${criticalHigh}</strong><small>Prioritize review</small></article>
        <article class="panel cm-stat"><span>Pending approvals</span><strong>${result.todayPending}</strong><small>Today’s business date</small></article>
        <article class="panel cm-stat"><span>Active seatings checked</span><strong>${result.activeSeatings.length}</strong><small>Loaded from Firestore</small></article>`;
      const types = [...new Set(findings.map((f) => f.type))].sort();
      $('#cm-type').innerHTML = `<option value="">All issue types</option>` + types.map((t) => `<option value="${esc(t)}">${esc(t.replaceAll('_', ' '))}</option>`).join('');
      renderRows();
      if (seatingSnap.size >= 2000 || employeeSnap.size >= 2000 || platformSnap.size >= 1000) {
        alertBox.textContent = 'Some collection limits were reached. Results may be incomplete; use pagination or narrower date queries for larger datasets.';
        alertBox.classList.remove('hidden');
      }
    } catch (error) {
      showError(`Could not run compliance checks: ${friendlyError(error)}. Verify Firestore read permissions.`);
      $('#cm-rows').innerHTML = `<tr><td colspan="5" class="cm-empty">Compliance checks failed to load.</td></tr>`;
    } finally {
      button.disabled = false;
      button.textContent = '↻ Refresh checks';
    }
  }

  $('#cm-refresh').addEventListener('click', loadChecks);
  $('#cm-severity').addEventListener('change', renderRows);
  $('#cm-type').addEventListener('change', renderRows);
  $('#cm-search').addEventListener('input', renderRows);
  await loadChecks();
}
