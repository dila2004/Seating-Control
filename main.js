import './style.css';
import { firebaseConfigError } from './firebase.js';
import { login, watchAuth, friendlyError } from './auth.js';
import { renderDashboard } from './dashboard.js';

const root = document.querySelector('#app');
let stopWatching = null;

function renderLogin(message = '', emailValue = '') {
  root.innerHTML = `
    <main class="login-layout">
      <section class="login-visual">
        <div class="login-brand"><div class="brand-mark">SC</div><div><strong>Seating Control Center</strong><small>WORKPLACE OPERATIONS PLATFORM</small></div></div>
        <div class="visual-content"><div class="visual-kicker"><span class="health-dot"></span> OPERATIONS WORKSPACE</div><h1>Every seat.<br/><span>Under control.</span></h1><p>A centralized workspace for daily seating, platform validation, approvals, and operational visibility.</p><div class="visual-stat-row"><div><strong>18</strong><span>Platform-ready design</span></div><div><strong>05</strong><span>Access roles</span></div><div><strong>24/7</strong><span>Shift-aware workflow</span></div></div></div>
        <div class="visual-footer">SECURE WORKPLACE OPERATIONS <span>•</span> FIREBASE PLATFORM</div>
      </section>
      <section class="login-panel"><div class="login-form-wrap"><div class="mobile-login-mark">SC</div><div class="eyebrow">WELCOME BACK</div><h2>Sign in to your workspace</h2><p class="login-subtitle">Use your company-authorized account to continue.</p>
        ${message ? `<div class="alert ${message.startsWith('Missing Firebase') ? 'alert-warning' : ''}" role="alert">${escapeHtml(message)}</div>` : ''}
        <form id="login-form">
          <label for="email">Work email</label><input id="email" name="email" type="email" autocomplete="username" placeholder="name@company.com" value="${escapeAttr(emailValue)}" required />
          <div class="password-label"><label for="password">Password</label></div><input id="password" name="password" type="password" autocomplete="current-password" placeholder="Enter your password" required />
          <button id="login-button" class="button button-primary login-submit" type="submit">Sign in <span>→</span></button>
        </form>
        <div class="login-security"><span>▣</span><div><strong>Authorized access only</strong><small>Access is checked against your active user profile.</small></div></div>
        <p class="login-footnote">Need access? Contact your system administrator.</p>
      </div><div class="login-panel-footer">Seating Control Center <span>•</span> Internal use</div></section>
    </main>`;
  const form = document.querySelector('#login-form');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = document.querySelector('#email').value;
    const password = document.querySelector('#password').value;
    const button = document.querySelector('#login-button');
    button.disabled = true;
    button.innerHTML = 'Signing in…';
    try {
      await login(email, password);
      // Auth state listener renders the dashboard after verifying the Firestore profile.
    } catch (error) {
      renderLogin(friendlyError(error), email);
    }
  });
}

function renderStatus(title, message, actionLabel = 'Return to sign in') {
  root.innerHTML = `<main class="status-page"><div class="status-card"><div class="brand-mark">SC</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><button id="return-login" class="button button-primary">${escapeHtml(actionLabel)}</button></div></main>`;
  document.querySelector('#return-login')?.addEventListener('click', () => renderLogin());
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function escapeAttr(value) {
  return escapeHtml(value);
}

if (firebaseConfigError) {
  renderLogin(firebaseConfigError);
} else {
  stopWatching = watchAuth((state) => {
    if (state.kind === 'signed-out') {
      renderLogin();
    } else if (state.kind === 'signed-in') {
      renderDashboard(root, state.user, state.profile);
    } else if (state.kind === 'profile-missing' || state.kind === 'disabled') {
      renderStatus('Account setup required', state.message);
    } else if (state.kind === 'config-error') {
      renderLogin(state.message);
    } else if (state.kind === 'error') {
      renderStatus('Unable to verify account', state.message, 'Try sign in again');
    }
  });
}
window.addEventListener('beforeunload', () => stopWatching?.());
