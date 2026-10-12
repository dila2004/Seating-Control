const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();

async function requireAdmin(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Please sign in first.');
  const uid = request.auth.uid;
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) throw new HttpsError('permission-denied', 'User profile not found.');
  const user = snap.data();
  if (user.status !== 'ACTIVE' || user.role !== 'ADMIN') {
    throw new HttpsError('permission-denied', 'Only active administrators can manage platforms.');
  }
  return { uid, user };
}
function cleanText(value, field, maxLength, required = false) {
  if (typeof value !== 'string') throw new HttpsError('invalid-argument', `${field} must be text.`);
  const cleaned = value.trim();
  if (required && !cleaned) throw new HttpsError('invalid-argument', `${field} is required.`);
  if (cleaned.length > maxLength) throw new HttpsError('invalid-argument', `${field} is too long.`);
  return cleaned;
}
function cleanPlatformId(value) {
  const id = cleanText(value, 'Platform ID', 40, true).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id.length < 2) {
    throw new HttpsError('invalid-argument', 'Platform ID must use letters/numbers separated by hyphens, e.g. jax-1.');
  }
  return id;
}
async function audit({ actorUid, action, platformId, before = null, after = null }) {
  await db.collection('auditLogs').add({
    actorUid, action, entityType: 'PLATFORM', entityId: platformId,
    before, after, createdAt: FieldValue.serverTimestamp()
  });
}

exports.createPlatform = onCall({ enforceAppCheck: false }, async (request) => {
  const { uid } = await requireAdmin(request);
  const data = request.data || {};
  const platformId = cleanPlatformId(data.platformId);
  const name = cleanText(data.name, 'Platform name', 80, true);
  const description = cleanText(data.description || '', 'Description', 300, false);
  const ref = db.collection('platforms').doc(platformId);
  const existing = await ref.get();
  if (existing.exists) throw new HttpsError('already-exists', `Platform ID "${platformId}" already exists.`);
  const record = {
    platformId, name, description, status: 'ACTIVE',
    createdBy: uid, createdAt: FieldValue.serverTimestamp(),
    updatedBy: uid, updatedAt: FieldValue.serverTimestamp()
  };
  await ref.create(record);
  await audit({ actorUid: uid, action: 'PLATFORM_CREATED', platformId, after: { platformId, name, description, status: 'ACTIVE' } });
  return { success: true, platformId };
});

exports.setPlatformStatus = onCall({ enforceAppCheck: false }, async (request) => {
  const { uid } = await requireAdmin(request);
  const data = request.data || {};
  const platformId = cleanPlatformId(data.platformId);
  const status = cleanText(data.status, 'Status', 10, true).toUpperCase();
  if (!['ACTIVE', 'INACTIVE'].includes(status)) throw new HttpsError('invalid-argument', 'Status must be ACTIVE or INACTIVE.');
  const ref = db.collection('platforms').doc(platformId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', `Platform "${platformId}" was not found.`);
  const before = snap.data();
  await ref.update({ status, updatedBy: uid, updatedAt: FieldValue.serverTimestamp() });
  await audit({ actorUid: uid, action: status === 'ACTIVE' ? 'PLATFORM_ACTIVATED' : 'PLATFORM_DEACTIVATED', platformId, before: { name: before.name, status: before.status || 'ACTIVE' }, after: { name: before.name, status } });
  return { success: true, platformId, status };
});
