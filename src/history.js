import { collection, getDocs, limit, query } from 'firebase/firestore';
import { db } from './firebase.js';
import './history.css';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const value = (obj, ...keys) => { for (const k of keys) if (obj?.[k] !== undefined && obj?.[k] !== null && obj[k] !== '') return obj[k]; return ''; };
function dateText(v) {
  if (!v) return '—';
  const d = typeof v?.toDate === 'function' ? v.toDate() : (v instanceof Date ? v : new Date(v));
  return Number.isNaN(d.getTime()) ? String(v) : new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', dateStyle: 'medium', timeStyle: 'short' }).format(d);
}
function dayText(v) {
  if (!v) return '';
  if (typeof v === 'string') return v.slice(0, 10);
  const d = typeof v?.toDate === 'function' ? v.toDate() : new Date(v);
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function normalize(doc, source) {
  const d = doc.data();
  return {
    id: doc.id, source,
    action: value(d, 'action', 'eventType', 'requestType', 'status') || (source === 'seatings' ? 'SEATING RECORD' : 'HISTORY EVENT'),
    employeeId: value(d, 'employeeId', 'employeeID'),
    employeeName: value(d, 'employeeName', 'name'),
    platform: value(d, 'platformName', 'platformId', 'toPlatformName', 'toPlatformId'),
    oldPlatform: value(d, 'fromPlatformName', 'fromPlatformId', 'oldPlatform'),
    laptop: value(d, 'laptopName', 'toLaptopName', 'laptop'),
    account: value(d, 'handledAccounts', 'handledAccount', 'withdrawalWorks', 'withdrawalWork'),
    businessDate: value(d, 'businessDate', 'date'),
    shift: value(d, 'shift'),
    status: value(d, 'status'),
    reason: value(d, 'reason', 'reviewReason', 'notes'),
    performedBy: value(d, 'performedByName', 'reviewedByName', 'createdByName', 'performedBy', 'reviewedBy', 'createdBy'),
    role: value(d, 'performedByRole', 'role', 'createdByRole'),
    timestamp: value(d, 'timestamp', 'createdAt', 'updatedAt', 'reviewedAt', 'approvedAt'),
    raw: d
  };
}
function stringify(v) { return Array.isArray(v) ? v.join(', ') : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? ''); }
function statusClass(s) { const x = String(s || '').toUpperCase(); return ['APPROVED','LOCKED','TRANSFERRED','ACTIVE'].includes(x) ? 'history-status history-good' : ['REJECTED','CANCELLED','INACTIVE'].includes(x) ? 'history-status history-bad' : 'history-status history-pending'; }

