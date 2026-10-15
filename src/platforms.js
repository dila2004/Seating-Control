import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  setDoc,
  updateDoc,
  serverTimestamp
} from 'firebase/firestore';
import { db } from './firebase.js';
import { friendlyError } from './auth.js';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[c]);

const normalizePlatformId = (value) => String(value ?? '').trim().toLowerCase();
const validPlatformId = (value) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length >= 2 && value.length <= 40;

export async function renderPlatformsPage(container, profile) {
  const canManage = profile?.role === 'ADMIN' && profile?.status === 'ACTIVE';
  let editingId = null;
  let seatings = [];

  container.innerHTML = `
    <section class="module-page">
      <div class="module-heading">
        <div><div class="eyebrow">WORKSPACE / CONFIGURATION</div><h1>Platforms</h1><p>Manage your company's platforms using flexible IDs.</p></div>
        ${canManage ? '<div class="module-heading-actions"><button class="button button-outline" id="bulk-add-platforms">＋ Add many</button><button class="button button-primary" id="add-platform">＋ Add platform</button></div>' : ''}
      </div>
      <div class="module-toolbar">
        <label class="search-box"><span aria-hidden="true">⌕</span><input id="platform-search" type="search" placeholder="Search platform name or ID…" aria-label="Search platforms"></label>
        <select id="platform-status-filter" class="filter-select" aria-label="Filter by status"><option value="ALL">All statuses</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select>
        <button class="button button-outline" id="reload-platforms">↻ Refresh</button>
      </div>
      <div class="module-summary" id="platform-summary">
        <div class="module-summary-item"><span>Total platforms</span><strong>—</strong></div><div class="module-summary-item"><span>Active</span><strong>—</strong></div><div class="module-summary-item"><span>Inactive</span><strong>—</strong></div>
      </div>
      <div class="panel module-table-panel">
        <div class="panel-heading"><div><h3>Platform directory</h3><p>Platform IDs such as jax-1, kane-1, and iris-7 are supported.</p></div><span class="panel-chip" id="platform-result-count">Loading…</span></div>
        <div id="platform-message" class="module-message hidden" role="status"></div>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Category</th><th>Platform</th><th>Platform ID</th><th>Laptop allocation (GS / DP / WD)</th><th>Seating balance</th><th>Status</th><th>Actions</th></tr></thead><tbody id="platform-rows"><tr><td colspan="7" class="table-empty">Loading platforms…</td></tr></tbody></table></div>
      </div>
      <div class="phase-note"><div class="phase-icon">i</div><div><strong>Flexible platform IDs</strong><p>IDs may contain lowercase letters, numbers and hyphens. Platform changes are restricted by Firestore Security Rules.</p></div></div>
    </section>
    <div class="modal-backdrop hidden" id="platform-modal" role="dialog" aria-modal="true" aria-labelledby="platform-modal-title">
      <div class="modal-card"><div class="modal-heading"><div><div class="eyebrow">PLATFORM CONFIGURATION</div><h2 id="platform-modal-title">Add platform</h2></div><button class="icon-button" id="close-platform-modal" aria-label="Close">×</button></div>
        <div class="module-message warning-message">Use a unique ID, for example <strong>jax-1</strong>. IDs are saved in lowercase.</div>
        <form id="platform-form">
        <label for="platform-category">Main category</label><input id="platform-category" name="category" placeholder="e.g. JAX, KANE, IRIS" required maxlength="40">
        <label for="platform-name">Platform name</label><input id="platform-name" name="name" placeholder="e.g. Jax 1" required maxlength="80">
        <label for="platform-id">Sub-category / Platform ID</label><input id="platform-id" name="platformId" placeholder="e.g. jax-1" required minlength="2" maxlength="40" pattern="[A-Za-z0-9]+(-[A-Za-z0-9]+)*" title="Use letters/numbers separated by hyphens, e.g. jax-1">
        <p class="muted-inline">Laptop allocation (these are expected seats, not a permanent limit)</p>
        <div class="platform-capacity-grid">
          <label for="platform-gs">GS laptops<input id="platform-gs" type="number" min="0" max="500" value="0" required></label>
          <label for="platform-dp">DP laptops<input id="platform-dp" type="number" min="0" max="500" value="0" required></label>
          <label for="platform-wd">WD laptops<input id="platform-wd" type="number" min="0" max="500" value="0" required></label>
        </div>
        <label for="platform-description">Description <span class="muted-inline">(optional)</span></label><textarea id="platform-description" name="description" rows="3" maxlength="300" placeholder="Short description"></textarea>
        <div class="modal-actions"><button type="button" class="button button-outline" id="cancel-platform-modal">Cancel</button><button type="submit" class="button button-primary" id="save-platform">Save platform</button></div></form>
      </div>
    </div>
    <div class="modal-backdrop hidden" id="bulk-platform-modal" role="dialog" aria-modal="true" aria-labelledby="bulk-platform-title">
      <div class="modal-card"><div class="modal-heading"><div><div class="eyebrow">BULK SETUP</div><h2 id="bulk-platform-title">Add multiple platforms</h2></div><button class="icon-button" id="close-bulk-platform-modal" aria-label="Close">×</button></div>
        <p class="muted-inline">Add 25+ platforms at once. Enter one platform per line in this format: <strong>Platform name | platform-id</strong></p>
        <div class="module-message">Example:<br>Jax 1 | jax-1<br>Jax 2 | jax-2<br>Kane 1 | kane-1</div>
        <form id="bulk-platform-form"><label for="bulk-platform-input">Platform list</label><textarea id="bulk-platform-input" rows="10" required placeholder="Jax 1 | jax-1&#10;Jax 2 | jax-2&#10;Kane 1 | kane-1"></textarea>
        <div class="modal-actions"><button type="button" class="button button-outline" id="cancel-bulk-platform-modal">Cancel</button><button type="submit" class="button button-primary" id="save-bulk-platforms">Add platforms</button></div></form>
      </div>
    </div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    .platform-capacity-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:12px 0 16px}
    .platform-capacity-grid label{display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:600}
    .platform-capacity-grid input{width:100%;box-sizing:border-box}
    .balance-pill{display:inline-block;border-radius:999px;padding:5px 9px;font-size:11px;font-weight:700;white-space:nowrap}
    .balance-low{background:#fee2e2;color:#991b1b}.balance-ok{background:#dcfce7;color:#166534}.balance-high{background:#dbeafe;color:#1d4ed8}.balance-na{background:#e5e7eb;color:#374151}
    @media(max-width:700px){.platform-capacity-grid{grid-template-columns:1fr}}
  `;
  container.appendChild(style);
  const $ = (selector) => container.querySelector(selector);
  const rowsEl = $('#platform-rows');
  const messageEl = $('#platform-message');
  const modal = $('#platform-modal');
  const bulkModal = $('#bulk-platform-modal');
  let platforms = [];

  const showMessage = (message, isError = false) => {
    messageEl.textContent = message;
    messageEl.classList.remove('hidden', 'warning-message');
    if (isError) messageEl.classList.add('warning-message');
  };
  const openModal = () => modal.classList.remove('hidden');
  const closeModal = () => {
    modal.classList.add('hidden');
    editingId = null;
    $('#platform-form').reset();
    $('#platform-id').disabled = false;
    $('#platform-gs').value = 0; $('#platform-dp').value = 0; $('#platform-wd').value = 0;
    $('#platform-modal-title').textContent = 'Add platform';
    $('#save-platform').textContent = 'Save platform';
  };

  $('#add-platform')?.addEventListener('click', openModal);
  const closeBulkModal = () => bulkModal.classList.add('hidden');
  $('#bulk-add-platforms')?.addEventListener('click', () => bulkModal.classList.remove('hidden'));
  $('#close-bulk-platform-modal').addEventListener('click', closeBulkModal);
  $('#cancel-bulk-platform-modal').addEventListener('click', closeBulkModal);
  bulkModal.addEventListener('click', (event) => { if (event.target === bulkModal) closeBulkModal(); });
  $('#close-platform-modal').addEventListener('click', closeModal);
  $('#cancel-platform-modal').addEventListener('click', closeModal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeModal();
  });

  const renderRows = () => {
    const term = $('#platform-search').value.trim().toLowerCase();
    const filter = $('#platform-status-filter').value;
    const filtered = platforms.filter((platform) => {
      const status = String(platform.status || 'ACTIVE').toUpperCase();
      const searchable = `${platform.name || ''} ${platform.platformId || platform.id || ''} ${platform.description || ''}`.toLowerCase();
      return searchable.includes(term) && (filter === 'ALL' || filter === status);
    });

    $('#platform-result-count').textContent = `${filtered.length} shown`;
    rowsEl.innerHTML = filtered.length ? filtered.map((platform) => {
      const status = String(platform.status || 'ACTIVE').toUpperCase();
      const active = status === 'ACTIVE';
      const category = String(platform.category || (platform.platformId || platform.id).split('-')[0] || '').toUpperCase();
      const capacity = platform.laptopCapacity || {};
      const expected = { GS: Number(capacity.GS || 0), DP: Number(capacity.DP || 0), WD: Number(capacity.WD || 0) };
      const current = { GS: 0, DP: 0, WD: 0 };
      seatings.filter(s => String(s.platformId || '').toLowerCase() === String(platform.platformId || platform.id).toLowerCase()
        && ['PENDING','APPROVED','ACTIVE','LOCKED'].includes(String(s.status || '').toUpperCase()))
        .forEach(s => { const d = String(s.department || s.employeeDepartment || s.employeeType || '').toUpperCase(); if (d in current) current[d] += 1; });
      const expectedTotal = expected.GS + expected.DP + expected.WD;
      const currentTotal = current.GS + current.DP + current.WD;
      const balanceClass = expectedTotal === 0 ? 'balance-na' : currentTotal < expectedTotal ? 'balance-low' : currentTotal > expectedTotal ? 'balance-high' : 'balance-ok';
      const balanceText = expectedTotal === 0 ? `${currentTotal} seated · capacity not set` : currentTotal < expectedTotal ? `${expectedTotal-currentTotal} seats available` : currentTotal > expectedTotal ? `${currentTotal-expectedTotal} over allocation` : 'Allocation full';
      return `<tr>
        <td><strong>${escapeHtml(category)}</strong></td>
        <td><div class="table-primary-text">${escapeHtml(platform.name || platform.platformId || platform.id)}</div><div class="table-secondary-text">${escapeHtml(platform.description || 'No description')}</div></td>
        <td><code class="id-chip">${escapeHtml(platform.platformId || platform.id)}</code></td>
        <td>GS ${expected.GS} · DP ${expected.DP} · WD ${expected.WD}<div class="table-secondary-text">Seated: GS ${current.GS}, DP ${current.DP}, WD ${current.WD}</div></td>
        <td><span class="balance-pill ${balanceClass}">${escapeHtml(balanceText)}</span></td>
        <td><span class="status-pill ${active ? 'complete' : 'empty'}">${escapeHtml(status)}</span></td>
        <td><button class="button button-outline button-small edit-platform" data-id="${escapeHtml(platform.id)}" ${canManage ? '' : 'disabled'}>Edit</button> <button class="button button-outline button-small toggle-platform" data-id="${escapeHtml(platform.id)}" data-active="${active ? 'true' : 'false'}" ${canManage ? '' : 'disabled'}>${active ? 'Deactivate' : 'Activate'}</button></td>
      </tr>`;
    }).join('') : `<tr><td colspan="7" class="table-empty">${term || filter !== 'ALL' ? 'No platforms match these filters.' : 'No platforms yet. Use Add platform to create your first platform.'}</td></tr>`;

    rowsEl.querySelectorAll('.edit-platform').forEach((button) => {
      button.addEventListener('click', () => {
        if (!canManage) return;
        const p = platforms.find(item => item.id === button.dataset.id);
        if (!p) return;
        editingId = p.id;
        $('#platform-modal-title').textContent = 'Update platform';
        $('#save-platform').textContent = 'Update platform';
        $('#platform-category').value = String(p.category || (p.platformId || p.id).split('-')[0] || '').toUpperCase();
        $('#platform-name').value = p.name || '';
        $('#platform-id').value = p.platformId || p.id;
        $('#platform-id').disabled = true;
        $('#platform-description').value = p.description || '';
        $('#platform-gs').value = Number(p.laptopCapacity?.GS || 0);
        $('#platform-dp').value = Number(p.laptopCapacity?.DP || 0);
        $('#platform-wd').value = Number(p.laptopCapacity?.WD || 0);
        openModal();
      });
    });

    rowsEl.querySelectorAll('.toggle-platform').forEach((button) => {
      button.addEventListener('click', async () => {
        if (!canManage) return;
        const platformId = button.dataset.id;
        const nextStatus = button.dataset.active === 'true' ? 'INACTIVE' : 'ACTIVE';
        button.disabled = true;
        try {
          await updateDoc(doc(db, 'platforms', platformId), {
            status: nextStatus,
            updatedAt: serverTimestamp()
          });
          showMessage(`Platform ${platformId} changed to ${nextStatus}.`);
          await load();
        } catch (error) {
          showMessage(friendlyError(error), true);
          button.disabled = false;
        }
      });
    });

    const activeCount = platforms.filter((platform) => String(platform.status || 'ACTIVE').toUpperCase() === 'ACTIVE').length;
    $('#platform-summary').innerHTML = `<div class="module-summary-item"><span>Total platforms</span><strong>${platforms.length}</strong></div><div class="module-summary-item"><span>Active</span><strong>${activeCount}</strong></div><div class="module-summary-item"><span>Inactive</span><strong>${platforms.length - activeCount}</strong></div>`;
  };

  const load = async () => {
    const button = $('#reload-platforms');
    button.disabled = true;
    button.textContent = 'Loading…';
    rowsEl.innerHTML = '<tr><td colspan="7" class="table-empty">Loading platforms…</td></tr>';
    try {
      const snapshot = await getDocs(query(collection(db, 'platforms'), limit(500)));
      try {
        const seatingSnapshot = await getDocs(query(collection(db, 'seatings'), limit(1000)));
        seatings = seatingSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      } catch { seatings = []; }
      platforms = snapshot.docs
        .map((platformDoc) => ({ id: platformDoc.id, ...platformDoc.data() }))
        .sort((a, b) => a.id.localeCompare(b.id));
      renderRows();
    } catch (error) {
      rowsEl.innerHTML = `<tr><td colspan="5" class="table-empty">Could not load platforms: ${escapeHtml(friendlyError(error))}</td></tr>`;
      $('#platform-result-count').textContent = 'Unavailable';
    } finally {
      button.disabled = false;
      button.textContent = '↻ Refresh';
    }
  };

  $('#platform-search').addEventListener('input', renderRows);
  $('#platform-status-filter').addEventListener('change', renderRows);
  $('#reload-platforms').addEventListener('click', load);

  $('#bulk-platform-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!canManage) { showMessage('Only an active Admin can manage platforms.', true); return; }
    const saveButton = $('#save-bulk-platforms');
    const lines = $('#bulk-platform-input').value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const entries = [];
    const seen = new Set(platforms.map(p => normalizePlatformId(p.platformId || p.id)));
    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i].split('|').map(part => part.trim());
      if (parts.length < 2) { showMessage(`Line ${i + 1}: use Platform name | platform-id.`, true); return; }
      const name = parts[0];
      const platformId = normalizePlatformId(parts[1]);
      if (!name || !validPlatformId(platformId)) { showMessage(`Line ${i + 1}: invalid name or ID. Use letters/numbers and hyphens, e.g. jax-1.`, true); return; }
      if (seen.has(platformId)) { showMessage(`Duplicate or existing platform ID: ${platformId}. No platforms were added.`, true); return; }
      seen.add(platformId); entries.push({ name, platformId });
    }
    if (!entries.length) { showMessage('Enter at least one platform.', true); return; }
    saveButton.disabled = true; saveButton.textContent = `Adding ${entries.length}…`;
    try {
      for (const entry of entries) {
        await setDoc(doc(db, 'platforms', entry.platformId), {
          ...entry, description: '', status: 'ACTIVE', createdAt: serverTimestamp(), updatedAt: serverTimestamp()
        });
      }
      closeBulkModal(); $('#bulk-platform-form').reset();
      showMessage(`${entries.length} platform(s) added successfully.`);
      await load();
    } catch (error) {
      showMessage(`Some platforms may already have been added before this error: ${friendlyError(error)}`, true);
      await load();
    } finally { saveButton.disabled = false; saveButton.textContent = 'Add platforms'; }
  });

  $('#platform-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!canManage) {
      showMessage('Only an active Admin can manage platforms.', true);
      return;
    }

    const saveButton = $('#save-platform');
    const platformId = normalizePlatformId($('#platform-id').value);
    const category = $('#platform-category').value.trim().toUpperCase();
    const name = $('#platform-name').value.trim();
    const description = $('#platform-description').value.trim();
    const laptopCapacity = {
      GS: Number($('#platform-gs').value || 0),
      DP: Number($('#platform-dp').value || 0),
      WD: Number($('#platform-wd').value || 0)
    };

    if (!validPlatformId(platformId)) {
      showMessage('Use 2–40 lowercase letters/numbers with single hyphens between parts, e.g. jax-1.', true);
      return;
    }
    if (!name) {
      showMessage('Enter a platform name.', true);
      return;
    }

    saveButton.disabled = true;
    saveButton.textContent = 'Saving…';
    try {
      if (!category) { showMessage('Enter the main category, e.g. JAX or KANE.', true); return; }
      if (Object.values(laptopCapacity).some(n => !Number.isInteger(n) || n < 0 || n > 500)) {
        showMessage('Laptop counts must be whole numbers between 0 and 500.', true); return;
      }
      // Updates only the platform configuration fields; existing platform status and records are preserved.
      const wasEditing = Boolean(editingId);
      const payload = { category, name, description, laptopCapacity, updatedAt: serverTimestamp() };
      if (editingId) {
        await updateDoc(doc(db, 'platforms', editingId), payload);
      } else {
        if (platforms.some(p => normalizePlatformId(p.platformId || p.id) === platformId)) {
          showMessage(`Platform ID already exists: ${platformId}.`, true); return;
        }
        await setDoc(doc(db, 'platforms', platformId), {
          platformId, ...payload, status: 'ACTIVE', createdAt: serverTimestamp()
        });
      }
      closeModal();
      $('#platform-form').reset();
      $('#platform-id').disabled = false;
      editingId = null;
      $('#platform-modal-title').textContent = 'Add platform';
      $('#save-platform').textContent = 'Save platform';
      showMessage(`Platform ${platformId} ${wasEditing ? 'updated' : 'saved'} successfully.`);
      await load();
    } catch (error) {
      showMessage(friendlyError(error), true);
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = 'Save platform';
    }
  });

  await load();
}
