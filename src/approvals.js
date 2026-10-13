import { collection, doc, getDocs, limit, query, where, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase.js';
import { friendlyError } from './auth.js';
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function renderApprovalsPage(root, profile) {
  const role = String(profile?.role || '').toUpperCase();
  if (!['PIC','TL','SPV','ADMIN'].includes(role)) { root.innerHTML='<section class="panel" style="padding:24px">Access restricted.</section>'; return; }
  const localParts = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Colombo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date()).split(':').map(Number);
  const localMinutes = localParts[0]*60+localParts[1];
  const defaultShift = localMinutes >= 450 && localMinutes < 1170 ? 'MORNING' : 'NIGHT';
  root.innerHTML=`<style>
    .ap-filter-panel{display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap;padding:20px 22px}
    .ap-filter-field{display:flex;flex-direction:column;gap:7px;min-width:190px;color:var(--text,#10233f);font-size:13px;font-weight:600}
    .ap-filter-field span{color:var(--muted,#64748b);font-size:12px;font-weight:600;letter-spacing:.02em}
    .ap-filter-control{box-sizing:border-box;width:100%;height:44px;border:1px solid #d7e0ee;border-radius:10px;background:#fff;color:#10233f;padding:0 12px;font:inherit;outline:none;transition:border-color .15s,box-shadow .15s}
    .ap-filter-control:focus{border-color:#3568e8;box-shadow:0 0 0 3px rgba(53,104,232,.12)}
    .ap-load-btn{height:44px;min-width:130px;border-radius:10px;white-space:nowrap}
    @media(max-width:640px){.ap-filter-panel{align-items:stretch;gap:12px;padding:16px}.ap-filter-field{min-width:100%;}.ap-load-btn{width:100%}}
  </style>
  <section style="display:flex;flex-direction:column;gap:18px">
    <div><div class="eyebrow">OPERATIONS / REVIEW</div><h1>Pending Approval</h1><p style="color:var(--muted)">Review pending seatings grouped by platform, date and shift. Approve a whole platform group at once.</p></div>
    <div id="ap-alert" class="alert hidden"></div>
    <div class="panel ap-filter-panel">
      <label class="ap-filter-field"><span>BUSINESS DATE</span><input class="ap-filter-control" id="ap-date" type="date" value="${new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Colombo'})}"></label>
      <label class="ap-filter-field"><span>SHIFT</span><select class="ap-filter-control" id="ap-shift"><option value="MORNING" ${defaultShift === 'MORNING' ? 'selected' : ''}>Morning · 07:30–19:30</option><option value="NIGHT" ${defaultShift === 'NIGHT' ? 'selected' : ''}>Night · 19:30–07:30</option></select></label>
      <button id="ap-refresh" class="button button-primary ap-load-btn"><span aria-hidden="true">↻</span> Load pending</button>
    </div>
    <div id="ap-groups" style="display:flex;flex-direction:column;gap:14px">Load pending records to begin.</div>
  </section>`;
  const alert=root.querySelector('#ap-alert'), groups=root.querySelector('#ap-groups');
  const message=(m,err=false)=>{alert.textContent=m;alert.classList.remove('hidden');alert.classList.toggle('alert-error',err);alert.classList.toggle('alert-success',!err)};
  async function load(){
    const button = root.querySelector('#ap-refresh');
    const date = root.querySelector('#ap-date').value;
    const shift = root.querySelector('#ap-shift').value;
    groups.innerHTML = '<div class="panel" style="padding:22px">Loading pending records…</div>';
    alert.classList.add('hidden');
    button.disabled = true;
    try {
      // Read seating records independently. Auxiliary collection permission errors
      // must not prevent pending records from being shown.
      const seatingSnap = await getDocs(query(collection(db,'seatings'), limit(1000)));
      const norm = v => String(v ?? '').trim().toUpperCase();
      const all = seatingSnap.docs.map(d => ({ id:d.id, ...d.data() }));
      const dateRows = all.filter(r => String(r.businessDate || r.date || '').slice(0,10) === date);
      const rows = dateRows.filter(r => norm(r.status) === 'PENDING' && norm(r.shift) === norm(shift));
      let pmap = new Map(), emap = new Map();
      try {
        const ps = await getDocs(query(collection(db,'platforms'),limit(500)));
        pmap = new Map(ps.docs.map(d => [d.id,{id:d.id,...d.data()}]));
      } catch (_) {}
      try {
        const es = await getDocs(query(collection(db,'employees'),limit(1000)));
        emap = new Map(es.docs.map(d => [d.id,{id:d.id,...d.data()}]));
      } catch (_) {}
      if (!rows.length) {
        groups.innerHTML = `<div class="panel" style="padding:22px"><strong>No matching pending records.</strong><p style="color:var(--muted);margin-bottom:0">Found ${dateRows.length} seating record(s) for ${esc(date)}. Pending status and shift must match the selected filters. Try the other shift or check the record's status/date.</p></div>`;
        return;
      }
      const grouped = new Map();
      for (const r of rows) {
        const key = String(r.platformId || r.platformName || 'unknown');
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(r);
      }
      groups.innerHTML = [...grouped].map(([pid,items]) => {
        const p = pmap.get(pid);
        const platformLabel = p?.name || p?.platformId || items[0]?.platformName || pid;
        return `<article class="panel" style="padding:18px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
            <div><h2 style="margin:0">${esc(platformLabel)}</h2><p style="color:var(--muted);margin:5px 0">${items.length} pending assignment(s) · ${esc(date)} · ${esc(shift)}</p></div>
            <div><button class="button button-primary" data-approve-platform="${esc(pid)}">Approve platform group</button> <button class="button" data-reject-platform="${esc(pid)}">Reject platform group</button></div>
          </div>
          <div style="overflow-x:auto;margin-top:14px"><table style="width:100%;min-width:780px;border-collapse:collapse;table-layout:fixed"><thead><tr>${['Employee','Department','Workstation','Accounts / work','Actions'].map((h,i)=>`<th style="text-align:left;padding:10px 8px;background:var(--surface,#f8fafc);font-size:12px;width:${[22,12,17,25,24][i]}%;border-bottom:1px solid var(--border,#dbe3ef)">${h}</th>`).join('')}</tr></thead><tbody>
          ${items.map(r=>{const e=emap.get(r.employeeDocId)||{};const work=(r.handledAccounts||[]).join(', ')||r.handledAccount||(r.withdrawalWorks||[]).join(', ')||r.withdrawalWork||'';return `<tr><td style="padding:10px 8px;border-bottom:1px solid var(--border,#e2e8f0);overflow-wrap:anywhere"><strong>${esc(r.employeeName||e.name||r.employeeId||'Unknown')}</strong><br><small>${esc(r.employeeId||'')}</small></td><td style="padding:10px 8px;border-bottom:1px solid var(--border,#e2e8f0)">${esc(r.department||e.department||'—')}</td><td style="padding:10px 8px;border-bottom:1px solid var(--border,#e2e8f0)">${esc(r.laptopName||r.workstation||'—')}</td><td style="padding:10px 8px;border-bottom:1px solid var(--border,#e2e8f0)">${norm(r.department||e.department)==='GS' ? '—' : esc(work||'—')}</td><td style="padding:10px 8px;border-bottom:1px solid var(--border,#e2e8f0)"><div style="display:flex;flex-wrap:wrap;gap:6px"><button class="button button-primary" data-approve="${esc(r.id)}">Approve</button><button class="button" data-reject="${esc(r.id)}">Reject</button></div></td></tr>`}).join('')}
          </tbody></table></div></article>`;
      }).join('');
      message(`Loaded ${rows.length} pending seating(s) across ${grouped.size} platform(s).`);
    } catch(e) {
      groups.innerHTML = '<div class="panel" style="padding:22px">Pending records could not be read from Firestore.</div>';
      message(`Load failed: ${friendlyError(e)}. Check the browser console and Firestore read rules for the seatings collection.`,true);
    } finally {
      button.disabled = false;
    }
  }
  root.querySelector('#ap-refresh').addEventListener('click',load);
  // Load automatically so the page never remains on the initial placeholder.
  load();
  groups.addEventListener('click',async ev=>{const b=ev.target.closest('button');if(!b)return;try{b.disabled=true;const batch=writeBatch(db);if(b.dataset.approvePlatform){const pid=b.dataset.approvePlatform;const snap=await getDocs(query(collection(db,'seatings'),where('businessDate','==',root.querySelector('#ap-date').value),where('shift','==',root.querySelector('#ap-shift').value),where('platformId','==',pid),where('status','==','PENDING'),limit(450)));snap.docs.forEach(d=>batch.update(d.ref,{status:'APPROVED',approvedBy:profile.employeeId||profile.name||'REVIEWER',approvedByRole:role,approvedAt:serverTimestamp(),updatedAt:serverTimestamp()}));await batch.commit();message(`Approved ${snap.size} pending seating(s) for this platform.`);await load();return}if(b.dataset.approve){batch.update(doc(db,'seatings',b.dataset.approve),{status:'APPROVED',approvedBy:profile.employeeId||profile.name||'REVIEWER',approvedByRole:role,approvedAt:serverTimestamp(),updatedAt:serverTimestamp()});await batch.commit();message('Seating approved.');await load();return}if(b.dataset.reject){const reason=prompt('Reason for rejecting this seating (optional):')||'';batch.update(doc(db,'seatings',b.dataset.reject),{status:'REJECTED',rejectedBy:profile.employeeId||profile.name||'REVIEWER',rejectedByRole:role,rejectedAt:serverTimestamp(),rejectionReason:reason,updatedAt:serverTimestamp()});await batch.commit();message('Seating rejected.');await load();return}if(b.dataset.rejectPlatform){const pid=b.dataset.rejectPlatform;const reason=prompt('Reason for rejecting this platform group (optional):')||'';const snap=await getDocs(query(collection(db,'seatings'),where('businessDate','==',root.querySelector('#ap-date').value),where('shift','==',root.querySelector('#ap-shift').value),where('platformId','==',pid),where('status','==','PENDING'),limit(450)));snap.docs.forEach(d=>batch.update(d.ref,{status:'REJECTED',rejectedBy:profile.employeeId||profile.name||'REVIEWER',rejectedByRole:role,rejectedAt:serverTimestamp(),rejectionReason:reason,updatedAt:serverTimestamp()}));await batch.commit();message(`Rejected ${snap.size} pending seating(s) for this platform.`);await load();return}}catch(e){message(`Action failed: ${friendlyError(e)}. Firestore Rules may not yet permit reviewer approval/editing.`,true)}finally{b.disabled=false}});
}
