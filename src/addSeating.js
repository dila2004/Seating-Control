import {
  collection, doc, getDoc, getDocs, limit, query, serverTimestamp,
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
              <label class="as-field as-full"><span>Operation officer *</span><select name="employeeId" id="as-employee" required><option value="">Load active employees first</option></select><small id="as-employee-help">Only active GS, DP and WD employees are listed.</small><small id="as-employee-details">Name and role will appear here after selection.</small></label>
              <label class="as-field"><span>Laptop / workstation *</span><select name="laptopName" id="as-laptop" required><option value="">Select employee first</option></select></label>
              <fieldset class="as-field hidden" id="as-account-field" style="border:0;padding:0;margin:0"><legend id="as-account-label">Handled phones / accounts *</legend><div id="as-account-options" class="as-check-options"></div></fieldset>
              <fieldset class="as-field as-full hidden" id="as-withdrawal-field" style="border:0;padding:0;margin:0"><legend>Withdrawal work *</legend><div id="as-withdrawal-options" class="as-check-options"></div></fieldset>
            </div>
            <div class="as-submit-row"><p>Submission creates a <strong>PENDING</strong> record for PIC review.</p><button id="as-submit" type="submit" class="button button-primary">Submit for PIC approval</button></div>
          </form>
        </section>
        <aside class="panel as-side-panel">
          <div class="as-panel-heading"><div><h2>Before you submit</h2><p>Quick validation checklist</p></div></div>
          <ul class="as-checklist">
            <li><span>01</span><div><strong>Correct shift and date</strong><small>Check the selected business date and shift.</small></div></li>
            <li><span>02</span><div><strong>Correct operation officer</strong><small>Only active GS, DP and WD employees can be assigned.</small></div></li>
            <li><span>03</span><div><strong>One active assignment</strong><small>The page checks for an existing record for the same employee, date and shift.</small></div></li>
            <li><span>04</span><div><strong>PIC review</strong><small>Submitted seating remains pending until reviewed.</small></div></li>
          </ul>
          <div class="as-warning"><strong>Security note</strong><p>Firestore Security Rules must allow authorized GS/Admin creates before this form can save. Frontend checks alone are not security enforcement.</p></div>
        </aside>
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
      .as-note strong{white-space:nowrap}.as-layout{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(270px,1fr);gap:18px;align-items:start}
      .as-form-panel,.as-side-panel{padding:0;overflow:hidden}.as-panel-heading{padding:20px 22px;border-bottom:1px solid var(--border,#e3e8ef);display:flex;justify-content:space-between;gap:12px;align-items:center}
      .as-panel-heading h2{margin:0;font-size:17px}.as-panel-heading p{margin:6px 0 0;font-size:12px;color:var(--muted,#718096)}.as-required{font-size:11px;color:var(--muted,#718096)}
      .as-form{padding:22px}.as-grid{display:grid;grid-template-columns:1fr 1fr;gap:17px}.as-field{display:flex;flex-direction:column;gap:7px;min-width:0;font-size:12px;font-weight:700;color:var(--muted,#64748b)}.as-full{grid-column:1/-1}
      .as-field input,.as-field select{width:100%;box-sizing:border-box;min-height:42px;border:1px solid var(--border,#dbe3ee);border-radius:9px;padding:10px 12px;background:var(--surface,#fff);color:var(--text,#172b4d);font:inherit;font-weight:500}
      .as-field small{font-weight:400;font-size:11px;color:var(--muted,#718096)}.as-check-options{display:grid;grid-template-columns:repeat(auto-fit,minmax(125px,1fr));gap:8px}.as-check-option{display:flex;align-items:center;gap:8px;padding:10px;border:1px solid var(--border,#dbe3ee);border-radius:8px;background:var(--surface,#fff);font-weight:600;color:var(--text,#172b4d)}.as-check-option input{width:auto;min-height:auto;margin:0}.as-submit-row{margin-top:22px;padding-top:18px;border-top:1px solid var(--border,#e3e8ef);display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}.as-submit-row p{font-size:12px;color:var(--muted,#718096);margin:0;max-width:340px}
      .as-checklist{list-style:none;padding:8px 22px 18px;margin:0;display:flex;flex-direction:column;gap:18px}.as-checklist li{display:flex;gap:12px}.as-checklist li>span{display:grid;place-items:center;width:30px;height:30px;flex:0 0 30px;border-radius:9px;background:var(--surface-subtle,#f1f5f9);font-size:11px;font-weight:800;color:var(--muted,#64748b)}.as-checklist div{display:flex;flex-direction:column;gap:5px}.as-checklist strong{font-size:13px}.as-checklist small{font-size:12px;color:var(--muted,#718096);line-height:1.5}
      .as-warning{margin:0 18px 18px;padding:14px;background:#fff8e8;border:1px solid #f3dfae;border-radius:10px;color:#795b18}.as-warning strong{font-size:12px}.as-warning p{font-size:12px;line-height:1.5;margin:6px 0 0}.as-denied{padding:24px}.as-denied h2{margin-top:0}.as-denied p{color:var(--muted,#718096)}
      @media(max-width:950px){.as-layout{grid-template-columns:1fr}.as-side-panel{order:2}}
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
      const id = String(employee.id);
      return `<option value="${esc(id)}">${esc(id)} — ${esc(employee.name || employee.fullName || 'Unnamed')} (${esc(String(employee.department).toUpperCase())})</option>`;
    }).join('');
    if (visibleEmployees.some((employee) => String(employee.id) === previous)) employeeSelect.value = previous;
    $('#as-employee-help').textContent = `${visibleEmployees.length} active operation officer(s) match your search.`;
    // Automatically select an exact employee number or exact full-name match.
    if (search) {
      const exact = visibleEmployees.filter((employee) => {
        const id = String(employee.employeeId ?? employee.id ?? '').trim().toLowerCase();
        const name = String(employee.name ?? employee.fullName ?? '').trim().toLowerCase();
        return id === search || name === search;
      });
      if (exact.length === 1) {
        employeeSelect.value = String(exact[0].id);
        configureEmployeeFields();
      }
    }
  }

  const laptopSelect = $('#as-laptop');
  const accountOptions = $('#as-account-options');
  const accountField = $('#as-account-field');
  const withdrawalField = $('#as-withdrawal-field');
  const withdrawalOptions = $('#as-withdrawal-options');
  const accountLabel = $('#as-account-label');

  function setCheckboxes(container, name, options) {
    container.innerHTML = options.map((value) => `<label class="as-check-option"><input type="checkbox" name="${name}" value="${esc(value)}"><span>${esc(value.replaceAll('_', ' '))}</span></label>`).join('');
  }
  function checkedValues(name) { return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((el) => el.value); }

  function configureAccountOptionsForPlatform() {
    const platform = platforms.find((item) => item.id === $('#as-platform').value);
    const kbzCount = Math.max(0, Math.min(100, Number(platform?.kbzCount ?? platform?.accountCounts?.kbz ?? 20)));
    const waveCount = Math.max(0, Math.min(100, Number(platform?.waveCount ?? platform?.accountCounts?.wave ?? 15)));
    const employee = employees.find((item) => String(item.id) === employeeSelect.value);
    if (String(employee?.department || '').toUpperCase() !== 'DP') return;
    const selected = new Set(checkedValues('handledAccounts'));
    const options = [
      ...Array.from({ length: kbzCount }, (_, i) => `KBZ ${i + 1}`),
      ...Array.from({ length: waveCount }, (_, i) => `Wave ${i + 1}`)
    ];
    setCheckboxes(accountOptions, 'handledAccounts', options);
    accountOptions.querySelectorAll('input[name="handledAccounts"]').forEach((input) => {
      input.checked = selected.has(input.value);
    });
  }

  function configureEmployeeFields() {
    const employee = employees.find((item) => String(item.id) === employeeSelect.value);
    $('#as-employee-details').textContent = employee ? `Selected: ${employee.name || employee.fullName || 'Unnamed'} · ${employee.role || employee.promotionRole || 'Operation Officer'} · ${employee.department || ''} · ${employee.employeeId || employee.id}` : 'Name and role will appear here after selection.';
    const department = String(employee?.department || '').toUpperCase();
    if (!employee) {
      laptopSelect.innerHTML = '<option value="">Select employee first</option>';
      accountOptions.innerHTML = ''; withdrawalOptions.innerHTML = ''; 
      accountField.classList.add('hidden');
      withdrawalField.classList.add('hidden');
      
      return;
    }

    laptopSelect.innerHTML = '<option value="">Select workstation</option>' + Array.from({ length: 20 }, (_, i) => `${department}-${i + 1}`).map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');

    if (department === 'DP') {
      accountField.classList.remove('hidden');
      accountLabel.textContent = 'Handled phone / account *';
      configureAccountOptionsForPlatform();
      withdrawalField.classList.add('hidden');
      withdrawalOptions.innerHTML = '';
    } else if (department === 'GS') {
      accountField.classList.add('hidden');
      accountOptions.innerHTML = '';
      withdrawalField.classList.add('hidden');
      withdrawalOptions.innerHTML = '';
    } else if (department === 'WD') {
      accountField.classList.add('hidden');
      accountOptions.innerHTML = '';
      withdrawalField.classList.remove('hidden');
      setCheckboxes(withdrawalOptions, 'withdrawalWorks', ['BIG_MONEY', 'CASH_ERRORS', 'REDEMPTIONS', 'CASH_ACCOUNT_ADDING', 'OTHER']);
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
  $('#as-platform').addEventListener('change', configureAccountOptionsForPlatform);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideMessage();

    const submit = $('#as-submit');
    const formData = new FormData(form);
    const businessDate = String(formData.get('businessDate') || '');
    const shift = String(formData.get('shift') || '');
    const platformId = String(formData.get('platformId') || '');
    const employeeDocId = String(formData.get('employeeId') || '');
    const laptopName = String(formData.get('laptopName') || '').trim();
    const handledAccounts = checkedValues('handledAccounts');
    const withdrawalWorks = checkedValues('withdrawalWorks');
    let handledAccount = handledAccounts.join(', ');
    const withdrawalWork = withdrawalWorks.join(', ');
    const employee = employees.find((item) => String(item.id) === employeeDocId);
    const employeeId = String(employee?.employeeId ?? employee?.id ?? '');
    const department = String(employee?.department || '').toUpperCase();
    if (department === 'GS' || department === 'WD') handledAccount = 'NOT_APPLICABLE';
    const platform = platforms.find((item) => item.id === platformId);

    if (!businessDate || !['MORNING', 'NIGHT'].includes(shift) || !platform || !employee || !laptopName || (department === 'DP' && handledAccounts.length === 0) || (department === 'WD' && withdrawalWorks.length === 0)) {
      showMessage('Please complete all required fields and select valid employee/platform records.', true);
      return;
    }

    const id = `${businessDate}_${shift}_${employeeId}`.replace(/[\/.#$[\]]/g, '_');
    const seatingRef = doc(db, 'seatings', id);
    submit.disabled = true;
    submit.textContent = 'Submitting…';

    try {
      await runTransaction(db, async (transaction) => {
        const existing = await transaction.get(seatingRef);
        if (existing.exists()) {
          const existingData = existing.data();
          if (String(existingData.status || '').toUpperCase() !== 'CANCELLED') {
            throw new Error(`DUPLICATE_SEATING:${existingData.platformId || 'another platform'}`);
          }
        }
        const employeeRef = doc(db, 'employees', String(employee.id));
        const employeeSnap = await transaction.get(employeeRef);
        if (!employeeSnap.exists()) throw new Error('EMPLOYEE_NOT_FOUND');
        const currentEmployee = employeeSnap.data();
        if (String(currentEmployee.status || '').toUpperCase() !== 'ACTIVE'
          || !operationDepartments.has(String(currentEmployee.department || '').toUpperCase())
          || promotionRoles.has(String(currentEmployee.role || currentEmployee.promotionRole || '').toUpperCase())) {
          throw new Error('EMPLOYEE_NOT_ELIGIBLE');
        }

        transaction.set(seatingRef, {
          seatingId: id,
          businessDate,
          date: businessDate,
          shift,
          employeeId,
          employeeDocId: String(currentEmployee.id || employee.id),
          employeeName: currentEmployee.name || currentEmployee.fullName || employee.name || '',
          employeeType: currentEmployee.employeeType || currentEmployee.type || 'OTHER',
          platformId,
          platformName: platform.name || platform.platformId || platform.id,
          laptopName,
          handledAccount,
          handledAccounts: department === 'DP' ? handledAccounts : [],
          withdrawalWork,
          withdrawalWorks: department === 'WD' ? withdrawalWorks : [],
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
      });

      showMessage(`Seating submitted for ${employee.name || employeeId} (${employeeId}). Status: PENDING.`);
      form.reset();
      form.elements.businessDate.value = colomboDate();
      form.elements.shift.value = colomboShift();
      populateEmployees();
    } catch (error) {
      const message = String(error?.message || '');
      if (message.startsWith('DUPLICATE_SEATING:')) {
        showMessage(`Active seating already exists for this employee, date and shift (platform: ${message.split(':').slice(1).join(':')}). Use an authorized platform-change workflow instead of adding a duplicate.`, true);
      } else if (message === 'EMPLOYEE_NOT_FOUND' || message === 'EMPLOYEE_NOT_ELIGIBLE') {
        showMessage('This employee is no longer eligible for seating. Refresh the page and choose an active GS, DP or WD employee.', true);
      } else {
        showMessage(`Could not submit seating: ${friendlyError(error)}. If this is a permission error, the matching Firestore Rules have not yet enabled authorized seating creation.`, true);
      }
    } finally {
      submit.disabled = false;
      submit.textContent = 'Submit for PIC approval';
    }
  });
}
