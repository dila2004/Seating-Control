import { collection, getDocs, limit, query, doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase.js';
import { friendlyError } from './auth.js';
import * as XLSX from 'xlsx';

const DEPARTMENTS = ['GS', 'DP', 'WD'];
const STATUSES = ['ACTIVE', 'INACTIVE'];
const clean = (v) => String(v ?? '').trim();
const normId = (v) => clean(v).toUpperCase();
const normStatus = (v) => clean(v || 'ACTIVE').toUpperCase();
const validId = (v) => /^[A-Z0-9-]{2,30}$/.test(v);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export async function renderEmployeesPage(container, profile) {
  const canManage = profile?.role === 'ADMIN' && profile?.status === 'ACTIVE';
  container.innerHTML = `
  <section class="module-page">
    <div class="module-heading"><div><div class="eyebrow">WORKSPACE / PEOPLE</div><h1>Employees</h1><p>Manage GS, DP and WD employees. PIC monitoring is managed separately.</p></div>
      ${canManage ? `<div class="module-heading-actions"><button class="button button-outline" id="download-employee-template">Download Excel template</button><button class="button button-primary" id="add-employee">＋ Add employee</button><button class="button button-outline" id="import-employees">Import Excel</button><input id="employee-file" type="file" accept=".xlsx,.xls,.csv" hidden></div>` : ''}
    </div>
    <div class="module-toolbar"><label class="search-box"><span>⌕</span><input id="employee-search" type="search" placeholder="Search name, ID, department, platform…"></label>
      <select id="employee-department-filter" class="filter-select"><option value="ALL">All departments</option><option>GS</option><option>DP</option><option>WD</option></select>
      <select id="employee-status-filter" class="filter-select"><option value="ALL">All statuses</option><option>ACTIVE</option><option>INACTIVE</option></select><button class="button button-outline" id="reload-employees">↻ Refresh</button>
    </div>
    <div class="module-summary" id="employee-summary"></div>
    <div class="panel module-table-panel"><div class="panel-heading"><div><h3>Employee directory</h3><p>Employee department and PIC monitoring are separate records.</p></div><span class="panel-chip" id="employee-result-count">Loading…</span></div>
      <div id="employee-message" class="module-message hidden" role="status"></div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Employee</th><th>Employee ID</th><th>Department</th><th>Platform</th><th>Status</th>${canManage ? '<th>Actions</th>' : ''}</tr></thead><tbody id="employee-rows"><tr><td colspan="${canManage ? 6 : 5}" class="table-empty">Loading employees…</td></tr></tbody></table></div>
    </div>
  </section>
  <style>.employee-row-actions{display:flex;gap:6px;align-items:center;white-space:nowrap}.employee-row-actions .button{padding:6px 10px;font-size:12px}.employee-row-actions .employee-remove{color:#b42318;border-color:#f2c5c2}</style>
  <div class="modal-backdrop hidden" id="employee-modal" role="dialog" aria-modal="true" aria-labelledby="employee-modal-title"><div class="modal-card">
    <div class="modal-heading"><div><div class="eyebrow">EMPLOYEE MANAGEMENT</div><h2 id="employee-modal-title">Add employee</h2></div><button class="icon-button" id="close-employee-modal">×</button></div>
    <form id="employee-form">
      <label for="emp-id">Employee ID</label><input id="emp-id" name="employeeId" required maxlength="30" placeholder="e.g. 00475" pattern="[A-Za-z0-9-]{2,30}">
      <label for="emp-name">Full name</label><input id="emp-name" name="name" required maxlength="100" placeholder="Employee name">
      <label for="emp-department">Department</label><select id="emp-department" name="department" required><option value="GS">GS — Google Sheet</option><option value="DP">DP — Deposit</option><option value="WD">WD — Withdrawal</option></select>
      <label for="emp-platform">Default platform ID</label><input id="emp-platform" name="platformId" required maxlength="60" placeholder="Use an existing platform ID">
      <label for="emp-status">Status</label><select id="emp-status" name="status"><option value="ACTIVE">ACTIVE</option><option value="INACTIVE">INACTIVE</option></select>
      <div class="modal-actions"><button type="button" class="button button-outline" id="cancel-employee">Cancel</button><button type="submit" class="button button-primary" id="save-employee">Save employee</button></div>
    </form></div></div>
  <div class="modal-backdrop hidden" id="import-modal" role="dialog" aria-modal="true"><div class="modal-card">
    <div class="modal-heading"><div><div class="eyebrow">BULK IMPORT</div><h2>Review Excel import</h2></div><button class="icon-button" id="close-import-modal">×</button></div>
    <div id="import-summary" class="module-message"></div><div class="table-wrap"><table class="data-table"><thead><tr><th>ID</th><th>Name</th><th>Dept</th><th>Platform</th><th>Status</th><th>Validation</th></tr></thead><tbody id="import-rows"></tbody></table></div>
    <div class="modal-actions"><button class="button button-outline" id="cancel-import">Cancel</button><button class="button button-primary" id="confirm-import" disabled>Import valid rows</button></div>
  </div></div>`;

  const $ = s => container.querySelector(s);
  let employees = [], importRows = [], editingEmployeeId = null;
  const message = (txt, error=false) => { $('#employee-message').textContent=txt; $('#employee-message').classList.remove('hidden'); $('#employee-message').classList.toggle('warning-message', error); };
  const close = () => { $('#employee-modal').classList.add('hidden'); editingEmployeeId = null; $('#emp-id').readOnly = false; $('#employee-modal-title').textContent = 'Add employee'; $('#save-employee').textContent = 'Save employee'; };
  const closeImport = () => $('#import-modal').classList.add('hidden');

  function renderRows() {
    const term = $('#employee-search').value.trim().toLowerCase(), dept = $('#employee-department-filter').value, status = $('#employee-status-filter').value;
    const filtered = employees.filter(e => [e.name,e.employeeId,e.department,e.platformId,e.defaultPlatform].join(' ').toLowerCase().includes(term) && (dept==='ALL'||e.department===dept) && (status==='ALL'||normStatus(e.status)===status));
    $('#employee-result-count').textContent = `${filtered.length} shown`;
    $('#employee-rows').innerHTML = filtered.length ? filtered.map(e => `<tr><td><div class="table-primary-text">${esc(e.name)}</div></td><td><code class="id-chip">${esc(e.employeeId||e.id)}</code></td><td>${esc(e.department)}</td><td>${esc(e.platformId||e.defaultPlatform||'—')}</td><td><span class="status-pill ${normStatus(e.status)==='ACTIVE'?'complete':'empty'}">${esc(normStatus(e.status))}</span></td>${canManage ? `<td><div class="employee-row-actions"><button type="button" class="button button-outline employee-edit" data-id="${esc(e.id)}">Edit</button><button type="button" class="button button-outline employee-remove" data-id="${esc(e.id)}">Remove</button></div></td>` : ''}</tr>`).join('') : `<tr><td colspan="${canManage ? 6 : 5}" class="table-empty">No employees match these filters.</td></tr>`;
    if (canManage) {
      $('#employee-rows').querySelectorAll('.employee-edit').forEach(button => button.addEventListener('click', () => startEdit(button.dataset.id)));
      $('#employee-rows').querySelectorAll('.employee-remove').forEach(button => button.addEventListener('click', () => removeEmployee(button.dataset.id)));
    }
    const active=employees.filter(e=>normStatus(e.status)==='ACTIVE').length;
    $('#employee-summary').innerHTML = `<div class="module-summary-item"><span>Total employees</span><strong>${employees.length}</strong></div><div class="module-summary-item"><span>Active</span><strong>${active}</strong></div><div class="module-summary-item"><span>Inactive</span><strong>${employees.length-active}</strong></div>`;
  }
  async function load() {
    $('#reload-employees').disabled=true;
    try { const snap=await getDocs(query(collection(db,'employees'),limit(500))); employees=snap.docs.map(d=>({id:d.id,...d.data()})); renderRows(); if(!employees.length) message('No employee records found yet.'); else $('#employee-message').classList.add('hidden'); }
    catch(e) { $('#employee-rows').innerHTML=`<tr><td colspan="5" class="table-empty">Could not load: ${esc(friendlyError(e))}</td></tr>`; message(friendlyError(e),true); }
    finally { $('#reload-employees').disabled=false; }
  }
  function validate(raw, existing) {
    const employeeId=normId(raw.employeeId??raw['Employee ID']??raw.id), name=clean(raw.name??raw.Name), department=clean(raw.department??raw.Department).toUpperCase(), platformId=clean(raw.platformId??raw.platform??raw.Platform), status=normStatus(raw.status??raw.Status);
    const errors=[]; if(!validId(employeeId)) errors.push('Invalid employee ID'); if(!name||name.length>100) errors.push('Name required (max 100)'); if(!DEPARTMENTS.includes(department)) errors.push('Department must be GS, DP or WD'); if(!platformId||platformId.length>60) errors.push('Platform ID required (max 60)'); if(!STATUSES.includes(status)) errors.push('Status must be ACTIVE or INACTIVE'); if(existing.has(employeeId)) errors.push('Employee ID already exists');
    return {employeeId,name,department,platformId,status,errors};
  }
  async function saveRows(rows) {
    let saved=0; const failures=[];
    for(const row of rows) {
      try {
        const ref=doc(db,'employees',row.employeeId);
        if((await getDoc(ref)).exists()) { failures.push(`${row.employeeId}: Employee ID already exists`); continue; }
        await setDoc(ref,{employeeId:row.employeeId,name:row.name,department:row.department,role:'',platformId:row.platformId,defaultPlatform:row.platformId,status:row.status,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
        saved++;
      } catch(e) { failures.push(`${row.employeeId}: ${friendlyError(e)}`); }
    }
    await load(); return {saved,failures};
  }
  async function startEdit(id) {
    const employee = employees.find(item => item.id === id);
    if (!employee) return;
    editingEmployeeId = id;
    $('#employee-modal-title').textContent = 'Edit employee';
    $('#save-employee').textContent = 'Save changes';
    $('#emp-id').value = employee.employeeId || employee.id;
    $('#emp-id').readOnly = true;
    $('#emp-name').value = employee.name || '';
    $('#emp-department').value = employee.department || 'GS';
    $('#emp-platform').value = employee.platformId || employee.defaultPlatform || '';
    $('#emp-status').value = normStatus(employee.status);
    $('#employee-modal').classList.remove('hidden');
  }
  async function removeEmployee(id) {
    const employee = employees.find(item => item.id === id);
    if (!employee) return;
    if (!window.confirm(`Remove employee ${employee.name || employee.employeeId || id}? This permanently deletes the employee record and cannot be undone.`)) return;
    try {
      await deleteDoc(doc(db, 'employees', id));
      message(`Employee ${employee.employeeId || id} removed.`);
      await load();
    } catch (error) {
      message(`Could not remove employee: ${friendlyError(error)}`, true);
    }
  }

  if(canManage) {
    $('#add-employee').addEventListener('click',()=>{
      editingEmployeeId = null;
      $('#employee-modal-title').textContent = 'Add employee';
      $('#save-employee').textContent = 'Save employee';
      $('#employee-form').reset();
      $('#emp-id').readOnly = false;
      $('#employee-modal').classList.remove('hidden');
    });
    $('#close-employee-modal').addEventListener('click',close); $('#cancel-employee').addEventListener('click',close);
    $('#employee-form').addEventListener('submit',async ev=>{
      ev.preventDefault();
      const raw = Object.fromEntries(new FormData(ev.currentTarget).entries());
      const btn=$('#save-employee'); btn.disabled=true; btn.textContent='Saving…';
      try {
        if (editingEmployeeId) {
          const employeeId = normId(raw.employeeId);
          const name = clean(raw.name);
          const department = clean(raw.department).toUpperCase();
          const platformId = clean(raw.platformId);
          const status = normStatus(raw.status);
          const errors = [];
          if (!validId(employeeId)) errors.push('Invalid employee ID');
          if (!name || name.length > 100) errors.push('Name required (max 100)');
          if (!DEPARTMENTS.includes(department)) errors.push('Department must be GS, DP or WD');
          if (!platformId || platformId.length > 60) errors.push('Platform ID required (max 60)');
          if (!STATUSES.includes(status)) errors.push('Status must be ACTIVE or INACTIVE');
          if (errors.length) { message(errors.join('. '), true); return; }
          await updateDoc(doc(db, 'employees', editingEmployeeId), { name, department, platformId, defaultPlatform: platformId, status, updatedAt: serverTimestamp() });
          close(); ev.currentTarget.reset(); editingEmployeeId = null;
          $('#emp-id').readOnly = false;
          message(`Employee ${employeeId} updated.`);
          await load();
        } else {
          const row=validate(raw,new Set(employees.map(e=>normId(e.employeeId||e.id))));
          if(row.errors.length){message(row.errors.join('. '),true);return;}
          const result=await saveRows([row]);
          if(result.saved){close();ev.currentTarget.reset();message(`Employee ${row.employeeId} saved.`);} else message(result.failures.join(' | ')||'Could not save.',true);
        }
      } catch (error) {
        message(`Could not save employee: ${friendlyError(error)}`, true);
      } finally {
        btn.disabled=false; btn.textContent=editingEmployeeId ? 'Save changes' : 'Save employee';
      }
    });
    $('#download-employee-template').addEventListener('click',()=>{
      const sheet=XLSX.utils.json_to_sheet([{'Employee ID':'',Name:'',Department:'GS',Platform:'',Status:'ACTIVE'}]);
      const book=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book,sheet,'Employees'); XLSX.writeFile(book,'employee-import-template.xlsx');
    });
    $('#import-employees').addEventListener('click',()=>$('#employee-file').click());
    $('#employee-file').addEventListener('change',async ev=>{
      const file=ev.target.files?.[0]; if(!file)return;
      try {
        const wb=XLSX.read(await file.arrayBuffer(),{type:'array'}), sheet=wb.Sheets[wb.SheetNames[0]], raw=XLSX.utils.sheet_to_json(sheet,{defval:'',raw:false}), existing=new Set(employees.map(e=>normId(e.employeeId||e.id))), seen=new Set();
        importRows=raw.map(item=>{const r=validate(item,existing);if(seen.has(r.employeeId))r.errors.push('Duplicate ID in this file');if(r.employeeId)seen.add(r.employeeId);return r;});
        const good=importRows.filter(r=>!r.errors.length).length; $('#import-summary').textContent=`${raw.length} rows found. ${good} valid; ${raw.length-good} have errors.`;
        $('#import-rows').innerHTML=importRows.map(r=>`<tr><td>${esc(r.employeeId)}</td><td>${esc(r.name)}</td><td>${esc(r.department)}</td><td>${esc(r.platformId)}</td><td>${esc(r.status)}</td><td>${esc(r.errors.join(', ')||'Valid')}</td></tr>`).join('');
        $('#confirm-import').disabled=good===0; $('#import-modal').classList.remove('hidden');
      } catch(e){message(`Could not read file: ${friendlyError(e)}`,true);} finally{ev.target.value='';}
    });
    $('#close-import-modal').addEventListener('click',closeImport); $('#cancel-import').addEventListener('click',closeImport);
    $('#confirm-import').addEventListener('click',async()=>{
      const btn=$('#confirm-import'); btn.disabled=true; btn.textContent='Importing…'; const res=await saveRows(importRows.filter(r=>!r.errors.length)); closeImport(); btn.textContent='Import valid rows'; btn.disabled=false;
      message(`${res.saved} imported; ${res.failures.length} failed.${res.failures.length?' '+res.failures.slice(0,3).join(' | '):''}`,res.failures.length>0);
    });
  }
  $('#employee-search').addEventListener('input',renderRows); $('#employee-department-filter').addEventListener('change',renderRows); $('#employee-status-filter').addEventListener('change',renderRows); $('#reload-employees').addEventListener('click',load);
  await load();
}
