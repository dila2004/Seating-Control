import {
  collection, doc, getDoc, getDocs, limit, query,
  serverTimestamp, setDoc, updateDoc, where
} from 'firebase/firestore';
import { db } from './firebase.js';
import { friendlyError } from './auth.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));
const clean = (v) => String(v ?? '').trim();
const todayLocal = () => {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};
const statusPill = (status) => `<span class="status-pill ${status === 'ACTIVE' ? 'complete' : 'empty'}">${esc(status)}</span>`;

export async function renderPicsPage(container, profile) {
  const admin = profile?.role === 'ADMIN' && profile?.status === 'ACTIVE';

  container.innerHTML = `
    <section class="module-page">
      <div class="module-heading">
        <div><div class="eyebrow">WORKSPACE / MONITORING</div>
          <h1>PIC Management</h1>
          <p>PIC IDs use employee IDs. PIC profiles and daily platform assignments are managed separately.</p>
        </div>
        ${admin ? '<button class="button button-primary" id="add-pic">＋ Add PIC</button>' : ''}
      </div>
      <div id="pic-message" class="module-message hidden" role="status"></div>
      <div class="panel module-table-panel">
        <div class="panel-heading"><div><h3>PIC directory</h3><p>Employee ID is reused as the PIC ID.</p></div>
          <button class="button button-outline" id="refresh-pics">↻ Refresh</button></div>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Employee ID / PIC ID</th><th>Name</th><th>Status</th><th>Action</th></tr></thead>
          <tbody id="pic-rows"><tr><td colspan="4" class="table-empty">Loading…</td></tr></tbody></table></div>
      </div>
      <div class="panel module-table-panel" style="margin-top:20px">
        <div class="panel-heading"><div><h3>Daily platform assignments</h3>
          <p>Assign a PIC per platform, date and shift. Day: 08:30–20:30 · Night: 20:30–08:30. Assignments do not carry over between shifts.</p></div>
          ${admin ? '<button class="button button-primary" id="add-assignment">＋ Assign PIC for day</button>' : ''}
        </div>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Shift</th><th>Platform</th><th>PIC</th><th>Status</th>${admin ? '<th>Actions</th>' : ''}</tr></thead>
          <tbody id="assignment-rows"><tr><td colspan="${admin ? 6 : 5}" class="table-empty">Loading…</td></tr></tbody></table></div>
      </div>
    </section>

    <div class="modal-backdrop hidden" id="pic-modal" role="dialog" aria-modal="true">
      <div class="modal-card" style="width:min(620px,calc(100vw - 32px));max-height:90vh;overflow:auto"><div class="modal-heading"><div><div class="eyebrow">PIC MANAGEMENT</div><h2>Add PIC from employee</h2></div>
        <button class="icon-button" id="close-pic" type="button">×</button></div>
        <form id="pic-form">
          <label for="pic-employee-search">Search employee by name or ID</label><input id="pic-employee-search" type="search" autocomplete="off" placeholder="Type a name or employee ID…"><div id="pic-employee-results" class="pic-search-results" role="listbox" style="border:1px solid #d8e1ef;border-radius:10px;max-height:220px;overflow:auto;margin-top:6px"><div class="table-empty" style="padding:12px">Start typing to find an active employee.</div></div><input id="pic-employee" name="employeeId" type="hidden" required><p id="selected-pic-employee" class="muted-inline">No employee selected.</p>
          <p class="muted-inline">Select the employee by name. Their existing employee ID becomes the PIC ID.</p>
          <div class="modal-actions"><button type="button" class="button button-outline" id="cancel-pic">Cancel</button><button type="submit" class="button button-primary" id="save-pic">Promote to PIC</button></div>
        </form>
      </div>
    </div>

    <div class="modal-backdrop hidden" id="assignment-modal" role="dialog" aria-modal="true">
      <div class="modal-card pic-assignment-modal" style="width:min(720px,calc(100vw - 32px));max-height:90vh;overflow:auto;padding:28px"><div class="modal-heading"><div><div class="eyebrow">DAILY ASSIGNMENT</div><h2 id="assignment-modal-title">Assign PIC to platform</h2></div>
        <button class="icon-button" id="close-assignment" type="button">×</button></div>
        <form id="assignment-form" class="pic-assignment-form">
          <div class="pic-form-grid"><div class="pic-field"><label for="assignment-date">Business date</label><input id="assignment-date" name="date" type="date" required value="${todayLocal()}"></div>
          <div class="pic-field"><label for="assignment-shift">Shift</label><select id="assignment-shift" name="shift" required><option value="MORNING">Day · 08:30–20:30</option><option value="NIGHT">Night · 20:30–08:30</option></select></div>
          <div class="pic-field pic-field-full"><label for="assignment-platform">Platform</label><select id="assignment-platform" name="platformId" required><option value="">Loading platforms…</option></select><small id="platform-help">Platforms are loaded from Firestore.</small></div>
          <div class="pic-field pic-field-full"><label for="assignment-pic">PIC</label><select id="assignment-pic" name="picId" required><option value="">Loading PICs…</option></select></div></div>
          <div class="modal-actions"><button type="button" class="button button-outline" id="cancel-assignment">Cancel</button><button type="submit" class="button button-primary" id="save-assignment">Save assignment</button></div>
        </form>
      </div>
    </div>`;

  const style = document.createElement('style');
  style.textContent = `
    .pic-assignment-modal .pic-assignment-form { display:flex; flex-direction:column; gap:16px; }
    .pic-assignment-modal .pic-form-grid { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:16px; }
    .pic-assignment-modal .pic-field { display:flex; flex-direction:column; gap:7px; min-width:0; }
    .pic-assignment-modal .pic-field-full { grid-column:1 / -1; }
    .pic-assignment-modal .pic-field label { font-size:13px; font-weight:600; color:#334155; }
    .pic-assignment-modal input, .pic-assignment-modal select { width:100%; box-sizing:border-box; min-height:44px; border:1px solid #d6e0ee; border-radius:9px; padding:10px 12px; background:#fff; color:#1f2937; font:inherit; }
    .pic-assignment-modal small { color:#64748b; font-size:12px; }\n    .button-small { padding:7px 10px; font-size:12px; }
    .pic-assignment-modal .modal-actions { display:flex; justify-content:flex-end; gap:10px; margin-top:6px; }
    @media(max-width:560px) { .pic-assignment-modal .pic-form-grid { grid-template-columns:1fr; } .pic-assignment-modal .pic-field-full { grid-column:auto; } }
  `;
  container.appendChild(style);

  const $ = (selector) => container.querySelector(selector);
  const msg = (text, bad = false) => {
    const node = $('#pic-message');
    node.textContent = text;
    node.classList.remove('hidden');
    node.classList.toggle('warning-message', bad);
  };
  const closePic = () => $('#pic-modal').classList.add('hidden');
  const closeAssignment = () => $('#assignment-modal').classList.add('hidden');

  let promotableEmployees = [];
  function renderEmployeeSearch() {
    const term = clean($('#pic-employee-search').value).toLowerCase();
    const filtered = promotableEmployees.filter((e) =>
      `${e.name || ''} ${e.employeeId || e.id} ${e.department || ''}`.toLowerCase().includes(term)
    ).slice(0, 40);
    const results = $('#pic-employee-results');
    if (!term) {
      results.innerHTML = '<div class="table-empty" style="padding:12px">Type a name or ID to search employees.</div>';
      return;
    }
    results.innerHTML = filtered.length ? filtered.map((e) =>
      `<button type="button" class="pic-search-result" data-employee-id="${esc(e.id)}" style="display:flex;width:100%;text-align:left;align-items:center;justify-content:space-between;gap:12px;padding:11px 12px;border:0;border-bottom:1px solid #edf1f7;background:white;cursor:pointer">
        <span><strong>${esc(e.name || 'Unnamed employee')}</strong><br><small>${esc(e.employeeId || e.id)} · ${esc(e.department)}</small></span><span>＋</span></button>`
    ).join('') : '<div class="table-empty" style="padding:12px">No matching active GS/DP/WD employee found.</div>';
    results.querySelectorAll('[data-employee-id]').forEach((button) => button.addEventListener('click', () => {
      const e = promotableEmployees.find((item) => item.id === button.dataset.employeeId);
      if (!e) return;
      $('#pic-employee').value = e.id;
      $('#pic-employee-search').value = `${e.name || e.id} — ${e.employeeId || e.id}`;
      $('#selected-pic-employee').textContent = `Selected: ${e.name || e.id} (${e.employeeId || e.id})`;
      results.innerHTML = `<div style="padding:12px">Selected <strong>${esc(e.name || e.id)}</strong> · ${esc(e.employeeId || e.id)}</div>`;
    }));
  }
  async function loadEmployeesForPromotion() {
    const snap = await getDocs(query(collection(db, 'employees'), limit(500)));
    promotableEmployees = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((e) => e.status === 'ACTIVE' && ['GS', 'DP', 'WD'].includes(e.department))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    $('#pic-employee-search').value = '';
    $('#pic-employee').value = '';
    $('#selected-pic-employee').textContent = 'No employee selected.';
    renderEmployeeSearch();
    return promotableEmployees;
  }

  async function loadPics() {
    try {
      const snap = await getDocs(query(collection(db, 'pics'), limit(500)));
      const pics = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      $('#pic-rows').innerHTML = pics.length
        ? pics.sort((a, b) => String(a.picId || a.id).localeCompare(String(b.picId || b.id)))
          .map((p) => `<tr><td><code class="id-chip">${esc(p.employeeId || p.picId || p.id)}</code></td><td>${esc(p.name)}</td><td>${statusPill(p.status)}</td><td>${admin && p.status === 'ACTIVE' ? `<button class="button button-outline button-small" data-remove-pic="${esc(p.employeeId || p.picId || p.id)}">Remove PIC role</button>` : '—'}</td></tr>`).join('')
        : '<tr><td colspan="4" class="table-empty">No PIC records yet.</td></tr>';
      $('#pic-rows').querySelectorAll('[data-remove-pic]').forEach((button) => button.addEventListener('click', async () => {
        const employeeId = button.dataset.removePic;
        if (!confirm(`Remove PIC role from employee ${employeeId}? The employee will be returned to the employee directory as department GS. You can change their department afterward.`)) return;
        try {
          const employeeRef = doc(db, 'employees', employeeId);
          const employeeSnap = await getDoc(employeeRef);
          if (!employeeSnap.exists()) throw new Error('Original employee record was not found.');
          await updateDoc(employeeRef, {
            department: 'GS',
            role: '',
            updatedAt: serverTimestamp()
          });
          await updateDoc(doc(db, 'pics', employeeId), {
            status: 'INACTIVE',
            updatedAt: serverTimestamp()
          });
          msg(`PIC role removed for ${employeeId}. Employee returned to the GS department.`);
          await loadPics();
          await loadEmployeesForPromotion();
          await populateAssignmentOptions();
        } catch (e) {
          msg(`Could not remove PIC role. Check Firestore Rules: ${friendlyError(e)}`, true);
        }
      }));
      return pics;
    } catch (e) {
      $('#pic-rows').innerHTML = `<tr><td colspan="4" class="table-empty">Could not load PICs: ${esc(friendlyError(e))}</td></tr>`;
      return [];
    }
  }

  async function loadAssignments() {
    try {
      const snap = await getDocs(query(collection(db, 'picAssignments'), limit(500)));
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => `${b.date || ''}${b.shift || ''}`.localeCompare(`${a.date || ''}${a.shift || ''}`));
      const colspan = admin ? 6 : 5;
      $('#assignment-rows').innerHTML = rows.length
        ? rows.map((a) => `<tr>
            <td>${esc(a.date)}</td>
            <td>${a.shift === 'MORNING' ? 'Day · 08:30–20:30' : a.shift === 'NIGHT' ? 'Night · 20:30–08:30' : esc(a.shift)}</td>
            <td>${esc(a.platformId)}</td>
            <td>${esc(a.picName || a.picId)}</td>
            <td>${statusPill(a.status)}</td>
            ${admin ? `<td><div style="display:flex;gap:6px;flex-wrap:wrap">
              <button type="button" class="button button-outline button-small" data-edit-assignment="${esc(a.id)}">Edit / Replace</button>
              ${a.status === 'ACTIVE' ? `<button type="button" class="button button-outline button-small" data-remove-assignment="${esc(a.id)}">Remove</button>` : ''}
            </div></td>` : ''}
          </tr>`).join('')
        : `<tr><td colspan="${colspan}" class="table-empty">No daily assignments yet.</td></tr>`;

      if (admin) {
        $('#assignment-rows').querySelectorAll('[data-edit-assignment]').forEach((button) => {
          button.addEventListener('click', async () => {
            const assignment = rows.find((a) => a.id === button.dataset.editAssignment);
            if (!assignment) return;
            try {
              await populateAssignmentOptions();
              $('#assignment-form').dataset.editId = assignment.id;
              $('#assignment-modal-title').textContent = 'Edit / Replace PIC';
              $('#assignment-date').value = assignment.date || todayLocal();
              $('#assignment-shift').value = assignment.shift || 'MORNING';
              $('#assignment-platform').value = assignment.platformId || '';
              $('#assignment-pic').value = assignment.picId || '';
              $('#save-assignment').textContent = 'Update assignment';
              $('#assignment-modal').classList.remove('hidden');
            } catch (e) {
              msg(`Could not open assignment: ${friendlyError(e)}`, true);
            }
          });
        });
        $('#assignment-rows').querySelectorAll('[data-remove-assignment]').forEach((button) => {
          button.addEventListener('click', async () => {
            const assignment = rows.find((a) => a.id === button.dataset.removeAssignment);
            if (!assignment) return;
            if (!confirm(`Remove PIC ${assignment.picName || assignment.picId} from ${assignment.platformId} on ${assignment.date} (${assignment.shift})? The record will be retained as inactive.`)) return;
            try {
              await updateDoc(doc(db, 'picAssignments', assignment.id), {
                status: 'INACTIVE',
                updatedAt: serverTimestamp()
              });
              msg('Assignment removed. History is retained as INACTIVE.');
              await loadAssignments();
            } catch (e) {
              msg(`Could not remove assignment: ${friendlyError(e)}`, true);
            }
          });
        });
      }
    } catch (e) {
      $('#assignment-rows').innerHTML = `<tr><td colspan="${admin ? 6 : 5}" class="table-empty">Could not load assignments: ${esc(friendlyError(e))}</td></tr>`;
    }
  }

  async function populateAssignmentOptions() {
    const platformSelect = $('#assignment-platform');
    const picSelect = $('#assignment-pic');
    platformSelect.innerHTML = '<option value="">Loading platforms…</option>';
    picSelect.innerHTML = '<option value="">Loading PICs…</option>';
    try {
      const [platformSnap, picSnap] = await Promise.all([
        getDocs(query(collection(db, 'platforms'), limit(500))),
        getDocs(query(collection(db, 'pics'), where('status', '==', 'ACTIVE'), limit(500)))
      ]);
      const platforms = platformSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .filter((p) => String(p.status || 'ACTIVE').toUpperCase() === 'ACTIVE')
        .sort((a, b) => String(a.platformId || a.id).localeCompare(String(b.platformId || b.id)));
      const pics = picSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .filter((p) => String(p.status || '').toUpperCase() === 'ACTIVE')
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

      platformSelect.innerHTML = platforms.length
        ? '<option value="">Select platform</option>' + platforms.map((p) => {
            const id = String(p.platformId || p.id);
            const label = p.name && p.name !== id ? `${p.name} (${id})` : id;
            return `<option value="${esc(id)}">${esc(label)}</option>`;
          }).join('')
        : '<option value="">No ACTIVE platforms found</option>';

      picSelect.innerHTML = pics.length
        ? '<option value="">Select PIC</option>' + pics.map((p) => {
            const id = String(p.employeeId || p.picId || p.id);
            return `<option value="${esc(id)}" data-name="${esc(p.name || '')}">${esc(`${p.name || id} (${id})`)}</option>`;
          }).join('')
        : '<option value="">No ACTIVE PIC profiles found</option>';

      const help = $('#platform-help');
      if (help) {
        help.textContent = platforms.length
          ? `${platforms.length} active platform(s) loaded from Firestore.`
          : 'No active platform documents found. Check Platforms page and status values.';
      }
      if (!platforms.length) msg('No active platforms found in Firestore. Add/activate platforms first.', true);
      if (!pics.length) msg('No active PIC profiles found. Add/promote a PIC first.', true);
      return { platforms, pics };
    } catch (e) {
      platformSelect.innerHTML = '<option value="">Could not load platforms</option>';
      picSelect.innerHTML = '<option value="">Could not load PICs</option>';
      const help = $('#platform-help');
      if (help) help.textContent = friendlyError(e);
      msg(`Could not load platform/PIC options: ${friendlyError(e)}`, true);
      throw e;
    }
  }

  if (admin) {
    $('#pic-employee-search').addEventListener('input', renderEmployeeSearch);
    $('#add-pic').addEventListener('click', async () => {
      try {
        await loadEmployeesForPromotion();
        $('#pic-modal').classList.remove('hidden');
      } catch (e) {
        msg(`Could not load employees: ${friendlyError(e)}`, true);
      }
    });
    $('#close-pic').addEventListener('click', closePic);
    $('#cancel-pic').addEventListener('click', closePic);
    $('#pic-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const form = ev.currentTarget;
      const employeeId = clean(new FormData(form).get('employeeId'));
      if (!employeeId) return msg('Select an active employee first.', true);
      const button = $('#save-pic');
      button.disabled = true;
      button.textContent = 'Promoting…';
      try {
        const employeeRef = doc(db, 'employees', employeeId);
        const employeeSnap = await getDoc(employeeRef);
        if (!employeeSnap.exists()) throw new Error('Employee record not found.');
        const employee = employeeSnap.data();
        if (employee.status !== 'ACTIVE' || !['GS', 'DP', 'WD'].includes(employee.department)) {
          throw new Error('Only active GS/DP/WD employees can be promoted to PIC.');
        }
        const picRef = doc(db, 'pics', employeeId);
        if ((await getDoc(picRef)).exists()) throw new Error('This employee already has a PIC record.');
        await setDoc(picRef, {
          employeeId,
          picId: employeeId,
          name: employee.name,
          status: 'ACTIVE',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        // Current Firestore rules permit create-only employee docs, not update.
        // Do not pretend the department changed: the rules must be extended before this succeeds.
        await updateDoc(employeeRef, {
          department: 'PIC',
          role: 'PIC',
          updatedAt: serverTimestamp()
        });
        form.reset();
        closePic();
        msg(`Employee ${employeeId} promoted to PIC.`);
        await loadPics();
        await loadEmployeesForPromotion();
        await populateAssignmentOptions();
      } catch (e) {
        msg(`PIC promotion was not fully completed. Check the employee update rules; ${friendlyError(e)}`, true);
      } finally {
        button.disabled = false;
        button.textContent = 'Promote to PIC';
      }
    });

    $('#add-assignment').addEventListener('click', async () => {
      try {
        await populateAssignmentOptions();
        $('#assignment-form').reset();
        delete $('#assignment-form').dataset.editId;
        $('#assignment-modal-title').textContent = 'Assign PIC to platform';
        $('#save-assignment').textContent = 'Save assignment';
        $('#assignment-date').value = todayLocal();
        const now = new Date();
        const minutes = now.getHours() * 60 + now.getMinutes();
        $('#assignment-shift').value = minutes >= 510 && minutes < 1230 ? 'MORNING' : 'NIGHT';
        $('#assignment-modal').classList.remove('hidden');
      } catch (e) {
        msg(`Could not load platforms or PICs: ${friendlyError(e)}`, true);
      }
    });
    $('#close-assignment').addEventListener('click', closeAssignment);
    $('#cancel-assignment').addEventListener('click', closeAssignment);
    $('#assignment-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const form = ev.currentTarget;
      const values = Object.fromEntries(new FormData(form).entries());
      const date = clean(values.date), shift = clean(values.shift);
      const platformId = clean(values.platformId), picId = clean(values.picId);
      const picName = $('#assignment-pic').selectedOptions[0]?.dataset.name || '';
      if (!date || !['MORNING', 'NIGHT'].includes(shift) || !platformId || !picId) {
        msg('Select a date, shift, platform and PIC.', true); return;
      }

      const isEdit = Boolean(form.dataset.editId);
      const assignmentId = form.dataset.editId ||
        `${date}_${shift}_${platformId}`.replace(/[^A-Za-z0-9_-]/g, '-');
      const ref = doc(db, 'picAssignments', assignmentId);
      const button = $('#save-assignment');
      button.disabled = true;
      button.textContent = isEdit ? 'Updating…' : 'Saving…';
      try {
        const existing = await getDoc(ref);
        const payload = {
          assignmentId, date, shift, platformId, picId, picName,
          status: 'ACTIVE',
          updatedAt: serverTimestamp()
        };
        if (isEdit) {
          if (!existing.exists()) throw new Error('Assignment record no longer exists. Refresh the list.');
          await updateDoc(ref, payload);
        } else if (existing.exists()) {
          if (existing.data().status === 'INACTIVE') {
            await updateDoc(ref, payload);
          } else {
            throw new Error('This platform already has an active PIC for that date and shift. Use Edit / Replace.');
          }
        } else {
          await setDoc(ref, { ...payload, createdAt: serverTimestamp() });
        }
        form.reset();
        delete form.dataset.editId;
        $('#assignment-date').value = todayLocal();
        $('#assignment-modal-title').textContent = 'Assign PIC to platform';
        closeAssignment();
        $('#save-assignment').textContent = 'Save assignment';
        msg(isEdit ? 'PIC assignment updated.' : 'PIC assignment saved.');
        await loadAssignments();
      } catch (e) {
        msg(`Could not save assignment: ${friendlyError(e)}`, true);
      } finally {
        button.disabled = false;
        button.textContent = 'Save assignment';
      }
    });
  }
  $('#refresh-pics').addEventListener('click', async () => {
    await loadPics(); await loadAssignments();
  });
  await loadPics();
  await loadAssignments();
}
