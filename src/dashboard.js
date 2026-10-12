import { collection, getDocs, limit, query, where } from 'firebase/firestore';



import { db } from './firebase.js';



import { friendlyError, logout } from './auth.js';



import { renderPlatformsPage } from './platforms.js';



import { renderEmployeesPage } from './employees.js';
import { renderPicsPage } from './pics.js';







const roleLabels = { STAFF: 'Operations Staff', PIC: 'Person in Charge', TL: 'Team Lead', SPV: 'Supervisor', ADMIN: 'Administrator' };



const navByRole = {



  STAFF: ['Dashboard', 'Current Seating', 'Add Seating', 'Employees', 'Platforms'],



  PIC: ['Dashboard', 'Current Seating', 'Pending Approval', 'Employees', 'Platforms', 'Compliance', 'History', 'Reports'],



  TL: ['Dashboard', 'Current Seating', 'Pending Approval', 'Employees', 'Platforms', 'Compliance', 'History', 'Reports'],



  SPV: ['Dashboard', 'Current Seating', 'Pending Approval', 'Employees', 'Platforms', 'Compliance', 'History', 'Reports'],



  ADMIN: ['Dashboard', 'Current Seating', 'Pending Approval', 'Employees', 'PIC Management', 'Platforms', 'Compliance', 'History', 'Reports', 'Users', 'Settings']



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



  const expected = employeeSnap.size;



  const seatedIds = new Set(seatings.filter((s) => s.status !== 'CANCELLED').map((s) => s.employeeId));



  const seated = seatedIds.size;



  const pending = seatings.filter((s) => s.status === 'PENDING').length;



  const approved = seatings.filter((s) => ['APPROVED', 'LOCKED'].includes(s.status)).length;



  const locked = seatings.filter((s) => s.status === 'LOCKED').length;



  const missing = Math.max(expected - seated, 0);



  const changes = seatings.reduce((sum, s) => sum + (Number(s.changeCount) || 0), 0);



  return { businessDate, shift, platformCount: platformSnap.size, expected, seated, pending, approved, locked, missing, changes, employees: employeeSnap.docs.map((d) => d.data()), platforms: platformSnap.docs.map((d) => ({ id: d.id, ...d.data() })), seatings };



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



          <div class="summary-strip"><div><span class="summary-label">BUSINESS DATE</span><strong id="business-date">${fmtDate()}</strong></div><div><span class="summary-label">CURRENT SHIFT</span><strong id="current-shift">${currentShift()}</strong></div><div><span class="summary-label">YOUR ROLE</span><strong>${escapeHtml(role)}</strong></div><div><span class="summary-label">PLATFORMS</span><strong id="platform-count">—</strong></div></div>



          <div class="section-title"><div><h2>Today's seating</h2><p>Counts reflect records currently readable by your account.</p></div><button id="refresh-btn" class="button button-outline">↻ Refresh</button></div>



          <div id="stats-grid" class="stats-grid">${statCard('Expected employees', '—', 'Active employee records', '◎')}${statCard('Seated', '—', 'Unique employees with seating', '✓', 'accent-green')}${statCard('Pending approval', '—', 'Waiting for PIC review', '◷', 'accent-amber')}${statCard('Missing seating', '—', 'Expected minus seated', '!', 'accent-red')}</div>



          <div class="lower-grid"><section class="panel"><div class="panel-heading"><div><h3>Platform status</h3><p>Configured platforms from Firestore</p></div><span class="panel-chip" id="platform-total">0 platforms</span></div><div id="platform-grid" class="platform-grid"><div class="loading-line">Loading platforms…</div></div></section><section class="panel"><div class="panel-heading"><div><h3>Approval snapshot</h3><p>Current shift summary</p></div></div><div id="approval-snapshot" class="approval-list"><div class="loading-line">Loading summary…</div></div><div class="panel-note">Operational actions will be enabled after server-side validation is implemented.</div></section></div>



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

      } else if (page === 'PIC Management') {
      if (role !== 'ADMIN') {
        showAlert('Access denied. PIC Management is available to administrators only.');
        return;
      }
      await renderPicsPage(root.querySelector('#page-content'), profile);
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



      const grouped = new Map();



      data.seatings.filter((s) => s.status !== 'CANCELLED').forEach((s) => { const list = grouped.get(s.platformId) || []; list.push(s); grouped.set(s.platformId, list); });



      root.querySelector('#platform-grid').innerHTML = data.platforms.length ? data.platforms.sort((a,b) => a.id.localeCompare(b.id)).map((p) => {



        const rows = grouped.get(p.id) || [];



        const pending = rows.filter((s) => s.status === 'PENDING').length;



        const approved = rows.filter((s) => ['APPROVED', 'LOCKED'].includes(s.status)).length;



        const expected = data.employees.filter((e) => e.defaultPlatform === p.id).length;



        const status = rows.length === 0 ? 'EMPTY' : pending ? 'PENDING' : 'COMPLETE';



        return `<article class="platform-card"><div class="platform-card-top"><strong>${escapeHtml(p.name || p.platformId || p.id)}</strong><span class="status-pill ${status.toLowerCase()}">${status}</span></div><div class="platform-metrics"><div><strong>${rows.length}</strong><small>Seated</small></div><div><strong>${pending}</strong><small>Pending</small></div><div><strong>${approved}</strong><small>Approved</small></div></div><div class="platform-foot"><span>Expected by default platform: ${expected}</span></div></article>`;



      }).join('') : '<div class="empty-state">No platforms configured yet. Open Platforms to view the directory.</div>';



      root.querySelector('#approval-snapshot').innerHTML = `<div class="approval-row"><span class="approval-mark amber">◷</span><div><strong>Pending review</strong><small>Awaiting PIC check</small></div><b>${data.pending}</b></div><div class="approval-row"><span class="approval-mark green">✓</span><div><strong>Approved / locked</strong><small>Validated seating records</small></div><b>${data.approved}</b></div><div class="approval-row"><span class="approval-mark blue">↗</span><div><strong>Platform changes</strong><small>Change counter on current records</small></div><b>${data.changes}</b></div>`;



      hideAlert();



    } catch (error) { showAlert(`Dashboard data could not be loaded: ${friendlyError(error)}. An empty database is okay during setup.`); }



    finally { const current = root.querySelector('#refresh-btn'); if (current) { current.disabled = false; current.textContent = '↻ Refresh'; } }



  }



}



function showAlert(message) { const el = document.querySelector('#dashboard-alert'); if (el) { el.textContent = message; el.classList.remove('hidden'); } }



function hideAlert() { const el = document.querySelector('#dashboard-alert'); if (el) el.classList.add('hidden'); }
