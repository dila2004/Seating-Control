import { collection, deleteDoc, doc, getDocs, limit, query, updateDoc, where } from 'firebase/firestore';
import { db } from './firebase.js';
import { friendlyError } from './auth.js';

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);

function businessDateInColombo(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function currentShift(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Colombo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  const mins = hour * 60 + minute;
  return mins >= 450 && mins < 1170 ? 'MORNING' : 'NIGHT';
}

function statusPill(status) {
  const value = String(status || 'UNKNOWN').toUpperCase();
  const css = value === 'APPROVED' || value === 'LOCKED'
    ? 'success'
    : value === 'PENDING'
      ? 'warning'
      : value === 'CANCELLED'
        ? 'muted'
        : 'neutral';
  return `<span class="cs-status cs-status-${css}">${escapeHtml(value)}</span>`;
}

export async function renderCurrentSeatingPage(root, profile) {
  const role = profile?.role || 'STAFF';
  const isAdmin = role === 'ADMIN';
  const canManage = isAdmin || role === 'GS' || role === 'STAFF' && String(profile?.department || '').toUpperCase() === 'GS';
  const date = businessDateInColombo();
  const shift = currentShift();

  root.innerHTML = `
    <section class="cs-page">
      <div class="page-heading">
        <div>
          <div class="eyebrow">OPERATIONS / SEATING</div>
          <h1>Current Seating</h1>
          <p>View employee seating for the selected business date and shift.</p>
        </div>
        <span class="cs-live"><span></span> Firestore data</span>
      </div>

      <div id="cs-alert" class="alert hidden"></div>

      <div class="cs-summary">
        <article class="cs-stat"><span>Active seating records</span><strong id="cs-total">—</strong></article>
        <article class="cs-stat"><span>Pending approval</span><strong id="cs-pending">—</strong></article>
        <article class="cs-stat"><span>Approved / locked</span><strong id="cs-approved">—</strong></article>
        <article class="cs-stat"><span>Active employees</span><strong id="cs-employees">—</strong></article>
      </div>

      <section class="panel cs-panel">
        <div class="cs-toolbar">
          <label class="cs-field cs-search">
            <span>Search</span>
            <input id="cs-search" type="search" placeholder="Employee ID, name, or platform…" autocomplete="off" />
          </label>
          <label class="cs-field">
            <span>Business date</span>
            <input id="cs-date" type="date" value="${escapeHtml(date)}" />
          </label>
          <label class="cs-field">
            <span>Shift</span>
            <select id="cs-shift">
              <option value="MORNING" ${shift === 'MORNING' ? 'selected' : ''}>Day · 07:30–19:30</option>
              <option value="NIGHT" ${shift === 'NIGHT' ? 'selected' : ''}>Night · 19:30–07:30</option>
            </select>
          </label>
          <label class="cs-field">
            <span>Department</span>
            <select id="cs-department">
              <option value="">All departments</option>
              <option value="GS">GS</option>
              <option value="DP">DP</option>
              <option value="WD">WD</option>
            </select>
          </label>
          <label class="cs-field">
            <span>Platform</span>
            <select id="cs-platform"><option value="">All platforms</option></select>
          </label>
          <button type="button" id="cs-refresh" class="button button-outline">↻ Refresh</button>
        </div>

        <div class="cs-table-wrap">
          <table class="cs-table">
            <thead>
              <tr>
                <th>Employee ID</th>
                <th>Employee</th>
                <th>Department</th>
                <th>Platform</th>
                <th>Laptop / Workstation</th>
                <th>Department details</th>
                <th>Shift</th>
                <th>Status</th>
                ${canManage ? '<th>Actions</th>' : ''}
              </tr>
            </thead>
            <tbody id="cs-rows"><tr><td colspan="${canManage ? 9 : 8}" class="cs-empty">Loading seating records…</td></tr></tbody>
          </table>
        </div>
        <div class="cs-table-footer"><span id="cs-result-count">Loading…</span><span>Department-specific details are shown when available</span></div>
      </section>
    </section>

    <style>
      .cs-page{display:flex;flex-direction:column;gap:20px}
      .cs-page .page-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}
      .cs-page .page-heading h1{margin:4px 0 8px}
      .cs-page .page-heading p{margin:0;color:var(--muted,#718096)}
      .cs-live{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--border,#dbe3ee);border-radius:999px;padding:8px 12px;font-size:12px;font-weight:700}
      .cs-live span{width:8px;height:8px;border-radius:50%;background:#16a36a;display:inline-block}
      .cs-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
      .cs-stat{border:1px solid var(--border,#dbe3ee);border-radius:14px;padding:17px;background:var(--surface,#fff);display:flex;flex-direction:column;gap:10px}
      .cs-stat span{font-size:12px;color:var(--muted,#718096);font-weight:600}
      .cs-stat strong{font-size:27px;line-height:1.1;color:var(--text,#172b4d)}
      .cs-panel{padding:0;overflow:hidden}
      .cs-toolbar{display:grid;grid-template-columns:minmax(190px,2fr) repeat(3,minmax(130px,1fr)) minmax(150px,1fr) auto;gap:12px;align-items:end;padding:18px;border-bottom:1px solid var(--border,#dbe3ee)}
      .cs-field{display:flex;flex-direction:column;gap:7px;font-size:12px;font-weight:700;color:var(--muted,#64748b);min-width:0}
      .cs-field input,.cs-field select{width:100%;box-sizing:border-box;min-height:40px;padding:9px 10px;border:1px solid var(--border,#dbe3ee);border-radius:9px;background:var(--surface,#fff);color:var(--text,#172b4d);font:inherit;font-weight:500}
      .cs-search{min-width:0}
      .cs-table-wrap{width:100%;overflow:auto}
      .cs-table{width:100%;border-collapse:collapse;min-width:760px}
      .cs-table th,.cs-table td{text-align:left;padding:14px 18px;border-bottom:1px solid var(--border,#e6ebf2);font-size:13px;white-space:nowrap}
      .cs-table th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted,#718096);background:var(--surface-subtle,#f8fafc)}
      .cs-table tbody tr:hover{background:var(--surface-subtle,#f8fafc)}
      .cs-table td:first-child{font-weight:700}.cs-detail-cell{white-space:normal!important;min-width:180px;max-width:360px;line-height:1.5}
      .cs-status{display:inline-flex;padding:5px 9px;border-radius:999px;font-size:11px;font-weight:800}
      .cs-status-success{background:#e8f8ef;color:#18794e}.cs-status-warning{background:#fff4d6;color:#946200}.cs-status-muted{background:#edf0f4;color:#667085}.cs-status-neutral{background:#eaf1ff;color:#3157a4}
      .cs-empty{text-align:center!important;color:var(--muted,#718096);padding:36px!important}
      .cs-actions{display:flex;gap:6px}.cs-actions button{padding:6px 10px;font-size:12px}.cs-delete{color:#b42318;border-color:#f2c5c2}
      .cs-table-footer{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:13px 18px;color:var(--muted,#718096);font-size:12px}
      @media(max-width:1100px){.cs-toolbar{grid-template-columns:repeat(3,minmax(0,1fr))}.cs-search{grid-column:span 2}}
      @media(max-width:700px){.cs-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.cs-toolbar{grid-template-columns:1fr 1fr}.cs-search{grid-column:span 2}.cs-toolbar #cs-refresh{width:100%}}
      @media(max-width:420px){.cs-summary{grid-template-columns:1fr 1fr}.cs-stat{padding:13px}.cs-stat strong{font-size:23px}.cs-toolbar{grid-template-columns:1fr}.cs-search{grid-column:auto}}
    </style>
  `;

  const $ = (selector) => root.querySelector(selector);
  const alertBox = $('#cs-alert');
  let allRows = [];
  let employees = [];
  let platforms = [];

  function showError(message) {
    alertBox.textContent = message;
    alertBox.classList.remove('hidden');
  }
  function clearError() {
    alertBox.textContent = '';
    alertBox.classList.add('hidden');
  }

  function renderRows() {
    const search = $('#cs-search').value.trim().toLowerCase();
    const department = $('#cs-department').value;
    const platformId = $('#cs-platform').value;

    const filtered = allRows.filter((row) => {
      const employee = row.employee || {};
      const haystack = [
        row.employeeId, employee.employeeId, employee.name, row.employeeName,
        row.platformId, row.platformName, employee.department
      ].map((v) => String(v ?? '').toLowerCase()).join(' ');
      return (!search || haystack.includes(search))
        && (!department || employee.department === department)
        && (!platformId || row.platformId === platformId);
    }).sort((a, b) =>
      String(a.platformName || a.platformId || '').localeCompare(String(b.platformName || b.platformId || ''))
      || String(a.employeeId || '').localeCompare(String(b.employeeId || ''))
    );

    $('#cs-result-count').textContent = `${filtered.length} record${filtered.length === 1 ? '' : 's'}`;
    $('#cs-rows').innerHTML = filtered.length ? filtered.map((row) => {
      const employee = row.employee || {};
      const department = String(employee.department || row.department || '').toUpperCase();
      const workstation = row.workstation || row.laptop || row.laptopName || row.workstationName || row.station || row.platformWorkstation || '—';
      const asList = (value) => Array.isArray(value) ? value : (value == null || value === '' ? [] : [value]);
      let detailItems = [];
      if (department === 'DP') {
        detailItems = [
          ...asList(row.handledAccounts), ...asList(row.handledPhones),
          ...asList(row.handledPhoneAccounts), ...asList(row.accounts),
          ...asList(row.selectedAccounts), ...asList(row.accountAssignments)
        ];
      } else if (department === 'WD') {
        detailItems = [
          ...asList(row.withdrawalWorks), ...asList(row.workTypes),
          ...asList(row.handledWorks), ...asList(row.selectedWorks),
          ...asList(row.workOptions), ...asList(row.works)
        ];
      }
      detailItems = [...new Set(detailItems.map((v) => typeof v === 'object' ? (v.label || v.name || v.value || '') : String(v)).filter(Boolean))];
      const details = department === 'GS' ? '—' : (detailItems.length ? detailItems.join(', ') : '—');
      const actions = canManage ? `<td class="cs-actions"><button type="button" class="button button-outline cs-edit" data-id="${escapeHtml(row.id)}">Edit</button> <button type="button" class="button button-outline cs-delete" data-id="${escapeHtml(row.id)}">Delete</button></td>` : '';
      return `<tr>
        <td>${escapeHtml(row.employeeId || employee.employeeId || '—')}</td>
        <td>${escapeHtml(row.employeeName || employee.name || 'Name unavailable')}</td>
        <td>${escapeHtml(department || '—')}</td>
        <td>${escapeHtml(row.platformName || row.platformId || '—')}</td>
        <td>${escapeHtml(workstation)}</td>
        <td class="cs-detail-cell">${escapeHtml(details)}</td>
        <td>${escapeHtml(row.shift || '—')}</td>
        <td>${statusPill(row.status)}</td>
        ${actions}
      </tr>`;
    }).join('') : `<tr><td colspan="${canManage ? 9 : 8}" class="cs-empty">No seating records match these filters.</td></tr>`;

    if (canManage) {
      $('#cs-rows').querySelectorAll('.cs-edit').forEach((button) => button.addEventListener('click', () => editSeating(button.dataset.id)));
      $('#cs-rows').querySelectorAll('.cs-delete').forEach((button) => button.addEventListener('click', () => removeSeating(button.dataset.id)));
    }
  }

  async function editSeating(id) {
    const row = allRows.find((item) => item.id === id);
    if (!row) return;
    const department = String(row.employee?.department || row.department || '').toUpperCase();
    const workstation = window.prompt('Laptop / workstation:', row.workstation || row.laptop || row.laptopName || row.workstationName || '');
    if (workstation === null) return;
    const patch = { workstation: workstation.trim(), updatedAt: new Date() };
    const readList = (current, label) => {
      const existing = Array.isArray(current) ? current.join(', ') : (current || '');
      const answer = window.prompt(`${label} (comma-separated):`, existing);
      if (answer === null) return null;
      return answer.split(',').map((value) => value.trim()).filter(Boolean);
    };
    if (department === 'DP') {
      const existing = row.handledAccounts ?? row.handledPhones ?? row.handledPhoneAccounts ?? row.accounts ?? row.selectedAccounts ?? [];
      const selected = readList(existing, 'Handled accounts (e.g. KBZ 1, Wave 2)');
      if (selected === null) return;
      patch.handledAccounts = selected;
    } else if (department === 'WD') {
      const existing = row.withdrawalWorks ?? row.workTypes ?? row.handledWorks ?? row.selectedWorks ?? row.workOptions ?? row.works ?? [];
      const selected = readList(existing, 'Withdrawal works');
      if (selected === null) return;
      patch.withdrawalWorks = selected;
    }
    try {
      await updateDoc(doc(db, 'seatings', id), patch);
      await load();
    } catch (error) {
      showError(`Could not edit seating: ${friendlyError(error)}`);
    }
  }

  async function removeSeating(id) {
    const row = allRows.find((item) => item.id === id);
    if (!row || !window.confirm(`Delete seating for ${row.employeeName || row.employeeId || 'this employee'}? This cannot be undone.`)) return;
    try {
      await deleteDoc(doc(db, 'seatings', id));
      await load();
    } catch (error) {
      showError(`Could not delete seating: ${friendlyError(error)}`);
    }
  }

  async function load() {
    const refresh = $('#cs-refresh');
    refresh.disabled = true;
    refresh.textContent = 'Loading…';
    clearError();
    $('#cs-rows').innerHTML = `<tr><td colspan="${canManage ? 9 : 8}" class="cs-empty">Loading seating records…</td></tr>`;

    try {
      const selectedDate = $('#cs-date').value || businessDateInColombo();
      const selectedShift = $('#cs-shift').value;
      const [seatingSnap, employeeSnap, platformSnap] = await Promise.all([
        getDocs(query(
          collection(db, 'seatings'),
          where('businessDate', '==', selectedDate),
          where('shift', '==', selectedShift),
          limit(1000)
        )),
        getDocs(query(collection(db, 'employees'), limit(1000))),
        getDocs(query(collection(db, 'platforms'), limit(500)))
      ]);

      employees = employeeSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      platforms = platformSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      const employeeMap = new Map();
      employees.forEach((employee) => {
        employeeMap.set(String(employee.employeeId ?? employee.id), employee);
        employeeMap.set(String(employee.id), employee);
      });
      const platformMap = new Map(platforms.map((platform) => [platform.id, platform]));
      allRows = seatingSnap.docs.map((doc) => {
        const seating = { id: doc.id, ...doc.data() };
        const employee = employeeMap.get(String(seating.employeeId)) || {};
        const platform = platformMap.get(String(seating.platformId)) || {};
        return {
          ...seating,
          employee,
          employeeName: seating.employeeName || seating.name || employee.name || '',
          platformName: platform.name || platform.platformName || seating.platformName || seating.platformId || ''
        };
      }).filter((row) => String(row.status || '').toUpperCase() !== 'CANCELLED');

      const activeEmployees = employees.filter((e) =>
        String(e.status || '').toUpperCase() === 'ACTIVE'
        && !['PIC', 'TL', 'SPV', 'ADMIN'].includes(String(e.role || '').toUpperCase())
        && !['PIC', 'TL', 'SPV', 'ADMIN'].includes(String(e.department || '').toUpperCase())
      );
      const uniqueSeated = new Set(allRows.map((row) => String(row.employeeId ?? '')).filter(Boolean));
      $('#cs-total').textContent = allRows.length;
      $('#cs-pending').textContent = allRows.filter((row) => row.status === 'PENDING').length;
      $('#cs-approved').textContent = allRows.filter((row) => ['APPROVED', 'LOCKED'].includes(row.status)).length;
      $('#cs-employees').textContent = activeEmployees.length;

      const platformSelect = $('#cs-platform');
      const priorPlatform = platformSelect.value;
      platformSelect.innerHTML = '<option value="">All platforms</option>' + platforms
        .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)))
        .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name || p.platformId || p.id)}</option>`)
        .join('');
      if (platforms.some((p) => p.id === priorPlatform)) platformSelect.value = priorPlatform;

      renderRows();
    } catch (error) {
      allRows = [];
      $('#cs-rows').innerHTML = `<tr><td colspan="${canManage ? 9 : 8}" class="cs-empty">Unable to load current seating.</td></tr>`;
      $('#cs-result-count').textContent = '0 records';
      showError(`Current seating could not be loaded: ${friendlyError(error)}`);
    } finally {
      refresh.disabled = false;
      refresh.textContent = '↻ Refresh';
    }
  }

  ['cs-search', 'cs-department', 'cs-platform'].forEach((id) => {
    $(`#${id}`).addEventListener(id === 'cs-search' ? 'input' : 'change', renderRows);
  });
  $('#cs-date').addEventListener('change', load);
  $('#cs-shift').addEventListener('change', load);
  $('#cs-refresh').addEventListener('click', load);

  await load();
}