export async function renderHistoryPage(root, user, profile) {
  root.innerHTML = `
    <div class="page-heading"><div><div class="eyebrow">OPERATIONS / AUDIT TRAIL</div><h1>History</h1><p>Review seating activity, platform movements, approvals and rejected requests.</p></div><button class="button button-secondary" id="history-refresh">↻ Refresh</button></div>
    <div id="history-alert" class="alert hidden" role="status"></div>
    <section class="history-stats">
      <article class="stat-card"><div class="stat-top"><span>Events shown</span><span class="stat-icon">≡</span></div><div class="stat-value" id="history-count">—</div><div class="stat-hint">Matches current filters</div></article>
      <article class="stat-card"><div class="stat-top"><span>Platform changes</span><span class="stat-icon">↔</span></div><div class="stat-value" id="history-moves">—</div><div class="stat-hint">Movement and transfer events</div></article>
      <article class="stat-card"><div class="stat-top"><span>Approvals</span><span class="stat-icon">✓</span></div><div class="stat-value" id="history-approved">—</div><div class="stat-hint">Approved or locked records</div></article>
      <article class="stat-card"><div class="stat-top"><span>Rejected / returned</span><span class="stat-icon">!</span></div><div class="stat-value" id="history-rejected">—</div><div class="stat-hint">Declined or sent back</div></article>
    </section>
    <section class="panel history-panel">
      <div class="history-filters">
        <label>Search<input id="history-search" class="input" placeholder="Employee ID, name, platform, laptop, 4NS…"></label>
        <label>Business date<input id="history-date" class="input" type="date"></label>
        <label>Shift<select id="history-shift" class="input"><option value="">All shifts</option><option value="MORNING">Morning</option><option value="NIGHT">Night</option></select></label>
        <label>Action<select id="history-action" class="input"><option value="">All actions</option><option value="TRANSFER">Platform movement</option><option value="APPROV">Approvals</option><option value="REJECT">Rejected</option><option value="RETURN">Returned</option><option value="SEATING">Seating changes</option></select></label>
        <button class="button button-secondary" id="history-clear">Clear filters</button>
      </div>
      <div class="history-table-wrap"><table class="data-table history-table"><thead><tr><th>Date / Time</th><th>Action</th><th>Employee</th><th>Platform movement</th><th>Seat details</th><th>Status</th><th>Performed by</th><th>Reason / response</th></tr></thead><tbody id="history-rows"><tr><td colspan="8">Loading history…</td></tr></tbody></table></div>
      <div class="panel-footer"><span id="history-footer">Loading records…</span><span>History records are read-only.</span></div>
    </section>`;

  const alertEl = root.querySelector('#history-alert');
  const rowsEl = root.querySelector('#history-rows');
  let all = [];
  const showAlert = (msg, bad = false) => { alertEl.textContent = msg; alertEl.classList.remove('hidden'); alertEl.classList.toggle('alert-danger', bad); };
  const clearAlert = () => { alertEl.textContent = ''; alertEl.classList.add('hidden'); alertEl.classList.remove('alert-danger'); };

  function renderRows() {
    const search = root.querySelector('#history-search').value.trim().toLowerCase();
    const date = root.querySelector('#history-date').value;
    const shift = root.querySelector('#history-shift').value;
    const action = root.querySelector('#history-action').value;
    const filtered = all.filter((r) => {
      const hay = [r.action, r.employeeId, r.employeeName, r.platform, r.oldPlatform, r.laptop, stringify(r.account), r.status, r.performedBy, r.reason, r.businessDate, r.shift].join(' ').toLowerCase();
      const actionText = `${r.action} ${r.status}`.toUpperCase();
      return (!search || hay.includes(search)) && (!date || dayText(r.businessDate) === date || dayText(r.timestamp) === date) && (!shift || String(r.shift).toUpperCase() === shift) && (!action || actionText.includes(action));
    }).sort((a, b) => {
      const time = (v) => { const x = v?.toDate ? v.toDate().getTime() : new Date(v || 0).getTime(); return Number.isFinite(x) ? x : 0; };
      return time(b.timestamp) - time(a.timestamp);
    });
    root.querySelector('#history-count').textContent = filtered.length;
    root.querySelector('#history-moves').textContent = filtered.filter((r) => /TRANSFER|CHANGE_PLATFORM|MOVEMENT/i.test(r.action)).length;
    root.querySelector('#history-approved').textContent = filtered.filter((r) => /APPROV|LOCKED/i.test(`${r.action} ${r.status}`)).length;
    root.querySelector('#history-rejected').textContent = filtered.filter((r) => /REJECT|RETURN/i.test(`${r.action} ${r.status}`)).length;
    root.querySelector('#history-footer').textContent = `${filtered.length} record(s) shown from ${all.length} loaded`;
    if (!filtered.length) { rowsEl.innerHTML = '<tr><td colspan="8" class="empty-state">No history records match these filters.</td></tr>'; return; }
    rowsEl.innerHTML = filtered.map((r) => {
      const move = r.oldPlatform && r.platform ? `${r.oldPlatform} → ${r.platform}` : (r.platform || '—');
      const details = [r.laptop && `Laptop: ${stringify(r.laptop)}`, r.account && `Work: ${stringify(r.account)}`, r.businessDate && `Date: ${r.businessDate}`, r.shift].filter(Boolean).join(' · ');
      return `<tr><td><strong>${esc(dateText(r.timestamp))}</strong><small>${esc(r.businessDate || '')}</small></td><td><strong>${esc(String(r.action).replaceAll('_',' '))}</strong><small>${esc(r.source)}</small></td><td><strong>${esc(r.employeeName || 'Unknown employee')}</strong><small>${esc(r.employeeId || '—')}</small></td><td>${esc(move)}</td><td>${esc(details || '—')}</td><td><span class="${statusClass(r.status)}">${esc(r.status || 'RECORDED')}</span></td><td>${esc(r.performedBy || '—')}<small>${esc(r.role || '')}</small></td><td class="history-reason">${esc(r.reason || '—')}</td></tr>`;
    }).join('');
  }

  async function load() {
    clearAlert();
    rowsEl.innerHTML = '<tr><td colspan="8">Loading history…</td></tr>';
    root.querySelector('#history-refresh').disabled = true;
    try {
      const sources = await Promise.allSettled([
        getDocs(query(collection(db, 'seatingHistory'), limit(500))),
        getDocs(query(collection(db, 'auditLogs'), limit(500))),
        getDocs(query(collection(db, 'seatingChangeRequests'), limit(500))),
        getDocs(query(collection(db, 'seatings'), limit(500)))
      ]);
      const names = ['seatingHistory', 'auditLogs', 'seatingChangeRequests', 'seatings'];
      const docs = [];
      const errors = [];
      sources.forEach((result, i) => {
        if (result.status === 'fulfilled') result.value.docs.forEach((d) => docs.push(normalize(d, names[i])));
        else errors.push(`${names[i]}: ${result.reason?.code || result.reason?.message || 'read failed'}`);
      });
      const seen = new Set();
      all = docs.filter((r) => {
        const key = `${r.source}:${r.id}`;
        if (seen.has(key)) return false;
        seen.add(key); return true;
      });
      if (errors.length && !all.length) showAlert(`Could not load history. Check Firestore Rules permissions for seatingHistory, auditLogs, seatingChangeRequests and seatings. ${errors.join(' · ')}`, true);
      else if (errors.length) showAlert(`Some history sources could not be read; showing available records. ${errors.join(' · ')}`);
      renderRows();
    } catch (err) {
      rowsEl.innerHTML = '<tr><td colspan="8" class="empty-state">History could not be loaded.</td></tr>';
      showAlert(`History could not be loaded: ${err?.message || 'Unknown error'}`, true);
    } finally { root.querySelector('#history-refresh').disabled = false; }
  }

  ['history-search', 'history-date', 'history-shift', 'history-action'].forEach((id) => root.querySelector(`#${id}`).addEventListener('input', renderRows));
  root.querySelector('#history-clear').addEventListener('click', () => {
    root.querySelector('#history-search').value = '';
    root.querySelector('#history-date').value = '';
    root.querySelector('#history-shift').value = '';
    root.querySelector('#history-action').value = '';
    renderRows();
  });
  root.querySelector('#history-refresh').addEventListener('click', load);
  await load();
}
