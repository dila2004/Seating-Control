import { collection, getDocs, limit, query } from 'firebase/firestore';
import { db } from './firebase.js';
import { friendlyError } from './auth.js';

const esc = (v = '') => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const todayColombo = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const norm = (v) => String(v ?? '').trim().toUpperCase();
const dateOf = (s) => String(s.businessDate || s.date || '').slice(0, 10);
const statusOf = (s) => norm(s.status || 'UNKNOWN');

export async function renderReportsPage(root, profile) {
  const role = norm(profile?.role);
  if (!['PIC', 'TL', 'SPV', 'ADMIN'].includes(role)) {
    root.innerHTML = '<section><h2>Access denied</h2><p>Reports are available to PIC, Team Leads, Supervisors, and Administrators.</p></section>';
    return;
  }

  root.innerHTML = `
  <section class="sc-reports">
    <style>
      .sc-reports{max-width:1440px;margin:0 auto;padding:8px 0 28px;color:var(--text,#172b46);font:inherit}
      .sc-reports *{box-sizing:border-box}.sc-reports .rp-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:20px}
      .sc-reports h2{margin:0 0 6px;font-size:26px;font-weight:750;color:var(--text,#172b46)}.sc-reports p{margin:0;color:var(--muted,#64748b);font-size:13px;line-height:1.55}
      .sc-reports .rp-actions{display:flex;gap:8px;flex-wrap:wrap}.sc-reports button{border:1px solid var(--border,#d6e0ed);background:var(--surface,#fff);color:var(--text,#172b46);border-radius:8px;padding:10px 13px;font-weight:650;cursor:pointer}.sc-reports button.primary{background:#2563eb;color:white;border-color:#2563eb}.sc-reports button:disabled{opacity:.6;cursor:wait}
      .sc-reports .rp-filters{display:grid;grid-template-columns:repeat(5,minmax(130px,1fr));gap:12px;background:var(--surface,#fff);border:1px solid var(--border,#dce5f0);border-radius:13px;padding:16px;margin-bottom:16px}
      .sc-reports label{display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:650;color:var(--muted,#64748b)}.sc-reports input,.sc-reports select{min-width:0;width:100%;border:1px solid var(--border,#cbd5e1);border-radius:8px;background:var(--surface-soft,#f8fafc);color:var(--text,#172b46);padding:10px;font:inherit;font-size:13px;min-height:40px}
      .sc-reports .rp-stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-bottom:16px}.sc-reports .rp-platform-summary{margin-bottom:16px}.sc-reports .rp-platform-summary table{white-space:nowrap}.sc-reports .rp-platform-summary .rp-empty{padding:18px}.sc-reports .rp-stat{background:var(--surface,#fff);border:1px solid var(--border,#dce5f0);border-radius:12px;padding:15px}.sc-reports .rp-stat span{display:block;font-size:12px;color:var(--muted,#64748b)}.sc-reports .rp-stat strong{display:block;font-size:25px;margin-top:7px;color:var(--text,#172b46)}
      .sc-reports .rp-panel{background:var(--surface,#fff);border:1px solid var(--border,#dce5f0);border-radius:13px;overflow:hidden}.sc-reports .rp-panel-head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding:16px;border-bottom:1px solid var(--border,#e2e8f0)}.sc-reports .rp-panel-head h3{font-size:16px;margin:0 0 4px}.sc-reports .rp-table-wrap{overflow:auto;max-height:650px}.sc-reports table{width:100%;border-collapse:collapse;white-space:nowrap;font-size:12px}.sc-reports th,.sc-reports td{text-align:left;padding:11px 13px;border-bottom:1px solid var(--border,#e2e8f0)}.sc-reports th{position:sticky;top:0;background:var(--surface-soft,#f8fafc);color:var(--muted,#64748b);z-index:1}.sc-reports .rp-pill{display:inline-block;padding:4px 8px;border-radius:99px;background:#eaf0f7;color:#334155;font-size:10px;font-weight:750}.sc-reports .rp-pill.pending{background:#fef3c7;color:#92400e}.sc-reports .rp-pill.approved,.sc-reports .rp-pill.locked{background:#dcfce7;color:#166534}.sc-reports .rp-pill.returned,.sc-reports .rp-pill.rejected,.sc-reports .rp-pill.cancelled{background:#fee2e2;color:#991b1b}.sc-reports .rp-status{padding:12px 16px;font-size:12px;color:var(--muted,#64748b)}.sc-reports .rp-status.error{color:#dc2626}.sc-reports .rp-empty{text-align:center;padding:30px;color:var(--muted,#64748b)}
      @media(max-width:1000px){.sc-reports .rp-filters{grid-template-columns:repeat(3,minmax(0,1fr))}.sc-reports .rp-stats{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:620px){.sc-reports .rp-filters,.sc-reports .rp-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.sc-reports .rp-filters label:last-child{grid-column:1/-1}}
    </style>
    <div class="rp-head"><div><h2>Operational Reports</h2><p>Review seating volume, approval status, platform distribution, and employee assignments.</p></div><div class="rp-actions"><button id="rp-refresh">↻ Refresh data</button><button id="rp-export" class="primary">Export CSV</button></div></div>
    <div class="rp-filters">
      <label>From date<input id="rp-from" type="date" value="${todayColombo()}" /></label>
      <label>To date<input id="rp-to" type="date" value="${todayColombo()}" /></label>
      <label>Shift<select id="rp-shift"><option value="ALL">All shifts</option><option value="MORNING">Morning</option><option value="NIGHT">Night</option></select></label>
      <label>Platform<select id="rp-platform"><option value="ALL">All platforms</option></select></label>
      <label>Status<select id="rp-status-filter"><option value="ALL">All statuses</option><option value="PENDING">Pending</option><option value="APPROVED">Approved</option><option value="LOCKED">Locked</option><option value="RETURNED">Returned</option><option value="REJECTED">Rejected</option><option value="CANCELLED">Cancelled</option><option value="TRANSFERRED">Transferred</option></select></label>
      <label>Search<input id="rp-search" type="search" placeholder="Employee, platform, laptop…" /></label>
    </div>
    <div class="rp-stats" id="rp-stats"><div class="rp-stat"><span>Assignments</span><strong>—</strong></div><div class="rp-stat"><span>Unique employees</span><strong>—</strong></div><div class="rp-stat"><span>Pending</span><strong>—</strong></div><div class="rp-stat"><span>Approved / Locked</span><strong>—</strong></div><div class="rp-stat"><span>Platforms used</span><strong>—</strong></div></div>
    <div class="rp-panel rp-platform-summary"><div class="rp-panel-head"><div><h3>Platform-wise summary</h3><p>Assignments and approval status grouped by platform for the selected date range and shift.</p></div></div><div class="rp-table-wrap" id="rp-platform-summary"><div class="rp-empty">Loading platform summary…</div></div></div>
    <div class="rp-panel"><div class="rp-panel-head"><div><h3>Seating report</h3><p id="rp-result-count">Loading records…</p></div></div><div class="rp-table-wrap" id="rp-table-wrap"><div class="rp-empty">Loading seating records…</div></div><div id="rp-message" class="rp-status" role="status"></div></div>
    <p style="margin-top:12px;font-size:12px;color:var(--muted,#64748b)">Report uses up to 2,000 readable seating records from Firestore. Export contains only the records currently matching your filters.</p>
  </section>`;

  const $ = (s) => root.querySelector(s);
  let records = [];
  let filtered = [];
  const message = (text, error = false) => { $('#rp-message').textContent = text; $('#rp-message').className = `rp-status${error ? ' error' : ''}`; };

  function applyFilters() {
    const from = $('#rp-from').value;
    const to = $('#rp-to').value;
    const shift = $('#rp-shift').value;
    const status = $('#rp-status-filter').value;
    const platform = $('#rp-platform').value;
    const search = $('#rp-search').value.trim().toLowerCase();
    filtered = records.filter((r) => {
      const d = dateOf(r);
      if (from && d && d < from) return false;
      if (to && d && d > to) return false;
      if (shift !== 'ALL' && norm(r.shift) !== shift) return false;
      if (status !== 'ALL' && statusOf(r) !== status) return false;
      if (platform !== 'ALL' && String(r.platformId || r.platformName || '').trim() !== platform) return false;
      if (search) {
        const haystack = [r.employeeId, r.employeeName, r.platformId, r.platformName, r.laptopName, r.handledAccount, ...(Array.isArray(r.handledAccounts) ? r.handledAccounts : []), r.withdrawalWork, ...(Array.isArray(r.withdrawalWorks) ? r.withdrawalWorks : []), r.department, r.createdByName, r.approvedBy].join(' ').toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    }).sort((a, b) => `${dateOf(b)}${b.createdAt?.seconds || 0}`.localeCompare(`${dateOf(a)}${a.createdAt?.seconds || 0}`));

    const uniqueEmployees = new Set(filtered.map(r => String(r.employeeId || r.employeeName || '').trim()).filter(Boolean)).size;
    const pending = filtered.filter(r => statusOf(r) === 'PENDING').length;
    const approved = filtered.filter(r => ['APPROVED', 'LOCKED'].includes(statusOf(r))).length;
    const platforms = new Set(filtered.map(r => String(r.platformId || r.platformName || '').trim()).filter(Boolean)).size;
    $('#rp-stats').innerHTML = [
      ['Assignments', filtered.length], ['Unique employees', uniqueEmployees], ['Pending', pending], ['Approved / Locked', approved], ['Platforms used', platforms]
    ].map(([label, value]) => `<div class="rp-stat"><span>${label}</span><strong>${value}</strong></div>`).join('');
    $('#rp-result-count').textContent = `${filtered.length} matching record(s) · ${records.length} loaded`;

    const byPlatform = new Map();
    filtered.forEach((r) => {
      const key = String(r.platformId || r.platformName || 'UNASSIGNED').trim() || 'UNASSIGNED';
      if (!byPlatform.has(key)) byPlatform.set(key, { platform: key, assignments: 0, employees: new Set(), pending: 0, approved: 0, returned: 0, cancelled: 0 });
      const item = byPlatform.get(key);
      item.assignments += 1;
      const employeeKey = String(r.employeeId || r.employeeName || '').trim();
      if (employeeKey) item.employees.add(employeeKey);
      const st = statusOf(r);
      if (st === 'PENDING') item.pending += 1;
      if (['APPROVED', 'LOCKED'].includes(st)) item.approved += 1;
      if (['RETURNED', 'REJECTED'].includes(st)) item.returned += 1;
      if (st === 'CANCELLED') item.cancelled += 1;
    });
    const platformRows = [...byPlatform.values()].sort((a, b) => a.platform.localeCompare(b.platform));
    $('#rp-platform-summary').innerHTML = platformRows.length ? `<table><thead><tr><th>Platform</th><th>Assignments</th><th>Unique employees</th><th>Pending</th><th>Approved / Locked</th><th>Returned / Rejected</th><th>Cancelled</th></tr></thead><tbody>${platformRows.map((p) => `<tr><td><strong>${esc(p.platform)}</strong></td><td>${p.assignments}</td><td>${p.employees.size}</td><td>${p.pending}</td><td>${p.approved}</td><td>${p.returned}</td><td>${p.cancelled}</td></tr>`).join('')}</tbody></table>` : '<div class="rp-empty">No platform data matches these filters.</div>';

    $('#rp-table-wrap').innerHTML = filtered.length ? `<table><thead><tr><th>Business date</th><th>Shift</th><th>Employee ID</th><th>Employee</th><th>Department</th><th>Platform</th><th>Laptop</th><th>Handled account</th><th>Withdrawal work</th><th>Status</th><th>Created by</th><th>Approved by</th></tr></thead><tbody>${filtered.map(r => {
      const st = statusOf(r).toLowerCase();
      const accounts = Array.isArray(r.handledAccounts) ? r.handledAccounts.join(', ') : (r.handledAccount || '—');
      const withdrawals = Array.isArray(r.withdrawalWorks) ? r.withdrawalWorks.join(', ') : (r.withdrawalWork || '—');
      return `<tr><td>${esc(dateOf(r) || '—')}</td><td>${esc(norm(r.shift) || '—')}</td><td>${esc(r.employeeId || '—')}</td><td>${esc(r.employeeName || '—')}</td><td>${esc(r.department || r.employeeDepartment || '—')}</td><td>${esc(r.platformName || r.platformId || '—')}</td><td>${esc(r.laptopName || '—')}</td><td>${esc(accounts)}</td><td>${esc(withdrawals)}</td><td><span class="rp-pill ${esc(st)}">${esc(statusOf(r))}</span></td><td>${esc(r.createdByName || r.createdBy || '—')}</td><td>${esc(r.approvedByName || r.approvedBy || '—')}</td></tr>`;
    }).join('')}</tbody></table>` : '<div class="rp-empty">No seating records match these filters.</div>';
  }

  async function load() {
    const button = $('#rp-refresh'); button.disabled = true; button.textContent = 'Loading…';
    message('Loading seating records from Firestore…');
    try {
      const snap = await getDocs(query(collection(db, 'seatings'), limit(2000)));
      records = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const currentPlatform = $('#rp-platform').value;
      const platformOptions = [...new Set(records.map(r => String(r.platformId || r.platformName || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
      $('#rp-platform').innerHTML = '<option value="ALL">All platforms</option>' + platformOptions.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
      if (platformOptions.includes(currentPlatform)) $('#rp-platform').value = currentPlatform;
      applyFilters();
      message(`Loaded ${records.length} seating record(s).`);
    } catch (e) {
      records = []; filtered = []; applyFilters();
      message(`Could not load reports: ${friendlyError(e) || e.message || 'Firestore access failed.'}`, true);
    } finally { button.disabled = false; button.textContent = '↻ Refresh data'; }
  }

  function exportCsv() {
    if (!filtered.length) { message('No matching records to export.', true); return; }
    const columns = [
      ['Business Date', r => dateOf(r)], ['Shift', r => r.shift], ['Employee ID', r => r.employeeId], ['Employee Name', r => r.employeeName],
      ['Department', r => r.department || r.employeeDepartment], ['Platform', r => r.platformName || r.platformId], ['Laptop', r => r.laptopName],
      ['Handled Account', r => Array.isArray(r.handledAccounts) ? r.handledAccounts.join('; ') : r.handledAccount],
      ['Withdrawal Work', r => Array.isArray(r.withdrawalWorks) ? r.withdrawalWorks.join('; ') : r.withdrawalWork], ['Status', r => r.status],
      ['Created By', r => r.createdByName || r.createdBy], ['Approved By', r => r.approvedByName || r.approvedBy]
    ];
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [columns.map(c => cell(c[0])).join(','), ...filtered.map(r => columns.map(c => cell(c[1](r))).join(','))].join('\r\n');
    const blob = new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = `seating-report-${$('#rp-from').value || 'all'}-to-${$('#rp-to').value || 'all'}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    message(`Exported ${filtered.length} record(s) to CSV.`);
  }

  ['#rp-from', '#rp-to', '#rp-shift', '#rp-platform', '#rp-status-filter'].forEach(s => $(s).addEventListener('change', applyFilters));
  $('#rp-search').addEventListener('input', applyFilters);
  $('#rp-refresh').addEventListener('click', load);
  $('#rp-export').addEventListener('click', exportCsv);
  await load();
}
