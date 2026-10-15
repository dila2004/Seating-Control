import { collection, getDocs, limit, query, where } from 'firebase/firestore';



import { db } from './firebase.js';



import { friendlyError, logout } from './auth.js';



import { renderPlatformsPage } from './platforms.js';



import { renderEmployeesPage } from './employees.js';
import { renderApprovalsPage } from './approvals.js';
import { renderAddSeatingPage } from './addSeating.js';
import { renderCurrentSeatingPage } from './seatings.js';
import { renderPicsPage } from './pics.js';
import { renderHistoryPage } from './history.js';
import { renderUsersPage } from './users.js';
import { renderCompliancePage } from './compliance.js';
import { renderSettingsPage } from './settings.js';







const roleLabels = { STAFF: 'Operations Staff', PIC: 'Person in Charge', TL: 'Team Lead', SPV: 'Supervisor', ADMIN: 'Administrator' };



const navByRole = {



  STAFF: ['Dashboard', 'Current Seating', 'Add Seating', 'Employees', 'Platforms'],



  PIC: ['Dashboard', 'Current Seating', 'Pending Approval', 'Employees', 'Platforms', 'Compliance', 'History', 'Reports'],



  TL: ['Dashboard', 'Current Seating', 'Add Seating', 'Pending Approval', 'Employees', 'PIC Management', 'Platforms', 'Compliance', 'History', 'Reports'],



  SPV: ['Dashboard', 'Current Seating', 'Add Seating', 'Pending Approval', 'Employees', 'PIC Management', 'Platforms', 'Compliance', 'History', 'Reports'],



  ADMIN: ['Dashboard', 'Current Seating', 'Add Seating', 'Pending Approval', 'Employees', 'PIC Management', 'Platforms', 'Compliance', 'History', 'Reports', 'Users', 'Settings']



};







function currentShift(date = new Date()) {



  const mins = date.getHours() * 60 + date.getMinutes();



  return mins >= 450 && mins < 1170 ? 'MORNING' : 'NIGHT';



}



function fmtDate(date = new Date()) {



  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);



}



const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);







function statCard(label, value, hint, icon, accent = '') {



  return `<article class="stat-card ${accent}"><div class="stat-top"><span>${label}</span><span class="stat-icon">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-hint">${hint}</div></article>`;



}







async function loadSummary() {



  const businessDate = fmtDate();



  const shift = currentShift();



  const [platformSnap, employeeSnap, seatingSnap] = await Promise.all([



    getDocs(query(collection(db, 'platforms'), limit(100))),



    getDocs(query(collection(db, 'employees'), where('status', '==', 'ACTIVE'), limit(500))),



    getDocs(query(collection(db, 'seatings'), where('businessDate', '==', businessDate), where('shift', '==', shift), limit(500)))



  ]);



  const seatings = seatingSnap.docs.map((doc) => doc.data());
  let transferRequests = [];
  try {
    const requestSnap = await getDocs(query(collection(db, 'seatingChangeRequests'), where('status', '==', 'PENDING'), limit(500)));
    transferRequests = requestSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((r) => (r.businessDate || r.date) === businessDate && r.shift === shift);
  } catch (error) {
    transferRequests = [];
  }



  const expected = employeeSnap.size;



  const seatedIds = new Set(seatings.filter((s) => !['CANCELLED', 'TRANSFERRED'].includes(String(s.status || '').toUpperCase())).map((s) => s.employeeId));



  const seated = seatedIds.size;



  const pending = seatings.filter((s) => s.status === 'PENDING').length;



  const approved = seatings.filter((s) => ['APPROVED', 'LOCKED'].includes(s.status)).length;



  const locked = seatings.filter((s) => s.status === 'LOCKED').length;



  const missing = Math.max(expected - seated, 0);



  const changes = seatings.reduce((sum, s) => sum + (Number(s.changeCount) || 0), 0);



  return { businessDate, shift, platformCount: platformSnap.size, expected, seated, pending, approved, locked, missing, changes, transferRequests, employees: employeeSnap.docs.map((d) => d.data()), platforms: platformSnap.docs.map((d) => ({ id: d.id, ...d.data() })), seatings };



}







