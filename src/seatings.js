import { collection, deleteDoc, doc, getDocs, limit, query, updateDoc, where, writeBatch, serverTimestamp } from 'firebase/firestore';

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



      <section class="panel cs-transfer-panel" id="cs-transfer-panel">

        <div class="panel-heading"><div><h2 style="margin:0;font-size:16px">Seating change requests</h2><p style="margin:5px 0 0;color:var(--muted);font-size:12px">Transfers stay pending until the previous platform PIC reviews them. Existing seating is kept in history.</p></div><span class="panel-chip" id="cs-transfer-count">Loading…</span></div>

        <div class="cs-transfer-list" id="cs-transfer-list"><div class="cs-empty">Loading access requests…</div></div>

      </section>



      <div class="cs-summary">

        <article class="cs-stat"><span>Active seating records</span><strong id="cs-total">—</strong></article>

        <article class="cs-stat"><span>Pending approval</span><strong id="cs-pending">—</strong></article>

        <article class="cs-stat"><span>Approved / locked</span><strong id="cs-approved">—</strong></article>

        <article class="cs-stat"><span>Active employees</span><strong id="cs-employees">—</strong></article>

      </div>



      <section class="cs-platform-browser">

        <div class="cs-platform-browser-heading">

          <div><h2>Seating by platform</h2><p id="cs-platform-help">Choose a main platform category, then select its sub-platform to view seating records.</p></div>

          <div class="cs-platform-nav-actions"><button type="button" class="button button-outline hidden" id="cs-back-categories">← Main categories</button><button type="button" class="button button-outline" id="cs-show-all">Show all platforms</button></div>

        </div>

        <div id="cs-platform-cards" class="cs-platform-cards"><div class="cs-platform-loading">Loading platforms…</div></div>

      </section>



      <section class="panel cs-panel" id="cs-seating-table-panel">

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

      .cs-page{display:flex;flex-direction:column;gap:20px}.cs-transfer-list{padding:0 18px 16px}.cs-transfer-item{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 0;border-top:1px solid var(--border,#e3e8ef);flex-wrap:wrap}.cs-transfer-item:first-child{border-top:0}.cs-transfer-meta{font-size:12px;color:var(--muted,#718096);margin-top:4px}.cs-transfer-actions{display:flex;gap:8px;flex-wrap:wrap}.cs-transfer-pill{font-size:11px;font-weight:700;padding:5px 8px;border-radius:999px;background:#fff3d6;color:#8a5a00}

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

      .cs-platform-browser{display:flex;flex-direction:column;gap:12px}

      .cs-platform-browser-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}

      .cs-platform-browser-heading h2{margin:0 0 5px;font-size:18px;color:var(--text,#172b4d)}

      .cs-platform-browser-heading p{margin:0;color:var(--muted,#718096);font-size:13px}

      .cs-platform-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px}

      .cs-platform-nav-actions{display:flex;gap:8px;flex-wrap:wrap}

      .cs-category-card .cs-platform-card-name{font-size:17px}

      .cs-category-subtitle{font-size:11px;color:var(--muted,#718096)}

      .cs-platform-card{display:flex;flex-direction:column;gap:12px;min-width:0;text-align:left;padding:16px;border:1px solid var(--border,#dbe3ee);border-radius:13px;background:var(--surface,#fff);color:var(--text,#172b4d);cursor:pointer;transition:border-color .15s,box-shadow .15s,transform .15s}

      .cs-platform-card:hover{border-color:#8bb5ff;box-shadow:0 5px 16px rgba(26,65,120,.08);transform:translateY(-1px)}

      .cs-platform-card.is-selected{border:2px solid var(--primary,#3268e8);padding:15px;background:#f4f8ff}

      .cs-platform-card-top{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}

      .cs-platform-card-name{font-weight:800;font-size:14px;overflow-wrap:anywhere}

      .cs-platform-card-id{font-size:11px;color:var(--muted,#718096);overflow-wrap:anywhere}

      .cs-platform-card-count{font-size:25px;line-height:1;font-weight:800}

      .cs-platform-card-label{font-size:11px;color:var(--muted,#718096)}

      .cs-platform-card-bottom{display:flex;align-items:center;justify-content:space-between;gap:8px}

      .cs-platform-card-status{font-size:10px;font-weight:800;padding:4px 7px;border-radius:999px;background:#e8f8ef;color:#18794e}

      .cs-platform-card-status.empty{background:#edf0f4;color:#667085}

      .cs-capacity-alert{display:flex;flex-direction:column;gap:6px;padding:9px 10px;border-radius:9px;border:1px solid;font-size:11px;font-weight:800}

      .cs-capacity-alert small{font-size:10px;font-weight:600;opacity:.9}

      .cs-capacity-low{background:#fee4e2;color:#b42318;border-color:#fecdca}

      .cs-capacity-ok{background:#dcfae6;color:#067647;border-color:#abefc6}

      .cs-capacity-high{background:#dbeafe;color:#1d4ed8;border-color:#bfdbfe}

      .cs-capacity-na{background:#f2f4f7;color:#667085;border-color:#e4e7ec}

      .cs-capacity-lines{display:flex;flex-wrap:wrap;gap:5px}

      .cs-capacity-lines span{padding:4px 6px;border-radius:6px;background:rgba(255,255,255,.62);font-size:10px;font-weight:800}

      .cs-platform-loading{padding:18px;border:1px dashed var(--border,#dbe3ee);border-radius:12px;color:var(--muted,#718096);background:var(--surface,#fff)}

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

  let transferRequests = [];

  let picAssignments = [];

  let activeCategory = null;

  let showAllSeatings = false;



  function showError(message) {

    alertBox.textContent = message;

    alertBox.classList.remove('hidden');

  }

  function clearError() {

    alertBox.textContent = '';

    alertBox.classList.add('hidden');

  }



  function platformLabel(platform) {

    return String(platform.name || platform.platformName || platform.platformId || platform.id || '').trim();

  }



  // Group child platforms such as JAX-1/JAX-8 or KANE-7/KANE,12 under JAX/KANE.

  // Prefer the visible platform name; IDs are used as a fallback for generic names.

  function mainCategory(platform) {

    const label = platformLabel(platform);

    const id = String(platform.platformId || platform.id || '').trim();

    const known = ['KANE', 'JAX', 'REX', 'ZANE', 'IRIS'];

    for (const candidate of [label, id]) {

      const upper = candidate.toUpperCase();

      const match = known.find((name) => new RegExp(`^${name}(?:$|[\\\s\\\\-_,/0-9])`).test(upper));

      if (match) return match;

    }

    const leading = label.match(/^([A-Za-z]+)/) || id.match(/^([A-Za-z]+)/);

    return leading ? leading[1].toUpperCase() : (label || id || 'OTHER').toUpperCase();

  }



  function renderPlatformCards() {

    const host = $('#cs-platform-cards');

    if (!host) return;

    const search = $('#cs-search').value.trim().toLowerCase();

    const selectedId = $('#cs-platform').value;

    const counts = new Map();

    allRows.filter((row) => !['CANCELLED', 'TRANSFERRED'].includes(String(row.status || '').toUpperCase())).forEach((row) => {

      const id = String(row.platformId || '');

      counts.set(id, (counts.get(id) || 0) + 1);

    });

    const sorted = [...platforms].sort((a, b) => platformLabel(a).localeCompare(platformLabel(b)));

    const categoryMap = new Map();

    sorted.forEach((platform) => {

      const category = mainCategory(platform);

      if (!categoryMap.has(category)) categoryMap.set(category, []);

      categoryMap.get(category).push(platform);

    });



    const matchingCategories = [...categoryMap.entries()].filter(([category, items]) => {

      const haystack = `${category} ${items.map((p) => `${platformLabel(p)} ${p.platformId || ''} ${p.id}`).join(' ')}`.toLowerCase();

      return !search || haystack.includes(search) || allRows.some((row) => {

        const p = platforms.find((item) => String(item.id) === String(row.platformId));

        return p && mainCategory(p) === category && `${row.employeeId || ''} ${row.employeeName || ''}`.toLowerCase().includes(search);

      });

    });



    const backButton = $('#cs-back-categories');

    const help = $('#cs-platform-help');

    backButton.classList.toggle('hidden', !activeCategory);

    if (!activeCategory) {

      help.textContent = 'Choose a main category (KANE, JAX, REX, ZANE, IRIS), then select a sub-platform to view its seating.';

      host.innerHTML = matchingCategories.length ? matchingCategories.map(([category, items]) => {

        const count = items.reduce((sum, platform) => sum + (counts.get(String(platform.id)) || 0), 0);

        const activeCount = items.filter((p) => String(p.status || 'ACTIVE').toUpperCase() === 'ACTIVE').length;

        const aggregate = { expected:{GS:0,DP:0,WD:0}, current:{GS:0,DP:0,WD:0} };

        items.forEach((p) => {

          const cap = p.laptopCapacity || {};

          ['GS','DP','WD'].forEach((d) => { aggregate.expected[d] += Number(cap[d] || 0); });

          allRows.filter((r) => String(r.platformId) === String(p.id) && !['CANCELLED', 'TRANSFERRED'].includes(String(r.status || '').toUpperCase())).forEach((r) => {

            const d = String(r.department || r.employee?.department || '').toUpperCase();

            if (Object.prototype.hasOwnProperty.call(aggregate.current,d)) aggregate.current[d] += 1;

          });

        });

        const expectedTotal = aggregate.expected.GS + aggregate.expected.DP + aggregate.expected.WD;

        const currentTotal = aggregate.current.GS + aggregate.current.DP + aggregate.current.WD;

        const tone = expectedTotal === 0 ? 'na' : currentTotal < expectedTotal ? 'low' : currentTotal > expectedTotal ? 'high' : 'ok';

        const alertText = expectedTotal === 0 ? 'LAPTOP ALLOCATION NOT SET' : currentTotal < expectedTotal ? `${expectedTotal-currentTotal} BELOW ALLOCATION` : currentTotal > expectedTotal ? `${currentTotal-expectedTotal} ABOVE ALLOCATION` : 'ALLOCATION MATCHED';

        const deptLines = ['GS','DP','WD'].map((d) => `<span>${d} ${aggregate.current[d]}/${aggregate.expected[d]}</span>`).join('');

        return `<button type="button" class="cs-platform-card cs-category-card" data-main-category="${escapeHtml(category)}">

          <div class="cs-platform-card-top"><span class="cs-platform-card-name">${escapeHtml(category)}</span><span class="cs-platform-card-status ${count ? '' : 'empty'}">${count ? 'HAS SEATING' : 'NO SEATING'}</span></div>

          <span class="cs-platform-card-id">${items.length} sub-platform${items.length === 1 ? '' : 's'}</span>

          <div class="cs-platform-card-bottom"><span><span class="cs-platform-card-count">${count}</span><br><span class="cs-platform-card-label">seating record${count === 1 ? '' : 's'}</span></span><span class="cs-platform-card-label">${activeCount} active →</span></div>

          <div class="cs-capacity-alert cs-capacity-${tone}">${alertText}<div class="cs-capacity-lines">${deptLines}</div><small>Seated / laptop allocation</small></div>

        </button>`;

      }).join('') : '<div class="cs-platform-loading">No platform categories match your search.</div>';

      host.querySelectorAll('[data-main-category]').forEach((button) => button.addEventListener('click', () => {

        activeCategory = button.dataset.mainCategory;

        renderPlatformCards();

      }));

      return;

    }



    const items = categoryMap.get(activeCategory) || [];

    help.textContent = `${activeCategory}: select a sub-platform to view its seating records.`;

    host.innerHTML = items.length ? items.filter((platform) => {

      if (!search) return true;

      return `${platformLabel(platform)} ${platform.platformId || ''} ${platform.id}`.toLowerCase().includes(search)

        || allRows.some((row) => String(row.platformId) === String(platform.id) && `${row.employeeId || ''} ${row.employeeName || ''}`.toLowerCase().includes(search));

    }).map((platform) => {

      const id = String(platform.id);

      const name = platformLabel(platform) || id;

      const count = counts.get(id) || 0;

      const active = String(platform.status || 'ACTIVE').toUpperCase() === 'ACTIVE';

      const cap = platform.laptopCapacity || {};

      const expected = { GS:Number(cap.GS || 0), DP:Number(cap.DP || 0), WD:Number(cap.WD || 0) };

      const current = { GS:0, DP:0, WD:0 };

      allRows.filter((r) => String(r.platformId) === id && !['CANCELLED', 'TRANSFERRED'].includes(String(r.status || '').toUpperCase())).forEach((r) => {

        const d = String(r.department || r.employee?.department || '').toUpperCase();

        if (Object.prototype.hasOwnProperty.call(current,d)) current[d] += 1;

      });

      const expectedTotal = expected.GS + expected.DP + expected.WD;

      const currentTotal = current.GS + current.DP + current.WD;

      const tone = expectedTotal === 0 ? 'na' : currentTotal < expectedTotal ? 'low' : currentTotal > expectedTotal ? 'high' : 'ok';

      const alertText = expectedTotal === 0 ? 'LAPTOP ALLOCATION NOT SET' : currentTotal < expectedTotal ? `${expectedTotal-currentTotal} BELOW ALLOCATION` : currentTotal > expectedTotal ? `${currentTotal-expectedTotal} ABOVE ALLOCATION` : 'ALLOCATION MATCHED';

      const deptLines = ['GS','DP','WD'].map((d) => `<span>${d} ${current[d]}/${expected[d]}</span>`).join('');

      return `<button type="button" class="cs-platform-card ${selectedId === id ? 'is-selected' : ''}" data-platform-card="${escapeHtml(id)}" aria-pressed="${selectedId === id}">

        <div class="cs-platform-card-top"><span class="cs-platform-card-name">${escapeHtml(name)}</span><span class="cs-platform-card-status ${count ? '' : 'empty'}">${count ? 'HAS SEATING' : 'NO SEATING'}</span></div>

        <span class="cs-platform-card-id">${escapeHtml(platform.platformId || id)}</span>

        <div class="cs-platform-card-bottom"><span><span class="cs-platform-card-count">${count}</span><br><span class="cs-platform-card-label">seating record${count === 1 ? '' : 's'}</span></span><span class="cs-platform-card-label">${active ? 'Active platform' : 'Inactive platform'} →</span></div>

        <div class="cs-capacity-alert cs-capacity-${tone}">${alertText}<div class="cs-capacity-lines">${deptLines}</div><small>Seated / laptop allocation</small></div>

      </button>`;

    }).join('') : '<div class="cs-platform-loading">No sub-platforms match your search.</div>';

    host.querySelectorAll('[data-platform-card]').forEach((button) => button.addEventListener('click', () => {

      $('#cs-platform').value = button.dataset.platformCard;

      showAllSeatings = false;

      renderPlatformCards();

      renderRows();

      $('#cs-seating-table-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });

    }));

  }



  function renderTransferRequests(selectedDate, selectedShift) {

    const host = $('#cs-transfer-list');

    const count = $('#cs-transfer-count');

    const myEmployeeId = String(profile?.employeeId || profile?.employeeID || '');

    const myRole = String(profile?.role || '').toUpperCase();

    const pending = transferRequests.filter((r) => (r.businessDate || r.date) === selectedDate && r.shift === selectedShift);

    count.textContent = `${pending.length} pending`;

    if (!pending.length) {

      host.innerHTML = '<div class="cs-empty" style="padding:18px 0">No pending seating change requests for this date and shift.</div>';

      return;

    }

    host.innerHTML = pending.map((r) => {

      const assignedPic = picAssignments.some((a) =>

        String(a.platformId) === String(r.fromPlatformId)

        && String(a.date || a.businessDate) === String(r.businessDate || r.date)

        && String(a.shift).toUpperCase() === String(r.shift).toUpperCase()

        && String(a.picId || a.employeeId) === myEmployeeId

        && String(a.status || 'ACTIVE').toUpperCase() === 'ACTIVE'

      );

      const canReview = myRole === 'ADMIN' || assignedPic;

      return `<div class="cs-transfer-item">

        <div><strong>${escapeHtml(r.employeeName || r.employeeId)}</strong><div class="cs-transfer-meta">${escapeHtml(r.employeeId)} · ${escapeHtml(r.fromPlatformName || r.fromPlatformId || 'Previous platform')} → ${escapeHtml(r.toPlatformName || r.toPlatformId || 'New platform')} · ${escapeHtml(r.businessDate || r.date)} ${escapeHtml(r.shift)}</div><div class="cs-transfer-meta">Requested by ${escapeHtml(r.requestedByName || r.requestedBy || 'GS')}</div></div>

        <div class="cs-transfer-actions"><span class="cs-transfer-pill">PENDING PIC REVIEW</span>${canReview ? `<button type="button" class="button button-primary" data-transfer-approve="${escapeHtml(r.id)}">Approve transfer</button><button type="button" class="button button-outline" data-transfer-reject="${escapeHtml(r.id)}">Reject</button>` : ''}</div>

      </div>`;

    }).join('');

    host.querySelectorAll('[data-transfer-approve]').forEach((button) => button.addEventListener('click', () => decideTransfer(button.dataset.transferApprove, true)));

    host.querySelectorAll('[data-transfer-reject]').forEach((button) => button.addEventListener('click', () => decideTransfer(button.dataset.transferReject, false)));

  }



  async function decideTransfer(requestId, approve) {

    const request = transferRequests.find((r) => r.id === requestId);

    if (!request) return;

    const message = approve

      ? `Approve transfer of ${request.employeeName || request.employeeId} from ${request.fromPlatformName || request.fromPlatformId} to ${request.toPlatformName || request.toPlatformId}? The old seating will remain as TRANSFERRED history.`

      : `Reject the transfer request for ${request.employeeName || request.employeeId}?`;

    if (!window.confirm(message)) return;

    try {

      const batch = writeBatch(db);

      const requestRef = doc(db, 'seatingChangeRequests', requestId);

      if (approve) {

        const oldRef = doc(db, 'seatings', request.fromSeatingId);

        const newId = `${request.businessDate || request.date}_${request.shift}_${request.employeeId}_${Date.now()}`.replace(/[\/.#$\[\]]/g, '_');

        const newRef = doc(db, 'seatings', newId);

        batch.update(oldRef, { status: 'TRANSFERRED', transferredAt: serverTimestamp(), transferredToPlatformId: request.toPlatformId, transferredByRequestId: requestId, updatedAt: serverTimestamp() });

        const historyRef = doc(collection(db, 'seatingHistory'));

        batch.set(historyRef, {

          action: 'TRANSFERRED', actionType: 'SEATING_TRANSFER', transferRequestId: requestId,

          seatingId: request.fromSeatingId, employeeId: request.employeeId, employeeName: request.employeeName,

          businessDate: request.businessDate || request.date, shift: request.shift,

          fromPlatformId: request.fromPlatformId, fromPlatformName: request.fromPlatformName,

          toPlatformId: request.toPlatformId, toPlatformName: request.toPlatformName,

          fromLaptopName: request.fromLaptopName || '', toLaptopName: request.toLaptopName || '',

          changedBy: profile?.employeeId || profile?.name || 'UNKNOWN',

          changedAt: serverTimestamp(), status: 'TRANSFERRED'

        });

        batch.set(newRef, {

          seatingId: newId, businessDate: request.businessDate || request.date, date: request.businessDate || request.date,

          shift: request.shift, employeeId: request.employeeId, employeeName: request.employeeName, department: request.department,

          platformId: request.toPlatformId, platformName: request.toPlatformName, laptopName: request.toLaptopName,

          handledAccount: request.handledAccount || '', handledAccounts: request.handledAccounts || [],

          withdrawalWorks: request.withdrawalWorks || [], withdrawalWork: request.withdrawalWork || 'NOT_APPLICABLE',

          status: 'PENDING', createdBy: request.requestedBy || 'TRANSFER_REQUEST', createdByName: request.requestedByName || '',

          createdByRole: 'TRANSFER_REQUEST', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),

          approvedBy: null, approvedAt: null, changeCount: 0, transferredFromSeatingId: request.fromSeatingId, transferRequestId: requestId

        });

      }

      batch.update(requestRef, {

        status: approve ? 'APPROVED' : 'REJECTED',

        reviewedBy: profile?.employeeId || profile?.name || 'UNKNOWN',

        reviewedAt: serverTimestamp(), updatedAt: serverTimestamp()

      });

      await batch.commit();

      await load();

    } catch (error) {

      showError(`Could not ${approve ? 'approve' : 'reject'} transfer: ${friendlyError(error)}. Check Firestore rules for seatingChangeRequests and seating transfer writes.`);

    }

  }



  function renderRows() {

    const search = $('#cs-search').value.trim().toLowerCase();

    const department = $('#cs-department').value;

    const platformId = $('#cs-platform').value;



    if (!platformId && !search && !department && !showAllSeatings) {

      $('#cs-result-count').textContent = 'Select a sub-platform';

      $('#cs-rows').innerHTML = `<tr><td colspan="${canManage ? 9 : 8}" class="cs-empty">Choose a main category above, then click a sub-platform to view its seating records. Use “Show all platforms” to view every record.</td></tr>`;

      renderPlatformCards();

      return;

    }



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

      const isTransferred = String(row.status || '').toUpperCase() === 'TRANSFERRED';

      const removedValue = row.transferredAt?.toDate ? row.transferredAt.toDate() : (row.updatedAt?.toDate ? row.updatedAt.toDate() : null);

      const removedAt = isTransferred ? (removedValue ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', dateStyle: 'medium', timeStyle: 'medium' }).format(removedValue) : 'Time recorded in transfer history') : '';

      const actions = canManage && !isTransferred ? `<td class="cs-actions"><button type="button" class="button button-outline cs-edit" data-id="${escapeHtml(row.id)}">Edit</button> <button type="button" class="button button-outline cs-delete" data-id="${escapeHtml(row.id)}">Delete</button></td>` : (canManage ? '<td>—</td>' : '');

      return `<tr>

        <td>${escapeHtml(row.employeeId || employee.employeeId || '—')}</td>

        <td>${escapeHtml(row.employeeName || employee.name || 'Name unavailable')}</td>

        <td>${escapeHtml(department || '—')}</td>

        <td>${escapeHtml(row.platformName || row.platformId || '—')}</td>

        <td>${escapeHtml(workstation)}</td>

        <td class="cs-detail-cell">${escapeHtml(details)}</td>

        <td>${escapeHtml(row.shift || '—')}</td>

        <td>${statusPill(row.status)}${isTransferred ? `<div style="margin-top:5px;font-size:11px;color:var(--muted,#718096)">Removed: ${escapeHtml(removedAt)}<br>Moved to: ${escapeHtml(row.transferredToPlatformName || row.transferredToPlatformId || 'New platform')}</div>` : ''}</td>

        ${actions}

      </tr>`;

    }).join('') : `<tr><td colspan="${canManage ? 9 : 8}" class="cs-empty">No seating records match these filters.</td></tr>`;



    if (canManage) {

      $('#cs-rows').querySelectorAll('.cs-edit').forEach((button) => button.addEventListener('click', () => editSeating(button.dataset.id)));

      $('#cs-rows').querySelectorAll('.cs-delete').forEach((button) => button.addEventListener('click', () => removeSeating(button.dataset.id)));

    }

    renderPlatformCards();

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

      try {

        const [requestSnap, picAssignmentSnap] = await Promise.all([

          getDocs(query(collection(db, 'seatingChangeRequests'), where('status', '==', 'PENDING'), limit(500))),

          getDocs(query(collection(db, 'picAssignments'), limit(500)))

        ]);

        transferRequests = requestSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))

          .filter((r) => (r.businessDate || r.date) === selectedDate && r.shift === selectedShift);

        picAssignments = picAssignmentSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

      } catch (requestError) {

        transferRequests = [];

        picAssignments = [];

        $('#cs-transfer-list').innerHTML = '<div class="cs-empty" style="padding:18px 0">Transfer requests are unavailable until Firestore rules allow authorized request reads.</div>';

        $('#cs-transfer-count').textContent = 'Unavailable';

      }

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



      renderTransferRequests(selectedDate, selectedShift);

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



  $('#cs-back-categories').addEventListener('click', () => {

    activeCategory = null;

    showAllSeatings = false;

    $('#cs-platform').value = '';

    renderPlatformCards();

    renderRows();

  });

  $('#cs-show-all').addEventListener('click', () => {

    activeCategory = null;

    showAllSeatings = true;

    $('#cs-platform').value = '';

    renderPlatformCards();

    renderRows();

    $('#cs-seating-table-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });

  });



  ['cs-search', 'cs-department', 'cs-platform'].forEach((id) => {

    $(`#${id}`).addEventListener(id === 'cs-search' ? 'input' : 'change', () => {

      if (id === 'cs-platform' && $('#cs-platform').value) showAllSeatings = false;

      renderRows();

    });

  });

  $('#cs-date').addEventListener('change', load);

  $('#cs-shift').addEventListener('change', load);

  $('#cs-refresh').addEventListener('click', load);

  await load();

}
