import {
  collection, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, addDoc
} from 'firebase/firestore';
import { db } from './firebase.js';
import { friendlyError } from './auth.js';

const DEFAULT_GENERAL = { systemName: 'Seating Control Center', companyName: '', timezone: 'Asia/Colombo', dateFormat: 'YYYY-MM-DD' };
const DEFAULT_SHIFTS = { morningStart: '07:30', morningEnd: '19:30', nightStart: '19:30', nightEnd: '07:30', departments: ['DP', 'WD', 'GS'] };
const DEFAULT_APPROVALS = {
  requirePicApproval: true,
  allowPicSelfApproval: false,
  requireReturnReason: true,
  requireChangeReason: true,
  autoLockApproved: false,
  pendingReminderMinutes: 30
};
const esc = (v = '') => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const field = (label, name, value, type = 'text') => `<label class="sc-setting-field"><span>${label}</span><input name="${name}" type="${type}" value="${esc(value)}"></label>`;
const check = (label, name, checked) => `<label class="sc-check"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''}><span>${label}</span></label>`;

export async function renderSettingsPage(root, profile) {
  if (String(profile?.role || '').toUpperCase() !== 'ADMIN') {
    root.innerHTML = '<section class="sc-settings"><h2>Access denied</h2><p>Settings are available to administrators only.</p></section>';
    return;
  }

  root.innerHTML = `
  <section class="sc-settings">
    <style>
      .sc-settings{color:#172b46;max-width:1220px;margin:0 auto;font:inherit;padding:8px 0 24px}.sc-settings *{box-sizing:border-box}.sc-settings .sc-head{margin-bottom:22px}.sc-settings h2{font-size:26px;line-height:1.25;color:#172b46;margin:0 0 7px;font-weight:750}.sc-settings .sc-muted,.sc-settings .sc-desc,.sc-settings .sc-note{color:#64748b;font-size:12px;line-height:1.6}.sc-settings .sc-muted{font-size:13px;margin:0}.sc-settings .sc-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.sc-settings .sc-card{border:1px solid #dce5f0;background:#fff;border-radius:14px;padding:22px;min-width:0;box-shadow:0 5px 18px #172b460a}.sc-settings .sc-card h3{font-size:16px;color:#172b46;margin:0 0 5px;font-weight:750}.sc-settings .sc-desc{margin:0 0 18px}.sc-settings .sc-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.sc-settings .sc-setting-field{display:flex;flex-direction:column;gap:7px;font-size:12px;color:#475569;font-weight:600}.sc-settings input:not([type=checkbox]),.sc-settings select{width:100%;min-width:0;background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;padding:11px;color:#172b46;font:inherit;font-size:13px;outline:none;min-height:42px}.sc-settings input:focus,.sc-settings select:focus{border-color:#5c9dff;box-shadow:0 0 0 2px #5c9dff22}.sc-settings .sc-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}.sc-settings button{border:1px solid #cbd5e1;border-radius:8px;padding:10px 15px;font-weight:600;cursor:pointer;background:#fff;color:#172b46}.sc-settings button.sc-primary{background:#2563eb;border-color:#2563eb;color:#fff}.sc-settings button:disabled{opacity:.55;cursor:wait}.sc-settings .sc-status{font-size:12px;margin-top:12px;min-height:18px}.sc-settings .sc-status.error{color:#dc2626}.sc-settings .sc-status.ok{color:#15803d}.sc-settings .sc-departments{grid-column:1/-1}.sc-settings .sc-footer{margin-top:18px;font-size:12px;color:#64748b}.sc-settings code{background:#eaf0f7;color:#334155;padding:2px 5px;border-radius:4px}.sc-settings .sc-wide{margin-top:18px}.sc-settings .sc-checks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.sc-settings .sc-check{display:flex;align-items:flex-start;gap:9px;color:#334155;font-size:13px;line-height:1.45}.sc-settings .sc-check input{margin-top:2px;accent-color:#2563eb}.sc-settings .sc-chip{display:inline-flex;border-radius:99px;padding:4px 8px;font-size:11px;font-weight:700;background:#eff6ff;color:#1d4ed8}.sc-settings .sc-health-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.sc-settings .sc-health{border:1px solid #e2e8f0;border-radius:10px;padding:12px;min-width:0}.sc-settings .sc-health strong{display:block;font-size:13px;margin-bottom:7px}.sc-settings .sc-health span{font-size:12px;color:#64748b;overflow-wrap:anywhere}.sc-settings .sc-table-wrap{overflow:auto}.sc-settings table{border-collapse:collapse;width:100%;font-size:12px}.sc-settings th,.sc-settings td{text-align:left;padding:10px;border-bottom:1px solid #e2e8f0;vertical-align:top}.sc-settings th{color:#64748b;font-weight:700;background:#f8fafc}.sc-settings .sc-empty{padding:14px;color:#64748b;font-size:12px}.sc-settings .sc-role-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.sc-settings .sc-role{border:1px solid #e2e8f0;border-radius:9px;padding:11px}.sc-settings .sc-role strong{font-size:12px}.sc-settings .sc-role p{font-size:12px;color:#64748b;line-height:1.5;margin:5px 0 0}.sc-settings .sc-note{margin-top:12px}.sc-settings .sc-actions .sc-primary{color:white}
      @media(max-width:900px){.sc-settings .sc-grid{grid-template-columns:1fr}.sc-settings .sc-health-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){.sc-settings .sc-fields,.sc-settings .sc-checks,.sc-settings .sc-role-list,.sc-settings .sc-health-grid{grid-template-columns:1fr}.sc-settings .sc-card{padding:16px}.sc-settings .sc-actions button{width:100%}}
    </style>
    <div class="sc-head"><h2>Settings</h2><p class="sc-muted">Manage organization details, operational rules, approvals, security visibility, and system health.</p></div>
    <div class="sc-grid">
      <form class="sc-card" id="sc-general-form"><h3>1. General Settings</h3><p class="sc-desc">Basic identity and display preferences for the workspace.</p><div class="sc-fields">
        ${field('System name','systemName',DEFAULT_GENERAL.systemName)}${field('Company / organization','companyName',DEFAULT_GENERAL.companyName)}
        <label class="sc-setting-field"><span>Timezone</span><select name="timezone"><option value="Asia/Colombo">Asia/Colombo (Sri Lanka)</option><option value="UTC">UTC</option></select></label>
        <label class="sc-setting-field"><span>Date format</span><select name="dateFormat"><option value="YYYY-MM-DD">YYYY-MM-DD</option><option value="DD/MM/YYYY">DD/MM/YYYY</option><option value="MM/DD/YYYY">MM/DD/YYYY</option></select></label>
      </div><div class="sc-actions"><button class="sc-primary" type="submit">Save General Settings</button></div><div class="sc-status" id="sc-general-status" role="status"></div></form>
      <form class="sc-card" id="sc-shifts-form"><h3>2. Shift & Operational Rules</h3><p class="sc-desc">Configure shift times and department codes.</p><div class="sc-fields">
        ${field('Morning shift starts','morningStart',DEFAULT_SHIFTS.morningStart,'time')}${field('Morning shift ends','morningEnd',DEFAULT_SHIFTS.morningEnd,'time')}${field('Night shift starts','nightStart',DEFAULT_SHIFTS.nightStart,'time')}${field('Night shift ends','nightEnd',DEFAULT_SHIFTS.nightEnd,'time')}
        <label class="sc-setting-field sc-departments"><span>Department codes (comma-separated)</span><input name="departments" value="DP, WD, GS" placeholder="DP, WD, GS"></label>
      </div><p class="sc-note">Shift logic changes only on pages that read these settings.</p><div class="sc-actions"><button class="sc-primary" type="submit">Save Shift Settings</button></div><div class="sc-status" id="sc-shifts-status" role="status"></div></form>
    </div>

    <form class="sc-card sc-wide" id="sc-approvals-form"><h3>3. Approval Configuration</h3><p class="sc-desc">Set operational review preferences. These values are saved as configuration; pages must enforce them before they change workflow behaviour.</p>
      <div class="sc-checks">${check('Require PIC approval for new seating','requirePicApproval',DEFAULT_APPROVALS.requirePicApproval)}${check('Allow PIC to approve their own seating','allowPicSelfApproval',DEFAULT_APPROVALS.allowPicSelfApproval)}${check('Require a reason when returning seating','requireReturnReason',DEFAULT_APPROVALS.requireReturnReason)}${check('Require a reason for seating changes','requireChangeReason',DEFAULT_APPROVALS.requireChangeReason)}${check('Automatically lock seating after approval','autoLockApproved',DEFAULT_APPROVALS.autoLockApproved)}</div>
      <div class="sc-fields" style="margin-top:16px;max-width:420px">${field('Pending approval reminder threshold (minutes)','pendingReminderMinutes',DEFAULT_APPROVALS.pendingReminderMinutes,'number')}</div>
      <div class="sc-actions"><button class="sc-primary" type="submit">Save Approval Configuration</button></div><div class="sc-status" id="sc-approvals-status" role="status"></div>
    </form>

    <section class="sc-card sc-wide"><h3>4. Security & Audit</h3><p class="sc-desc">Role overview and recent configuration audit events. Role access must still be enforced by application checks and Firestore Security Rules.</p>
      <div class="sc-role-list">
        <div class="sc-role"><strong>ADMIN <span class="sc-chip">Full administration</span></strong><p>Manage system configuration, users, and operational setup.</p></div>
        <div class="sc-role"><strong>SPV <span class="sc-chip">Supervisor</span></strong><p>Operational monitoring and approved supervisor workflows.</p></div>
        <div class="sc-role"><strong>TL <span class="sc-chip">Team Lead</span></strong><p>Team operations, PIC oversight, and assigned operational pages.</p></div>
        <div class="sc-role"><strong>PIC <span class="sc-chip">Review</span></strong><p>Review seating and use authorized operational monitoring pages.</p></div>
        <div class="sc-role"><strong>STAFF <span class="sc-chip">Operations</span></strong><p>Use only the pages allowed for the employee's role and department.</p></div>
      </div>
      <div class="sc-actions"><button type="button" id="sc-refresh-audit">Refresh Audit Log</button></div>
      <div id="sc-audit-status" class="sc-status" role="status"></div><div id="sc-audit-list" class="sc-table-wrap"><div class="sc-empty">Loading audit events…</div></div>
      <p class="sc-note">Audit entries are best-effort client records, not tamper-proof evidence. For authoritative audit logs, writes should be performed by trusted server-side code.</p>
    </section>

    <section class="sc-card sc-wide"><h3>5. System Health</h3><p class="sc-desc">Run read-only checks against the Firestore collections used by this workspace.</p>
      <div class="sc-actions" style="margin-top:0;margin-bottom:14px"><button type="button" class="sc-primary" id="sc-run-health">Run Health Check</button></div>
      <div id="sc-health-status" class="sc-status" role="status">Not checked yet.</div><div id="sc-health-grid" class="sc-health-grid"><div class="sc-empty">Run a health check to inspect data access.</div></div>
    </section>
    <p class="sc-footer">Firestore configuration documents: <code>systemSettings/general</code>, <code>systemSettings/shifts</code>, and <code>systemSettings/approvals</code>. Audit collection: <code>systemSettingsAudit</code>.</p>
  </section>`;

  const $ = (s) => root.querySelector(s);
  const generalForm = $('#sc-general-form'), shiftsForm = $('#sc-shifts-form'), approvalsForm = $('#sc-approvals-form');
  const status = (id, message, kind = '') => { const el = $(`#${id}`); if (el) { el.textContent = message; el.className = `sc-status ${kind}`.trim(); } };
  const fill = (form, data) => Object.entries(data).forEach(([k,v]) => { const el=form.elements.namedItem(k); if (el) { if (el.type === 'checkbox') el.checked = Boolean(v); else el.value = Array.isArray(v) ? v.join(', ') : String(v ?? ''); } });
  const readGeneral = () => ({ systemName: generalForm.elements.systemName.value.trim() || DEFAULT_GENERAL.systemName, companyName: generalForm.elements.companyName.value.trim(), timezone: generalForm.elements.timezone.value, dateFormat: generalForm.elements.dateFormat.value });
  const readShifts = () => ({ morningStart: shiftsForm.elements.morningStart.value, morningEnd: shiftsForm.elements.morningEnd.value, nightStart: shiftsForm.elements.nightStart.value, nightEnd: shiftsForm.elements.nightEnd.value, departments: [...new Set(shiftsForm.elements.departments.value.split(',').map(v=>v.trim().toUpperCase()).filter(Boolean))] });
  const readApprovals = () => ({ requirePicApproval: approvalsForm.elements.requirePicApproval.checked, allowPicSelfApproval: approvalsForm.elements.allowPicSelfApproval.checked, requireReturnReason: approvalsForm.elements.requireReturnReason.checked, requireChangeReason: approvalsForm.elements.requireChangeReason.checked, autoLockApproved: approvalsForm.elements.autoLockApproved.checked, pendingReminderMinutes: Math.max(1, Math.min(1440, Number(approvalsForm.elements.pendingReminderMinutes.value) || DEFAULT_APPROVALS.pendingReminderMinutes)) });
  const actor = profile.uid || profile.id || null;

  async function audit(action, section, details) {
    try { await addDoc(collection(db, 'systemSettingsAudit'), { action, section, details, actorUid: actor, actorName: profile.name || profile.email || 'Administrator', actorRole: 'ADMIN', createdAt: serverTimestamp() }); return true; }
    catch { return false; }
  }
  async function saveDoc(form, docId, readData, statusId, section) {
    const button = form.querySelector('button[type="submit"]'); button.disabled = true; status(statusId, 'Saving…');
    try {
      const data = readData();
      if (docId === 'shifts' && (!data.morningStart || !data.morningEnd || !data.nightStart || !data.nightEnd || !data.departments.length)) throw new Error('Enter all shift times and at least one department code.');
      if (docId === 'approvals' && (data.pendingReminderMinutes < 1 || data.pendingReminderMinutes > 1440)) throw new Error('Reminder threshold must be between 1 and 1440 minutes.');
      await setDoc(doc(db, 'systemSettings', docId), { ...data, updatedAt: serverTimestamp(), updatedBy: actor }, { merge: true });
      const logged = await audit('SETTINGS_UPDATED', section, `Updated ${section} configuration`);
      status(statusId, logged ? 'Settings saved successfully.' : 'Settings saved. Audit log could not be written; check Firestore rules for systemSettingsAudit.', logged ? 'ok' : 'error');
    } catch (e) { status(statusId, `Save failed: ${friendlyError(e) || e.message || 'Unknown error'}`, 'error'); }
    finally { button.disabled = false; }
  }

  try {
    const [g,s,a] = await Promise.all([getDoc(doc(db,'systemSettings','general')),getDoc(doc(db,'systemSettings','shifts')),getDoc(doc(db,'systemSettings','approvals'))]);
    fill(generalForm,{...DEFAULT_GENERAL,...(g.exists()?g.data():{})});
    fill(shiftsForm,{...DEFAULT_SHIFTS,...(s.exists()?s.data():{})});
    fill(approvalsForm,{...DEFAULT_APPROVALS,...(a.exists()?a.data():{})});
  } catch (e) { status('sc-general-status',`Could not load saved settings: ${friendlyError(e)}`,'error'); }

  generalForm.addEventListener('submit', e => { e.preventDefault(); saveDoc(generalForm,'general',readGeneral,'sc-general-status','General Settings'); });
  shiftsForm.addEventListener('submit', e => { e.preventDefault(); saveDoc(shiftsForm,'shifts',readShifts,'sc-shifts-status','Shift & Operational Rules'); });
  approvalsForm.addEventListener('submit', e => { e.preventDefault(); saveDoc(approvalsForm,'approvals',readApprovals,'sc-approvals-status','Approval Configuration'); });

  async function loadAudit() {
    status('sc-audit-status','Loading audit log…');
    try {
      const snap = await getDocs(query(collection(db,'systemSettingsAudit'),orderBy('createdAt','desc'),limit(25)));
      if (!snap.size) { $('#sc-audit-list').innerHTML = '<div class="sc-empty">No audit events found yet. Saving a settings section creates an event if rules allow it.</div>'; status('sc-audit-status','Audit log loaded.','ok'); return; }
      $('#sc-audit-list').innerHTML = `<table><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Section / details</th></tr></thead><tbody>${snap.docs.map(d=>{const x=d.data();const dt=x.createdAt?.toDate ? x.createdAt.toDate().toLocaleString('en-GB',{timeZone:'Asia/Colombo'}) : 'Pending timestamp';return `<tr><td>${esc(dt)}</td><td>${esc(x.actorName||x.actorUid||'Unknown')}<br>${esc(x.actorRole||'')}</td><td>${esc(x.action||'')}</td><td>${esc(x.section||'')}<br>${esc(x.details||'')}</td></tr>`;}).join('')}</tbody></table>`;
      status('sc-audit-status',`Loaded ${snap.size} recent event(s).`,'ok');
    } catch(e) { $('#sc-audit-list').innerHTML='<div class="sc-empty">Audit log is unavailable. Check read permission for systemSettingsAudit.</div>'; status('sc-audit-status',friendlyError(e),'error'); }
  }
  $('#sc-refresh-audit').addEventListener('click',loadAudit);

  async function healthCheck() {
    const btn=$('#sc-run-health'); btn.disabled=true; status('sc-health-status','Checking Firestore access…');
    const checks=[['General settings',()=>getDoc(doc(db,'systemSettings','general'))],['Shift settings',()=>getDoc(doc(db,'systemSettings','shifts'))],['Approval settings',()=>getDoc(doc(db,'systemSettings','approvals'))],['Platforms',()=>getDocs(query(collection(db,'platforms'),limit(1)))],['Employees',()=>getDocs(query(collection(db,'employees'),limit(1)))],['Seatings',()=>getDocs(query(collection(db,'seatings'),limit(1)))]];
    const results=await Promise.all(checks.map(async ([name,run])=>{try{const snap=await run();return {name,ok:true,detail:snap.exists ? 'Document readable' : snap.size !== undefined ? `${snap.size} record(s) in sample` : 'Document accessible (not created yet)'};}catch(e){return {name,ok:false,detail:friendlyError(e)||e.message||'Access failed'};}}));
    $('#sc-health-grid').innerHTML=results.map(r=>`<div class="sc-health"><strong>${esc(r.name)} <span class="sc-chip" style="background:${r.ok?'#dcfce7':'#fee2e2'};color:${r.ok?'#166534':'#991b1b'}">${r.ok?'OK':'ERROR'}</span></strong><span>${esc(r.detail)}</span></div>`).join('');
    const failed=results.filter(r=>!r.ok).length; status('sc-health-status',failed?`${failed} of ${results.length} checks failed. Review Firestore rules and project configuration.`:`All ${results.length} read checks passed. This is a read-only client check, not a full security audit.`,failed?'error':'ok'); btn.disabled=false;
  }
  $('#sc-run-health').addEventListener('click',healthCheck);
  await Promise.all([loadAudit(),healthCheck()]);
}