export async function renderDashboard(root, user, profile) {



  const role = profile.role || 'STAFF';



  const nav = navByRole[role] || ['Dashboard'];



  root.innerHTML = `



    <div class="app-shell">



      <aside class="sidebar">



        <div class="brand"><div class="brand-mark">SC</div><div><strong>Seating Control</strong><small>OPERATIONS CENTER</small></div></div>



        <div class="nav-caption">WORKSPACE</div>



        <nav class="side-nav">${nav.map((item, i) => `<button class="nav-item ${i === 0 ? 'active' : ''}" data-page="${item}"><span class="nav-dot"></span>${item}</button>`).join('')}</nav>



        <div class="sidebar-bottom"><div class="system-health"><span class="health-dot"></span><span><strong>System online</strong><small>Firebase connected</small></span></div><div class="sidebar-foot">SEATING CONTROL CENTER<br/>Internal Operations</div></div>



      </aside>



      <main class="main-area">



        <header class="topbar"><div class="mobile-brand">SC <strong>Seating Control Center</strong></div><div class="topbar-right"><span class="top-date">${fmtDate()}</span><span class="avatar">${escapeHtml((profile.name || user.email || 'U').slice(0, 1).toUpperCase())}</span><div class="user-meta"><strong>${escapeHtml(profile.name || user.email || 'User')}</strong><small>${roleLabels[role] || role}</small></div><button class="button button-ghost button-small" id="logout-btn">Log out</button></div></header>



        <section class="page-content" id="page-content">



          <div class="page-heading"><div><div class="eyebrow">OVERVIEW / OPERATIONS</div><h1>Seating Control Center</h1><p>Monitor daily seating operations across all authorized platforms.</p></div><div class="heading-badge"><span class="health-dot"></span> Live workspace</div></div>



          <div id="dashboard-alert" class="alert hidden"></div>
          <style>
            .balance-low{background:#fee4e2!important;color:#b42318!important;border-color:#fecdca!important}
            .balance-ok{background:#dcfae6!important;color:#067647!important;border-color:#abefc6!important}
            .balance-high{background:#dbeafe!important;color:#1d4ed8!important;border-color:#bfdbfe!important}
            .balance-na{background:#eef2f6!important;color:#667085!important;border-color:#e4e7ec!important}
            .capacity-caption{color:var(--muted,#718096);font-size:10px}
            .capacity-dot{display:inline-block;width:9px;height:9px;border-radius:50%}
            .capacity-dot.balance-low{background:#dc2626!important}.capacity-dot.balance-ok{background:#16a34a!important}.capacity-dot.balance-high{background:#2563eb!important}.capacity-dot.balance-na{background:#98a2b3!important}
            .platform-category summary small{white-space:normal;text-align:right}
          </style>



          <div class="summary-strip"><div><span class="summary-label">BUSINESS DATE</span><strong id="business-date">${fmtDate()}</strong></div><div><span class="summary-label">CURRENT SHIFT</span><strong id="current-shift">${currentShift()}</strong></div><div><span class="summary-label">YOUR ROLE</span><strong>${escapeHtml(role)}</strong></div><div><span class="summary-label">PLATFORMS</span><strong id="platform-count">—</strong></div></div>



          <div class="section-title"><div><h2>Today's seating</h2><p>Counts reflect records currently readable by your account.</p></div><button id="refresh-btn" class="button button-outline">↻ Refresh</button></div>



          <div id="stats-grid" class="stats-grid">${statCard('Expected employees', '—', 'Active employee records', '◎')}${statCard('Seated', '—', 'Unique employees with seating', '✓', 'accent-green')}${statCard('Pending approval', '—', 'Waiting for PIC review', '◷', 'accent-amber')}${statCard('Missing seating', '—', 'Expected minus seated', '!', 'accent-red')}</div>



          <div class="lower-grid"><section class="panel"><div class="panel-heading"><div><h3>Platform status</h3><p>Configured platforms from Firestore</p></div><span class="panel-chip" id="platform-total">0 platforms</span></div><div id="platform-grid" class="platform-grid"><div class="loading-line">Loading platforms…</div></div></section><section class="panel"><div class="panel-heading"><div><h3>Approval snapshot</h3><p>Current shift summary</p></div></div><div id="approval-snapshot" class="approval-list"><div class="loading-line">Loading summary…</div></div><div class="panel-note">Operational actions will be enabled after server-side validation is implemented.</div></section></div>



          <section class="panel" style="margin-top:18px">
            <div class="panel-heading"><div><h3>Seating change requests</h3><p>Transfers requested from an existing platform. Previous seating stays in history.</p></div><span class="panel-chip" id="transfer-request-count">0 pending</span></div>
            <div id="transfer-request-list" style="padding:14px 20px"><div class="loading-line">Loading requests…</div></div>
          </section>

          <div class="phase-note"><div class="phase-icon">i</div><div><strong>Phase 1 foundation</strong><p>Authentication and role-based dashboard are active. Seating writes, approvals, and admin mutations remain disabled until server-side validation and security tests are implemented.</p></div></div>



          <footer>Seating Control Center <span>•</span> Internal Operations <span>•</span> Phase 2</footer>



        </section>



      </main>



    </div>`;







  root.querySelector('#logout-btn').addEventListener('click', async () => { try { await logout(); } catch (e) { showAlert(friendlyError(e)); } });



  root.querySelector('#refresh-btn').addEventListener('click', refreshSummary);



  root.querySelectorAll('[data-page]').forEach((btn) => btn.addEventListener('click', async () => {



    root.querySelectorAll('[data-page]').forEach((item) => item.classList.toggle('active', item === btn));



    const page = btn.dataset.page;



    if (page === 'Platforms') {



      await renderPlatformsPage(root.querySelector('#page-content'), profile);



    } else if (page === 'Employees') {

        await renderEmployeesPage(root.querySelector('#page-content'), profile);

      } else if (page === 'Current Seating') {
        await renderCurrentSeatingPage(root.querySelector('#page-content'), profile);
      } else if (page === 'Add Seating') {
        await renderAddSeatingPage(root.querySelector('#page-content'), profile);
      } else if (page === 'Pending Approval') {
        await renderApprovalsPage(root.querySelector('#page-content'), profile);
      } else if (page === 'PIC Management') {
      if (!['ADMIN', 'TL', 'SPV'].includes(role)) {
        showAlert('Access denied. PIC Management is available to administrators, Team Leads, and Supervisors.');
        return;
      }
      await renderPicsPage(root.querySelector('#page-content'), profile);
    } else if (page === 'Compliance') {
      if (!['PIC', 'TL', 'SPV', 'ADMIN'].includes(role)) {
        showAlert('Access denied. Compliance is available to PIC, Team Leads, Supervisors, and Administrators.');
        return;
      }
      await renderCompliancePage(root.querySelector('#page-content'), profile);
    } else if (page === 'History') {
      await renderHistoryPage(root.querySelector('#page-content'), user, profile);
    } else if (page === 'Settings') {
      if (role !== 'ADMIN') {
        showAlert('Access denied. Settings are available to administrators only.');
        return;
      }
      await renderSettingsPage(root.querySelector('#page-content'), profile);
    } else if (page === 'Users') {
      if (role !== 'ADMIN') {
        showAlert('Access denied. User Management is available to administrators only.');
        return;
      }
      await renderUsersPage(root.querySelector('#page-content'), user, profile);
    } else if (page === 'Dashboard') {



      renderDashboard(root, user, profile);



    } else {



      showAlert(`${page} is not implemented yet. No data has been changed.`);



    }



  }));



  await refreshSummary();







  async function refreshSummary() {



    const button = root.querySelector('#refresh-btn');



    if (!button) return;



    button.disabled = true; button.textContent = 'Refreshing…';



    try {



      const data = await loadSummary();



      root.querySelector('#business-date').textContent = data.businessDate;



      root.querySelector('#current-shift').textContent = data.shift;



      root.querySelector('#platform-count').textContent = data.platformCount;



      root.querySelector('#stats-grid').innerHTML = statCard('Expected employees', data.expected, 'Active employee records', '◎') + statCard('Seated', data.seated, 'Unique employees with seating', '✓', 'accent-green') + statCard('Pending approval', data.pending, 'Waiting for PIC review', '◷', 'accent-amber') + statCard('Missing seating', data.missing, 'Expected minus seated', '!', 'accent-red');



      root.querySelector('#platform-total').textContent = `${data.platformCount} platforms`;
      const transferCount = root.querySelector('#transfer-request-count');
      const transferList = root.querySelector('#transfer-request-list');
      if (transferCount) transferCount.textContent = `${(data.transferRequests || []).length} pending`;
      if (transferList) {
        transferList.innerHTML = (data.transferRequests || []).length
          ? data.transferRequests.map((r) => `<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:10px 0;border-bottom:1px solid var(--border,#e3e8ef)"><div><strong>${escapeHtml(r.employeeName || r.employeeId)}</strong><div style="font-size:12px;color:var(--muted);margin-top:4px">${escapeHtml(r.fromPlatformName || r.fromPlatformId || 'Current platform')} → ${escapeHtml(r.toPlatformName || r.toPlatformId || 'Requested platform')} · ${escapeHtml(r.shift)}</div></div><span class="panel-chip">Pending PIC review</span></div>`).join('')
          : '<div class="loading-line">No pending seating change requests for this shift.</div>';
      }




      const grouped = new Map();



      data.seatings.filter((s) => !['CANCELLED', 'TRANSFERRED'].includes(String(s.status || '').toUpperCase())).forEach((s) => { const list = grouped.get(s.platformId) || []; list.push(s); grouped.set(s.platformId, list); });



      root.querySelector('#platform-grid').innerHTML = data.platforms.length ? (() => {
        // Group every configured platform (including platforms with zero seating)
        // into a collapsible main category such as KANE, JAX, REX, ZANE or IRIS.
        const categories = new Map();
        const getCategory = (platform) => {
          const label = String(platform.category || platform.name || platform.platformId || platform.id || '').trim();
          const match = label.match(/^([a-z]+)/i);
          return match ? match[1].toUpperCase() : 'OTHER';
        };
        const sortedPlatforms = [...data.platforms].sort((a, b) =>
          String(a.name || a.platformId || a.id).localeCompare(String(b.name || b.platformId || b.id))
        );
        sortedPlatforms.forEach((p) => {
          const category = getCategory(p);
          if (!categories.has(category)) categories.set(category, []);
          categories.get(category).push(p);
        });
        return [...categories.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([category, platforms]) => {
          const categorySeated = platforms.reduce((sum, p) => sum + (grouped.get(p.id) || []).filter((s) => s.status !== 'CANCELLED').length, 0);
          const categoryPending = platforms.reduce((sum, p) => sum + (grouped.get(p.id) || []).filter((s) => String(s.status || '').toUpperCase() === 'PENDING').length, 0);
          const capacityFor = (p, rows) => {
            const capacity = p.laptopCapacity || {};
            const expected = { GS: Number(capacity.GS || 0), DP: Number(capacity.DP || 0), WD: Number(capacity.WD || 0) };
            const current = { GS: 0, DP: 0, WD: 0 };
            rows.filter((s) => String(s.status || '').toUpperCase() !== 'CANCELLED').forEach((s) => {
              const linkedEmployee = data.employees.find((e) => String(e.employeeId || e.id || '') === String(s.employeeId || '')) || {};
              const dept = String(s.department || s.employeeDepartment || linkedEmployee.department || '').toUpperCase();
              if (Object.prototype.hasOwnProperty.call(current, dept)) current[dept] += 1;
            });
            const totalExpected = expected.GS + expected.DP + expected.WD;
            const totalCurrent = current.GS + current.DP + current.WD;
            const tone = totalExpected === 0 ? 'balance-na' : totalCurrent < totalExpected ? 'balance-low' : totalCurrent > totalExpected ? 'balance-high' : 'balance-ok';
            const label = totalExpected === 0 ? 'CAPACITY NOT SET' : totalCurrent < totalExpected ? `${totalExpected-totalCurrent} LAPTOP SEATS FREE` : totalCurrent > totalExpected ? `${totalCurrent-totalExpected} OVER ALLOCATION` : 'ALLOCATION MATCHED';
            return { expected, current, totalExpected, totalCurrent, tone, label };
          };
          const categoryCapacity = platforms.reduce((sum, p) => {
            const c = capacityFor(p, grouped.get(p.id) || []);
            ['GS','DP','WD'].forEach((d) => { sum.expected[d] += c.expected[d]; sum.current[d] += c.current[d]; });
            return sum;
          }, { expected:{GS:0,DP:0,WD:0}, current:{GS:0,DP:0,WD:0} });
          const catExpected = categoryCapacity.expected.GS + categoryCapacity.expected.DP + categoryCapacity.expected.WD;
          const catCurrent = categoryCapacity.current.GS + categoryCapacity.current.DP + categoryCapacity.current.WD;
          const catTone = catExpected === 0 ? 'balance-na' : catCurrent < catExpected ? 'balance-low' : catCurrent > catExpected ? 'balance-high' : 'balance-ok';
          const catAlert = catExpected === 0 ? 'Capacity not set' : catCurrent < catExpected ? `${catExpected-catCurrent} below laptop allocation` : catCurrent > catExpected ? `${catCurrent-catExpected} above laptop allocation` : 'Laptop allocation matched';
          const platformCards = platforms.map((p) => {
            const rows = grouped.get(p.id) || [];
            const activeRows = rows.filter((s) => String(s.status || '').toUpperCase() !== 'CANCELLED');
            const pending = activeRows.filter((s) => String(s.status || '').toUpperCase() === 'PENDING').length;
            const approved = activeRows.filter((s) => ['APPROVED', 'LOCKED'].includes(String(s.status || '').toUpperCase())).length;
            const cap = capacityFor(p, activeRows);
            const label = p.name || p.platformId || p.id;
            const deptCounts = ['GS','DP','WD'].map((d) => `${d} ${cap.current[d]}/${cap.expected[d]}`).join(' · ');
            return `<article class="platform-card" style="min-width:0">
              <div class="platform-card-top"><strong>${escapeHtml(label)}</strong><span class="status-pill ${cap.tone}">${escapeHtml(cap.label)}</span></div>
              <div class="platform-metrics">
                <div><strong>${activeRows.length}</strong><small>Seated</small></div>
                <div><strong>${pending}</strong><small>Pending</small></div>
                <div><strong>${approved}</strong><small>Approved</small></div>
              </div>
              <div class="platform-foot"><span>${escapeHtml(deptCounts)} <span class="capacity-caption">(seated / laptops)</span></span></div>
            </article>`;
          }).join('');
          return `<details class="platform-category" style="border:1px solid var(--border,#dbe4f0);border-radius:12px;background:var(--surface,#fff);margin-bottom:10px;overflow:hidden">
            <summary style="cursor:pointer;list-style:none;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;background:var(--surface-soft,#f7f9fc)">
              <span style="display:flex;align-items:center;gap:10px;min-width:0"><strong>${escapeHtml(category)}</strong><span class="panel-chip">${platforms.length} sub-platform${platforms.length === 1 ? '' : 's'}</span></span>
              <span style="display:flex;align-items:center;gap:12px;white-space:nowrap"><small>${categorySeated} seated · ${categoryPending} pending · ${catAlert}</small><span class="capacity-dot ${catTone}" aria-hidden="true"></span><span aria-hidden="true">⌄</span></span>
            </summary>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;padding:12px">${platformCards}</div>
          </details>`;
        }).join('');
      })() : '<div class="empty-state">No platforms configured yet. Open Platforms to view the directory.</div>';

      root.querySelector('#approval-snapshot').innerHTML = `<div class="approval-row"><span class="approval-mark amber">◷</span><div><strong>Pending review</strong><small>Awaiting PIC check</small></div><b>${data.pending}</b></div><div class="approval-row"><span class="approval-mark green">✓</span><div><strong>Approved / locked</strong><small>Validated seating records</small></div><b>${data.approved}</b></div><div class="approval-row"><span class="approval-mark blue">↗</span><div><strong>Platform changes</strong><small>Change counter on current records</small></div><b>${data.changes}</b></div>`;



      hideAlert();



    } catch (error) { showAlert(`Dashboard data could not be loaded: ${friendlyError(error)}. An empty database is okay during setup.`); }



    finally { const current = root.querySelector('#refresh-btn'); if (current) { current.disabled = false; current.textContent = '↻ Refresh'; } }



  }



}



function showAlert(message) { const el = document.querySelector('#dashboard-alert'); if (el) { el.textContent = message; el.classList.remove('hidden'); } }



function hideAlert() { const el = document.querySelector('#dashboard-alert'); if (el) el.classList.add('hidden'); }
