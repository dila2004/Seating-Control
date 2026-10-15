import './users.css';
import { initializeApp, deleteApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword, getAuth, sendPasswordResetEmail
} from 'firebase/auth';
import {
  collection, getDocs, query, orderBy, limit, setDoc, doc, serverTimestamp, updateDoc
} from 'firebase/firestore';
import { app, auth, db } from './firebase.js';
import { friendlyError } from './auth.js';

const ROLES = ['STAFF', 'PIC', 'TL', 'SPV', 'ADMIN'];
const INTERNAL_EMAIL_DOMAIN = '@users.seating-control.local';
const normalizeEmployeeId = (value) => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
const internalEmailForEmployee = (employeeId) => `${normalizeEmployeeId(employeeId)}${INTERNAL_EMAIL_DOMAIN}`;
const isInternalEmail = (email) => String(email ?? '').toLowerCase().endsWith(INTERNAL_EMAIL_DOMAIN);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[c]);

export async function renderUsersPage(root, currentUser, currentProfile) {
  if (currentProfile?.role !== 'ADMIN' || currentProfile?.status !== 'ACTIVE') {
    root.innerHTML = '<section class="users-access-denied"><h2>Administrator access required</h2><p>Only an active administrator can open User Management.</p></section>';
    return;
  }

  root.innerHTML = `
    <section class="users-page">
      <header class="users-page-heading">
        <div><div class="users-eyebrow"><span></span> ADMINISTRATION / ACCESS CONTROL</div><h1>User Management</h1><p>Create accounts, assign roles, control access and send password-reset emails.</p></div>
        <div class="users-heading-mark" aria-hidden="true">＋</div>
      </header>
      <div class="users-summary">
        <article class="users-summary-card"><span class="users-summary-icon users-icon-blue">U</span><div><small>Total profiles</small><strong id="users-total-stat">—</strong></div></article>
        <article class="users-summary-card"><span class="users-summary-icon users-icon-green">✓</span><div><small>Active accounts</small><strong id="users-active-stat">—</strong></div></article>
        <article class="users-summary-card"><span class="users-summary-icon users-icon-violet">R</span><div><small>Access roles</small><strong>5</strong></div></article>
      </div>
      <section class="users-panel users-create-panel">
        <div class="users-panel-heading"><div class="users-panel-title-icon">＋</div><div><h2>Add a user</h2><p>Create a Firebase login and its matching Firestore profile.</p></div><span class="users-admin-chip">ADMIN ONLY</span></div>
        <div id="users-message" class="users-message" role="status" hidden></div>
        <form id="create-user-form" class="users-form">
          <div class="users-field"><label for="new-name">Full name <span>*</span></label><input id="new-name" name="name" required maxlength="100" autocomplete="name" placeholder="Enter employee full name" /></div>
          <div class="users-field" id="new-email-field" hidden><label for="new-email">Work email <span>*</span></label><input id="new-email" name="email" type="email" autocomplete="off" placeholder="name@company.com" /><small>Required only for Admin accounts.</small></div>
          <div class="users-field"><label for="new-password">Temporary password <span>*</span></label><input id="new-password" name="password" type="password" required minlength="6" autocomplete="new-password" placeholder="At least 6 characters" /><small>Minimum 6 characters.</small></div>
          <div class="users-field"><label for="new-employee-id">Employee ID <span>*</span></label><input id="new-employee-id" name="employeeId" required maxlength="60" placeholder="e.g. EMP001" /></div>
          <div class="users-field"><label for="new-role">Access role <span>*</span></label><select id="new-role" name="role" required>${ROLES.map((r) => `<option value="${r}">${r}</option>`).join('')}</select></div>
          <div class="users-field"><label for="new-platforms">Allowed platform IDs <span class="users-optional">(optional)</span></label><input id="new-platforms" name="allowedPlatforms" placeholder="e.g. jax-1, iris-7" /><small>Platform document IDs separated by commas.</small></div>
          <div class="users-form-footer"><div class="users-form-note"><span>i</span><p>New accounts are created as <strong>ACTIVE</strong>. Share temporary passwords securely.</p></div><button id="create-user-button" class="users-primary-button" type="submit">＋ Create user</button></div>
        </form>
      </section>
      <section class="users-panel users-directory-panel">
        <div class="users-directory-heading"><div><h2>User directory</h2><p>Edit profile access or send a password-reset email.</p></div><button id="users-refresh" class="users-secondary-button" type="button">↻ Refresh</button></div>
        <div class="users-toolbar">
          <label class="users-searchbox" for="users-search"><span>⌕</span><input id="users-search" type="search" placeholder="Search name, email, employee ID…" aria-label="Search users" /></label>
          <select id="users-role-filter" aria-label="Filter by role"><option value="">All roles</option>${ROLES.map((r) => `<option value="${r}">${r}</option>`).join('')}</select>
          <select id="users-status-filter" aria-label="Filter by status"><option value="">All statuses</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select>
        </div>
        <div class="users-table-meta"><span id="users-count">Loading users…</span><span>Maximum 500 profiles</span></div>
        <div class="users-table-wrap"><table class="users-table"><thead><tr><th>User</th><th>Employee ID</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead><tbody id="users-table-body"><tr><td colspan="5"><div class="users-loading">Loading users…</div></td></tr></tbody></table></div>
        <div class="users-directory-foot"><span class="users-foot-dot"></span> Passwords are never displayed or stored in this page.</div>
      </section>
      <div id="users-edit-modal" class="users-modal-backdrop" hidden>
        <section class="users-modal" role="dialog" aria-modal="true" aria-labelledby="users-edit-title">
          <div class="users-modal-heading"><div><div class="users-eyebrow">USER PROFILE</div><h2 id="users-edit-title">Edit user access</h2></div><button type="button" id="users-edit-close" class="users-modal-close" aria-label="Close">×</button></div>
          <div id="users-edit-message" class="users-message" hidden></div>
          <form id="users-edit-form" class="users-edit-form">
            <input id="edit-uid" type="hidden" />
            <div class="users-field"><label for="edit-name">Full name</label><input id="edit-name" required maxlength="100" /></div>
            <div class="users-field"><label for="edit-employee-id">Employee ID</label><input id="edit-employee-id" required maxlength="60" /></div>
            <div class="users-field"><label for="edit-role">Role</label><select id="edit-role" required>${ROLES.map((r) => `<option value="${r}">${r}</option>`).join('')}</select></div>
            <div class="users-field"><label for="edit-status">Account status</label><select id="edit-status"><option value="ACTIVE">ACTIVE</option><option value="INACTIVE">INACTIVE</option></select></div>
            <div class="users-field users-field-wide"><label for="edit-platforms">Allowed platform IDs</label><input id="edit-platforms" placeholder="jax-1, iris-7" /></div>
            <div class="users-modal-actions"><button type="button" id="users-edit-cancel" class="users-secondary-button">Cancel</button><button type="submit" id="users-save-edit" class="users-primary-button">Save changes</button></div>
          </form>
        </section>
      </div>
    </section>`;

  const message = root.querySelector('#users-message');
  const form = root.querySelector('#create-user-form');
  const createButton = root.querySelector('#create-user-button');
  const roleSelect = root.querySelector('#new-role');
  const emailField = root.querySelector('#new-email-field');
  const emailInput = root.querySelector('#new-email');
  function syncEmailField() {
    const isAdmin = roleSelect.value === 'ADMIN';
    emailField.hidden = !isAdmin;
    emailField.style.display = isAdmin ? '' : 'none';
    emailInput.required = isAdmin;
    emailInput.disabled = !isAdmin;
    if (!isAdmin) emailInput.value = '';
  }
  roleSelect.addEventListener('change', syncEmailField);
  syncEmailField();
  const modal = root.querySelector('#users-edit-modal');
  let users = [];

  function showMessage(el, text, isError = false) {
    el.textContent = text;
    el.hidden = false;
    el.classList.toggle('is-error', isError);
    el.classList.toggle('is-success', !isError);
    el.setAttribute('role', isError ? 'alert' : 'status');
  }

  function renderRows() {
    const search = root.querySelector('#users-search').value.trim().toLowerCase();
    const role = root.querySelector('#users-role-filter').value;
    const status = root.querySelector('#users-status-filter').value;
    const filtered = users.filter((u) => {
      const haystack = [u.name, u.email, u.employeeId, u.uid].join(' ').toLowerCase();
      return (!search || haystack.includes(search)) && (!role || u.role === role) && (!status || u.status === status);
    });
    root.querySelector('#users-total-stat').textContent = String(users.length);
    root.querySelector('#users-active-stat').textContent = String(users.filter((u) => u.status === 'ACTIVE').length);
    root.querySelector('#users-count').textContent = `${filtered.length} result${filtered.length === 1 ? '' : 's'} · ${users.length} total`;
    root.querySelector('#users-table-body').innerHTML = filtered.length ? filtered.map((u) => {
      const name = u.name || 'Unnamed user';
      const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase();
      return `<tr>
        <td><div class="users-person-cell"><span class="users-avatar">${esc(initials || 'U')}</span><span class="users-person-info"><strong>${esc(name)}</strong><small>${esc(isInternalEmail(u.email) ? 'Employee ID login' : (u.email || 'No email recorded'))}</small></span></div></td>
        <td><span class="users-employee-id">${esc(u.employeeId || '—')}</span></td>
        <td><span class="users-role-pill role-${esc(String(u.role || '').toLowerCase())}">${esc(u.role || 'UNSET')}</span></td>
        <td><span class="users-status-pill ${u.status === 'ACTIVE' ? 'status-active' : 'status-inactive'}"><span></span>${esc(u.status || 'UNSET')}</span></td>
        <td><div class="users-row-actions"><button type="button" class="users-action-button" data-edit-user="${esc(u.uid)}">Edit</button><button type="button" class="users-action-button action-reset" data-reset-user="${esc(u.uid)}">Reset password</button></div></td>
      </tr>`;
    }).join('') : '<tr><td colspan="5"><div class="users-empty-state"><strong>No matching users</strong><p>Try another search or change the filters.</p></div></td></tr>';
  }

  async function loadUsers() {
    const refreshButton = root.querySelector('#users-refresh');
    refreshButton.disabled = true;
    try {
      const snap = await getDocs(query(collection(db, 'users'), orderBy('name'), limit(500)));
      users = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
      renderRows();
    } catch (error) {
      root.querySelector('#users-count').textContent = `Could not load users: ${friendlyError(error)}`;
      root.querySelector('#users-table-body').innerHTML = `<tr><td colspan="5"><div class="users-empty-state users-error-state"><strong>Unable to load user directory</strong><p>${esc(friendlyError(error))}</p></div></td></tr>`;
    } finally {
      refreshButton.disabled = false;
    }
  }

  function openEdit(uid) {
    const target = users.find((u) => u.uid === uid);
    if (!target) return;
    root.querySelector('#users-edit-message').hidden = true;
    root.querySelector('#edit-uid').value = target.uid;
    root.querySelector('#edit-name').value = target.name || '';
    root.querySelector('#edit-employee-id').value = target.employeeId || '';
    root.querySelector('#edit-role').value = ROLES.includes(target.role) ? target.role : 'STAFF';
    root.querySelector('#edit-status').value = target.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
    root.querySelector('#edit-platforms').value = Array.isArray(target.allowedPlatforms) ? target.allowedPlatforms.join(', ') : '';
    modal.hidden = false;
  }
  function closeEdit() { modal.hidden = true; }

  root.querySelector('#users-table-body').addEventListener('click', async (event) => {
    const editButton = event.target.closest('[data-edit-user]');
    if (editButton) { openEdit(editButton.dataset.editUser); return; }
    const resetButton = event.target.closest('[data-reset-user]');
    if (resetButton) {
      const target = users.find((u) => u.uid === resetButton.dataset.resetUser);
      if (!target?.email) { showMessage(message, 'This user has no email address recorded.', true); return; }
      if (isInternalEmail(target.email)) { showMessage(message, 'This account uses Employee ID login and has no deliverable email. Use your approved Admin-assisted password reset process.', true); return; }
      if (!confirm(`Send a password-reset email to ${target.email}?`)) return;
      resetButton.disabled = true;
      try {
        await sendPasswordResetEmail(auth, target.email);
        showMessage(message, `Password-reset email sent to ${target.email}.`);
      } catch (error) {
        showMessage(message, `Could not send reset email: ${friendlyError(error)}`, true);
      } finally { resetButton.disabled = false; }
    }
  });

  root.querySelector('#users-edit-close').addEventListener('click', closeEdit);
  root.querySelector('#users-edit-cancel').addEventListener('click', closeEdit);
  modal.addEventListener('click', (event) => { if (event.target === modal) closeEdit(); });

  root.querySelector('#users-edit-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const uid = root.querySelector('#edit-uid').value;
    const target = users.find((u) => u.uid === uid);
    if (!target) return;
    if (uid === currentUser.uid && root.querySelector('#edit-status').value !== 'ACTIVE') {
      showMessage(root.querySelector('#users-edit-message'), 'You cannot deactivate your own current Admin account.', true);
      return;
    }
    if (uid === currentUser.uid && root.querySelector('#edit-role').value !== 'ADMIN') {
      showMessage(root.querySelector('#users-edit-message'), 'You cannot remove your own ADMIN role while signed in.', true);
      return;
    }
    const saveButton = root.querySelector('#users-save-edit');
    saveButton.disabled = true;
    saveButton.textContent = 'Saving…';
    try {
      await updateDoc(doc(db, 'users', uid), {
        name: root.querySelector('#edit-name').value.trim(),
        employeeId: root.querySelector('#edit-employee-id').value.trim(),
        role: root.querySelector('#edit-role').value,
        status: root.querySelector('#edit-status').value,
        allowedPlatforms: root.querySelector('#edit-platforms').value.split(',').map((s) => s.trim()).filter(Boolean),
        updatedAt: serverTimestamp(),
        updatedBy: currentUser.uid
      });
      showMessage(message, `Updated ${target.email || target.name}.`);
      closeEdit();
      await loadUsers();
    } catch (error) {
      showMessage(root.querySelector('#users-edit-message'), `Update failed: ${friendlyError(error)}. Check that your deployed Firestore rules allow Admin profile updates.`, true);
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = 'Save changes';
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (currentProfile?.role !== 'ADMIN' || currentProfile?.status !== 'ACTIVE') {
      showMessage(message, 'Access denied. An active ADMIN profile is required.', true);
      return;
    }
    const name = root.querySelector('#new-name').value.trim();
    const enteredEmail = emailInput.value.trim();
    const password = root.querySelector('#new-password').value;
    const employeeId = root.querySelector('#new-employee-id').value.trim();
    const role = root.querySelector('#new-role').value;
    const allowedPlatforms = root.querySelector('#new-platforms').value.split(',').map((s) => s.trim()).filter(Boolean);
    const normalizedEmployeeId = normalizeEmployeeId(employeeId);
    const email = role === 'ADMIN' ? enteredEmail : internalEmailForEmployee(employeeId);
    if (!name || !normalizedEmployeeId || (role === 'ADMIN' && !enteredEmail) || password.length < 6 || !ROLES.includes(role)) {
      showMessage(message, 'Complete the required fields. Admin accounts need a valid work email; other users need an Employee ID. Password must be at least 6 characters.', true);
      return;
    }
    if (role !== 'ADMIN' && !normalizedEmployeeId) {
      showMessage(message, 'Employee ID must contain letters or numbers.', true);
      return;
    }
    createButton.disabled = true;
    createButton.textContent = 'Creating account…';
    let secondaryApp;
    try {
      secondaryApp = initializeApp(app.options, `user-creator-${Date.now()}`);
      const secondaryAuth = getAuth(secondaryApp);
      const credential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
      await setDoc(doc(db, 'users', credential.user.uid), {
        uid: credential.user.uid, name, email, employeeId: normalizedEmployeeId, role, status: 'ACTIVE',
        allowedPlatforms, createdAt: serverTimestamp(), createdBy: currentUser.uid
      });
      showMessage(message, `User ${email} created successfully. Share the temporary password securely.`);
      form.reset();
      syncEmailField();
      await loadUsers();
    } catch (error) {
      showMessage(message, `User creation failed: ${friendlyError(error)}. If Authentication created the account before the profile failed, check Firebase Console → Authentication for an orphan account.`, true);
    } finally {
      if (secondaryApp) await deleteApp(secondaryApp).catch(() => {});
      createButton.disabled = false;
      createButton.textContent = '＋ Create user';
    }
  });

  ['#users-search', '#users-role-filter', '#users-status-filter'].forEach((selector) => {
    const el = root.querySelector(selector);
    el.addEventListener('input', renderRows);
    el.addEventListener('change', renderRows);
  });
  root.querySelector('#users-refresh').addEventListener('click', loadUsers);
  await loadUsers();
}
