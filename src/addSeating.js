import {
  addDoc, collection, doc, getDoc, getDocs, limit, query, serverTimestamp,
  where, runTransaction
} from 'firebase/firestore';
import { db } from './firebase.js';
import { friendlyError } from './auth.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[c]);

function colomboDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

function colomboShift(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Colombo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  const minutes = hour * 60 + minute;
  return minutes >= 450 && minutes < 1170 ? 'MORNING' : 'NIGHT';
}

const operationDepartments = new Set(['GS', 'DP', 'WD']);
const promotionRoles = new Set(['PIC', 'TL', 'SPV', 'ADMIN']);

export async function renderAddSeatingPage(root, profile) {
  const userRole = String(profile?.role || 'STAFF').toUpperCase();
  const userDepartment = String(profile?.department || '').toUpperCase();
  const canAdd = userRole === 'ADMIN' || (userRole === 'STAFF' && userDepartment === 'GS');

  root.innerHTML = `
    <section class="as-page">
      <div class="page-heading">
        <div>
          <div class="eyebrow">OPERATIONS / SEATING</div>
          <h1>Add Seating</h1>
          <p>Assign an active operation officer to a platform for a business date and shift.</p>
        </div>
        <span class="as-chip"><span></span> GS workflow</span>
      </div>
      <div id="as-alert" class="alert hidden" role="status"></div>
      ${canAdd ? `
      <div class="as-note"><strong>GS responsibility</strong><span>GS can select active employees from GS, DP and WD. PIC, TL, SPV and Admin-role employees are excluded.</span></div>
      <div class="as-layout">
        <section class="panel as-form-panel">
          <div class="as-panel-heading"><div><h2>Seating details</h2><p>Complete the fields before submitting for PIC review.</p></div><span class="as-required">* Required</span></div>
          <form id="as-form" class="as-form">
            <div class="as-grid">
              <label class="as-field"><span>Business date *</span><input type="date" name="businessDate" value="${esc(colomboDate())}" required /></label>
              <label class="as-field"><span>Shift *</span><select name="shift" required><option value="MORNING" ${colomboShift() === 'MORNING' ? 'selected' : ''}>Morning · 07:30–19:30</option><option value="NIGHT" ${colomboShift() === 'NIGHT' ? 'selected' : ''}>Night · 19:30–07:30</option></select></label>
              <label class="as-field as-full"><span>Platform *</span><select name="platformId" id="as-platform" required><option value="">Loading platforms…</option></select></label>
              <label class="as-field as-full"><span>Search employee *</span><input id="as-employee-search" type="search" placeholder="Search by employee ID or name…" autocomplete="off" /></label>
              <label class="as-field as-full"><span>Operation officer *</span><select name="employeeId" id="as-employee" required><option value="">Load active employees first</option></select><small id="as-employee-help">Only active GS, DP and WD employees are listed.</small></label>
              <label class="as-field"><span>Laptop / workstation *</span><select name="laptopName" id="as-laptop" required><option value="">Select employee first</option></select></label>
              <div class="as-field" id="as-account-field"><span id="as-account-label">Handled account / phone</span><div id="as-account-options" class="as-option-grid"><span class="as-muted">Select employee first</span></div></div>
              <div class="as-field as-full hidden" id="as-withdrawal-field"><span>Withdrawal work *</span><div id="as-withdrawal-options" class="as-option-grid"></div></div>
            </div>
            <div class="as-queue-actions">
              <p>Add each employee to the list first. Review the full list, then submit all assignments together.</p>
              <button id="as-add-to-list" type="button" class="button button-outline">＋ Add to list</button>
            </div>

          </form>
        </section>
        <section class="panel as-queue-panel" aria-labelledby="as-queue-title">
          <div class="as-panel-heading"><div><h2 id="as-queue-title">Seating list</h2><p id="as-queue-count">0 employees added</p></div><span class="as-queue-status">Not submitted</span></div>
          <div class="as-queue-empty" id="as-queue-empty">Employees you add will appear here. Add several employees, review the list, then submit together.</div>
          <div class="as-queue-table-wrap hidden" id="as-queue-table-wrap">
            <table class="as-queue-table"><thead><tr><th>Employee</th><th>Dept.</th><th>Platform</th><th>Workstation</th><th>Accounts / work</th><th></th></tr></thead><tbody id="as-queue-body"></tbody></table>
          </div>
          <div class="as-queue-footer"><span id="as-queue-summary">0 assignments ready</span><button id="as-submit" type="button" class="button button-primary" disabled>Submit all</button></div>
        </section>
      </div>` : `
      <section class="panel as-denied"><h2>Access restricted</h2><p>Add Seating is available to GS operation officers and Admin accounts. Your current profile does not show GS department access.</p><p>Ask an administrator to verify your user profile fields.</p></section>`}
    </section>
    <style>
      .as-page{display:flex;flex-direction:column;gap:20px}.as-page .hidden{display:none!important}
      .as-page .page-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}
      .as-page .page-heading h1{margin:4px 0 8px}.as-page .page-heading p{margin:0;color:var(--muted,#718096)}
      .as-chip{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid var(--border,#dbe3ee);border-radius:999px;font-size:12px;font-weight:700}
      .as-chip span{width:8px;height:8px;border-radius:50%;background:#2563eb}
      .as-note{display:flex;gap:10px;flex-wrap:wrap;padding:14px 16px;border:1px solid #cbdaf5;background:#f3f7ff;color:#24416e;border-radius:12px;font-size:13px}
      .as-note strong{white-space:nowrap}.as-layout{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:18px;align-items:start}
      .as-form-panel,.as-queue-panel{padding:0;overflow:hidden;min-width:0}.as-panel-heading{padding:20px 22px;border-bottom:1px solid var(--border,#e3e8ef);display:flex;justify-content:space-between;gap:12px;align-items:center}
      .as-panel-heading h2{margin:0;font-size:17px}.as-panel-heading p{margin:6px 0 0;font-size:12px;color:var(--muted,#718096)}.as-required{font-size:11px;color:var(--muted,#718096)}
      .as-form{padding:22px}.as-grid{display:grid;grid-template-columns:1fr 1fr;gap:17px}.as-field{display:flex;flex-direction:column;gap:7px;min-width:0;font-size:12px;font-weight:700;color:var(--muted,#64748b)}.as-full{grid-column:1/-1}
      .as-field input,.as-field select{width:100%;box-sizing:border-box;min-height:42px;border:1px solid var(--border,#dbe3ee);border-radius:9px;padding:10px 12px;background:var(--surface,#fff);color:var(--text,#172b4d);font:inherit;font-weight:500}
      .as-field small{font-weight:400;font-size:11px;color:var(--muted,#718096)}.as-submit-row{margin-top:22px;padding-top:18px;border-top:1px solid var(--border,#e3e8ef);display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}.as-submit-row p{font-size:12px;color:var(--muted,#718096);margin:0;max-width:340px}
      .as-queue-actions{margin-top:22px;padding-top:18px;border-top:1px solid var(--border,#e3e8ef);display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap}.as-queue-actions p{margin:0;color:var(--muted,#718096);font-size:12px;max-width:420px}.as-queue{margin-top:18px;padding:0;overflow:hidden;border:1px solid var(--border,#dbe3ee);border-radius:12px}.as-option-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.as-option{display:flex;align-items:center;gap:8px;padding:8px 9px;border:1px solid var(--border,#dbe3ee);border-radius:8px;font-size:12px;font-weight:600;color:var(--text,#172b4d);background:var(--surface,#fff)}.as-option input{width:15px;min-height:15px;accent-color:#3563e9}.as-muted{font-size:12px;color:var(--muted,#718096)}.as-queue-heading,.as-queue-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:16px 18px}.as-queue-heading{border-bottom:1px solid var(--border,#e3e8ef)}.as-queue-heading h3{margin:0;font-size:15px}.as-queue-heading p{margin:5px 0 0;font-size:12px;color:var(--muted,#718096)}.as-queue-status{font-size:11px;font-weight:700;border-radius:999px;padding:6px 9px;background:#eff6ff;color:#1d4ed8}.as-queue-empty{padding:22px;text-align:center;color:var(--muted,#718096);font-size:12px}.as-queue-table-wrap{overflow-x:auto}.as-queue-table{width:100%;border-collapse:collapse;font-size:12px}.as-queue-table th,.as-queue-table td{padding:12px 14px;text-align:left;border-bottom:1px solid var(--border,#e3e8ef);white-space:nowrap}.as-queue-table th{background:var(--surface-subtle,#f8fafc);color:var(--muted,#64748b);font-size:10px;text-transform:uppercase;letter-spacing:.04em}.as-queue-table td small{display:block;color:var(--muted,#718096);margin-top:3px}.as-queue-remove{border:1px solid #fecaca;background:#fff;color:#b91c1c;border-radius:7px;padding:6px 9px;cursor:pointer}.as-queue-footer{border-top:1px solid var(--border,#e3e8ef);flex-wrap:wrap}.as-queue-footer span{font-size:12px;color:var(--muted,#718096)}.as-queue .hidden{display:none!important}
      .as-checklist{list-style:none;padding:8px 22px 18px;margin:0;display:flex;flex-direction:column;gap:18px}.as-checklist li{display:flex;gap:12px}.as-checklist li>span{display:grid;place-items:center;width:30px;height:30px;flex:0 0 30px;border-radius:9px;background:var(--surface-subtle,#f1f5f9);font-size:11px;font-weight:800;color:var(--muted,#64748b)}.as-checklist div{display:flex;flex-direction:column;gap:5px}.as-checklist strong{font-size:13px}.as-checklist small{font-size:12px;color:var(--muted,#718096);line-height:1.5}
      .as-warning{margin:0 18px 18px;padding:14px;background:#fff8e8;border:1px solid #f3dfae;border-radius:10px;color:#795b18}.as-warning strong{font-size:12px}.as-warning p{font-size:12px;line-height:1.5;margin:6px 0 0}.as-denied{padding:24px}.as-denied h2{margin-top:0}.as-denied p{color:var(--muted,#718096)}
      @media(max-width:950px){.as-layout{grid-template-columns:1fr}.as-queue-panel{order:2}}
      @media(max-width:560px){.as-grid{grid-template-columns:1fr}.as-full{grid-column:auto}.as-form{padding:16px}.as-panel-heading{padding:17px}.as-submit-row button{width:100%}}
    </style>
  `;

  if (!canAdd) return;

  const $ = (selector) => root.querySelector(selector);
  const alertBox = $('#as-alert');
  const form = $('#as-form');
  const employeeSelect = $('#as-employee');
  const searchInput = $('#as-employee-search');
  let employees = [];
  let platforms = [];
  let visibleEmployees = [];
  let loadingError = '';
  let seatingQueue = [];
  let submittingQueue = false;

  function showMessage(message, isError = false) {
    alertBox.textContent = message;
    alertBox.classList.remove('hidden');
    alertBox.classList.toggle('alert-error', isError);
    alertBox.classList.toggle('alert-success', !isError);
  }
  function hideMessage() {
    alertBox.textContent = '';
    alertBox.classList.add('hidden');
  }
  function populateEmployees() {
    const search = searchInput.value.trim().toLowerCase();
    visibleEmployees = employees.filter((employee) => {
      const id = String(employee.employeeId ?? employee.id ?? '');
      const name = String(employee.name ?? employee.fullName ?? '');
      return `${id} ${name}`.toLowerCase().includes(search);
    });
    const previous = employeeSelect.value;
    employeeSelect.innerHTML = '<option value="">Select an operation officer</option>' + visibleEmployees.map((employee) => {
      const id = String(employee.employeeId ?? employee.id);
      return `<option value="${esc(id)}">${esc(id)} — ${esc(employee.name || employee.fullName || 'Unnamed')} (${esc(String(employee.department).toUpperCase())})</option>`;
    }).join('');
    if (visibleEmployees.some((employee) => String(employee.employeeId ?? employee.id) === previous)) employeeSelect.value = previous;
    $('#as-employee-help').textContent = `${visibleEmployees.length} active operation officer(s) match your search.`;
  }

  const laptopSelect = $('#as-laptop');
  const accountOptions = $('#as-account-options');
  const withdrawalOptions = $('#as-withdrawal-options');
  const withdrawalField = $('#as-withdrawal-field');
  const accountLabel = $('#as-account-label');

  function setOptions(select, label, options) {
    select.innerHTML = `<option value="">${esc(label)}</option>` + options.map((value) =>
      `<option value="${esc(value)}">${esc(value.replaceAll('_', ' '))}</option>`
    ).join('');
  }
  function renderCheckboxOptions(host, name, label, options, selected = []) {
    host.innerHTML = options.length ? options.map((value) => `
      <label class="as-option"><input type="checkbox" name="${name}" value="${esc(value)}" ${selected.includes(value) ? 'checked' : ''}><span>${esc(value.replaceAll('_', ' '))}</span></label>
    `).join('') : `<span class="as-muted">${esc(label)}</span>`;
  }
  function checkedValues(host) {
    return [...host.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
  }
  function configureEmployeeFields() {
    const employee = employees.find((item) => String(item.employeeId ?? item.id) === employeeSelect.value);
    const department = String(employee?.department || '').toUpperCase();
    if (!employee) {
      setOptions(laptopSelect, 'Select employee first', []);
      accountOptions.innerHTML = '<span class="as-muted">Select employee first</span>';
      withdrawalOptions.innerHTML = '';
      withdrawalField.classList.add('hidden');
      return;
    }
    setOptions(laptopSelect, 'Select workstation', Array.from({ length: 20 }, (_, i) => `${department}-${i + 1}`));
    if (department === 'DP') {
      accountLabel.textContent = 'Handled phone / accounts * (select multiple)';
      renderCheckboxOptions(accountOptions, 'handledAccounts', 'Select accounts', [
        ...Array.from({ length: 20 }, (_, i) => `KBZ ${i + 1}`),
        ...Array.from({ length: 15 }, (_, i) => `Wave ${i + 1}`)
      ]);
      withdrawalField.classList.add('hidden');
    } else if (department === 'GS') {
      accountLabel.textContent = 'GS account status *';
      renderCheckboxOptions(accountOptions, 'handledAccounts', 'Select account status', ['ALREADY_ASSIGNED_ACCOUNTS'], ['ALREADY_ASSIGNED_ACCOUNTS']);
      withdrawalField.classList.add('hidden');
    } else if (department === 'WD') {
      accountLabel.textContent = 'Handled account / 4NS (optional; select multiple)';
      renderCheckboxOptions(accountOptions, 'handledAccounts', 'No account selected', [
        ...Array.from({ length: 20 }, (_, i) => `KBZ ${i + 1}`),
        ...Array.from({ length: 15 }, (_, i) => `Wave ${i + 1}`), 'OTHER'
      ]);
      withdrawalField.classList.remove('hidden');
      renderCheckboxOptions(withdrawalOptions, 'withdrawalWorks', 'Select one or more works', [
        'BIG_MONEY', 'CASH_ERRORS', 'REDEMPTIONS', 'CASH_ACCOUNT_ADDING', 'OTHER'
      ]);
    }
  }

  try {
    const [employeeSnap, platformSnap] = await Promise.all([
      getDocs(query(collection(db, 'employees'), where('status', '==', 'ACTIVE'), limit(1000))),
      getDocs(query(collection(db, 'platforms'), limit(500)))
    ]);
    employees = employeeSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((employee) =>
        operationDepartments.has(String(employee.department || '').toUpperCase())
        && !promotionRoles.has(String(employee.role || employee.promotionRole || '').toUpperCase())
      )
      .sort((a, b) => String(a.name || a.employeeId || a.id).localeCompare(String(b.name || b.employeeId || b.id)));
    platforms = platformSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((platform) => String(platform.status || 'ACTIVE').toUpperCase() === 'ACTIVE')
      .sort((a, b) => String(a.name || a.platformId || a.id).localeCompare(String(b.name || b.platformId || b.id)));
    $('#as-platform').innerHTML = '<option value="">Select platform</option>' + platforms.map((platform) =>
      `<option value="${esc(platform.id)}">${esc(platform.name || platform.platformId || platform.id)}</option>`
    ).join('');
    populateEmployees();
    if (!employees.length) showMessage('No active GS, DP or WD employees found. Check employee status and department fields.', true);
    if (!platforms.length) showMessage('No active platforms found. Add or activate platforms first.', true);
  } catch (error) {
    loadingError = friendlyError(error);
    employeeSelect.innerHTML = '<option value="">Could not load employees</option>';
    $('#as-platform').innerHTML = '<option value="">Could not load platforms</option>';
    showMessage(`Could not load employees/platforms: ${loadingError}`, true);
    return;
  }

  searchInput.addEventListener('input', populateEmployees);
  employeeSelect.addEventListener('change', configureEmployeeFields);
  const addToListButton = $('#as-add-to-list');
  const queueBody = $('#as-queue-body');
  const queueEmpty = $('#as-queue-empty');
  const queueTableWrap = $('#as-queue-table-wrap');
  const queueCount = $('#as-queue-count');
  const queueSummary = $('#as-queue-summary');
  const queueStatus = root.querySelector('.as-queue-status');
  const submitAllButton = $('#as-submit');

  function selectedEmployee() {
    return employees.find((item) => String(item.employeeId ?? item.id) === employeeSelect.value);
  }

  function renderQueue() {
    queueCount.textContent = `${seatingQueue.length} employee${seatingQueue.length === 1 ? '' : 's'} added`;
    queueSummary.textContent = `${seatingQueue.length} assignment${seatingQueue.length === 1 ? '' : 's'} ready to submit`;
    queueEmpty.classList.toggle('hidden', seatingQueue.length > 0);
    queueTableWrap.classList.toggle('hidden', seatingQueue.length === 0);
    submitAllButton.disabled = seatingQueue.length === 0 || submittingQueue;
    queueBody.innerHTML = seatingQueue.map((item, index) => `
      <tr>
        <td><strong>${esc(item.employeeName || item.employeeId)}</strong><small>${esc(item.employeeId)}</small></td>
        <td>${esc(item.department)}</td>
        <td>${esc(item.platformName)}<small>${esc(item.businessDate)} · ${esc(item.shift)}</small></td>
        <td>${esc(item.laptopName)}</td>
        <td>${esc(item.department === 'DP' ? (item.handledAccounts || []).join(', ') : item.department === 'WD' ? [...(item.handledAccounts || []), ...(item.withdrawalWorks || [])].join(' · ') || 'Not specified' : item.handledAccount || '—')}</td>
        <td><button type="button" class="as-queue-remove" data-remove-queue="${index}" ${submittingQueue ? 'disabled' : ''}>Remove</button></td>
      </tr>`).join('');
    queueBody.querySelectorAll('[data-remove-queue]').forEach((button) => button.addEventListener('click', () => {
      seatingQueue.splice(Number(button.dataset.removeQueue), 1);
      renderQueue();
    }));
  }

  addToListButton.addEventListener('click', async () => {
    hideMessage();
    if (!form.reportValidity()) return;
    const formData = new FormData(form);
    const businessDate = String(formData.get('businessDate') || '');
    const shift = String(formData.get('shift') || '');
    const platformId = String(formData.get('platformId') || '');
    const employeeId = String(formData.get('employeeId') || '');
    const laptopName = String(formData.get('laptopName') || '').trim();
    const handledAccounts = checkedValues(accountOptions);
    const handledAccount = handledAccounts[0] || '';
    const withdrawalWorks = checkedValues(withdrawalOptions);
    const employee = selectedEmployee();
    const platform = platforms.find((item) => item.id === platformId);
    const department = String(employee?.department || '').toUpperCase();

    if (!businessDate || !['MORNING', 'NIGHT'].includes(shift) || !platform || !employee || !laptopName
      || (department === 'DP' && handledAccounts.length === 0)
      || (department === 'GS' && !handledAccounts.includes('ALREADY_ASSIGNED_ACCOUNTS'))
      || (department === 'WD' && withdrawalWorks.length === 0)) {
      showMessage('Complete the date, shift, platform, employee and department-specific fields before adding this person.', true);
      return;
    }
    const duplicate = seatingQueue.some((item) => item.employeeId === employeeId && item.businessDate === businessDate && item.shift === shift);
    if (duplicate) {
      showMessage(`${employee.name || employeeId} is already in this list for the same date and shift.`, true);
      return;
    }

    // Never silently move an employee from an existing platform. Create a transfer request
    // and keep the existing seating intact until the previous platform PIC reviews it.
    try {
      const existingSnap = await getDocs(query(
        collection(db, 'seatings'),
        where('employeeId', '==', employeeId),
        limit(100)
      ));
      const current = existingSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .find((row) => (row.businessDate || row.date) === businessDate && row.shift === shift && !['CANCELLED', 'TRANSFERRED', 'REJECTED'].includes(String(row.status || '').toUpperCase()));
      if (current) {
        if (String(current.platformId) === String(platformId)) {
          showMessage(`${employee.name || employeeId} is already seated on this platform for ${businessDate} ${shift}. Existing seating was not changed.`, true);
          return;
        }
        let fromPicId = '';
        try {
          const assignmentSnap = await getDocs(query(collection(db, 'picAssignments'), limit(500)));
          const assigned = assignmentSnap.docs.map((d) => d.data()).find((a) =>
            String(a.platformId) === String(current.platformId)
            && String(a.date || a.businessDate) === businessDate
            && String(a.shift).toUpperCase() === shift
            && String(a.status || 'ACTIVE').toUpperCase() === 'ACTIVE'
          );
          fromPicId = String(assigned?.picId || assigned?.employeeId || '');
        } catch { /* request remains visible to Admin if PIC assignments are unreadable */ }
        const requestRef = await addDoc(collection(db, 'seatingChangeRequests'), {
          requestType: 'TRANSFER',
          employeeId,
          employeeName: employee.name || employee.fullName || employeeId,
          department,
          businessDate,
          date: businessDate,
          shift,
          fromSeatingId: current.id,
          fromPlatformId: current.platformId || '',
          fromPlatformName: current.platformName || current.platformId || '',
          fromPicId,
          toPlatformId: platformId,
          toPlatformName: platform.name || platform.platformId || platform.id,
          toLaptopName: laptopName,
          handledAccount,
          handledAccounts,
          withdrawalWorks,
          withdrawalWork: withdrawalWorks[0] || 'NOT_APPLICABLE',
          requestedBy: profile?.employeeId || profile?.name || 'UNKNOWN',
          requestedByName: profile?.name || '',
          status: 'PENDING',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        showMessage(`${employee.name || employeeId} is already seated on ${current.platformName || current.platformId}. Transfer request ${requestRef.id} sent for the previous platform PIC to review. Existing seating has not been changed.`);
        return;
      }
    } catch (error) {
      showMessage(`Could not check existing seating or create transfer request: ${friendlyError(error)}. No seating was changed.`, true);
      return;
    }
    seatingQueue.push({
      businessDate, shift, platformId, platformName: platform.name || platform.platformId || platform.id,
      employeeId, employeeName: employee.name || employee.fullName || employeeId, employeeDocId: employee.id,
      department, laptopName, handledAccount, handledAccounts, withdrawalWorks
    });
    renderQueue();
    showMessage(`${employee.name || employeeId} added to the seating list. Add another employee or submit the full list.`);

    // Keep date, shift and platform for fast consecutive entries; reset employee-specific fields.
    searchInput.value = '';
    populateEmployees();
    employeeSelect.value = '';
    configureEmployeeFields();
  });

  submitAllButton.addEventListener('click', async () => {
    if (!seatingQueue.length || submittingQueue) return;
    hideMessage();
    const submitLabel = submitAllButton.textContent;
    submittingQueue = true;
    submitAllButton.disabled = true;
    submitAllButton.textContent = 'Submitting all…';
    addToListButton.disabled = true;
    queueStatus.textContent = 'Submitting';

    try {
      const queued = [...seatingQueue];
      const seatingRefs = queued.map((item) => {
        const id = `${item.businessDate}_${item.shift}_${item.employeeId}`.replace(/[\/.#$\[\]]/g, '_');
        return { item, id, ref: doc(db, 'seatings', id) };
      });
      await runTransaction(db, async (transaction) => {
        const existingSnaps = await Promise.all(seatingRefs.map(({ ref }) => transaction.get(ref)));
        const employeeRefs = queued.map((item) => doc(db, 'employees', String(item.employeeDocId)));
        const employeeSnaps = await Promise.all(employeeRefs.map((ref) => transaction.get(ref)));

        for (let index = 0; index < seatingRefs.length; index += 1) {
          const { item, id, ref } = seatingRefs[index];
          const existingSnap = existingSnaps[index];
          if (existingSnap.exists() && String(existingSnap.data().status || '').toUpperCase() !== 'CANCELLED') {
            throw new Error(`DUPLICATE_SEATING:${item.employeeName} (${item.employeeId}) already has seating on ${item.businessDate} ${item.shift}.`);
          }
          const employeeSnap = employeeSnaps[index];
          if (!employeeSnap.exists()) throw new Error(`EMPLOYEE_NOT_FOUND:${item.employeeId}`);
          const currentEmployee = employeeSnap.data();
          if (String(currentEmployee.status || '').toUpperCase() !== 'ACTIVE'
            || !operationDepartments.has(String(currentEmployee.department || '').toUpperCase())
            || promotionRoles.has(String(currentEmployee.role || currentEmployee.promotionRole || '').toUpperCase())) {
            throw new Error(`EMPLOYEE_NOT_ELIGIBLE:${item.employeeId}`);
          }
          transaction.set(ref, {
            seatingId: id,
            businessDate: item.businessDate,
            date: item.businessDate,
            shift: item.shift,
            employeeId: item.employeeId,
            employeeName: currentEmployee.name || currentEmployee.fullName || item.employeeName || '',
            employeeType: currentEmployee.employeeType || currentEmployee.type || 'OTHER',
            platformId: item.platformId,
            platformName: item.platformName,
            laptopName: item.laptopName,
            handledAccount: item.department === 'GS' ? 'ALREADY_ASSIGNED_ACCOUNTS' : item.handledAccount,
            handledAccounts: item.handledAccounts || [],
            withdrawalWorks: item.withdrawalWorks || [],
            withdrawalWork: (item.withdrawalWorks || [])[0] || 'NOT_APPLICABLE',
            status: 'PENDING',
            createdBy: profile?.employeeId || profile?.name || 'UNKNOWN',
            createdByName: profile?.name || '',
            createdByRole: userRole,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            approvedBy: null,
            approvedAt: null,
            changeCount: 0
          });
        }
      });

      const savedCount = seatingQueue.length;
      seatingQueue = [];
      renderQueue();
      form.reset();
      form.elements.businessDate.value = colomboDate();
      form.elements.shift.value = colomboShift();
      populateEmployees();
      configureEmployeeFields();
      queueStatus.textContent = 'Submitted';
      showMessage(`Successfully submitted ${savedCount} seating assignment${savedCount === 1 ? '' : 's'} for PIC approval.`);
    } catch (error) {
      const message = String(error?.message || '');
      queueStatus.textContent = 'Not submitted';
      if (message.startsWith('DUPLICATE_SEATING:')) {
        showMessage(`${message.slice('DUPLICATE_SEATING:'.length)} Remove that person from this list or resolve the existing seating first. No assignments in this batch were saved.`, true);
      } else if (message.startsWith('EMPLOYEE_NOT_FOUND:') || message.startsWith('EMPLOYEE_NOT_ELIGIBLE:')) {
        showMessage(`${message.split(':')[1]} is no longer eligible for seating. Refresh and check the employee list. No assignments in this batch were saved.`, true);
      } else {
        showMessage(`Could not submit the seating list: ${friendlyError(error)}. Check Firestore Security Rules if permission is denied.`, true);
      }
    } finally {
      submittingQueue = false;
      submitAllButton.disabled = seatingQueue.length === 0;
      submitAllButton.textContent = submitLabel;
      addToListButton.disabled = false;
      renderQueue();
    }
  });
}
