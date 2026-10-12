import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db, firebaseConfigError } from './firebase.js';

export function watchAuth(callback) {
  if (firebaseConfigError) {
    callback({ kind: 'config-error', message: firebaseConfigError });
    return () => {};
  }
  return onAuthStateChanged(auth, async (user) => {
    if (!user) {
      callback({ kind: 'signed-out' });
      return;
    }
    try {
      const profileRef = doc(db, 'users', user.uid);
      const profileSnap = await getDoc(profileRef);
      if (!profileSnap.exists()) {
        await signOut(auth);
        callback({
          kind: 'profile-missing',
          message: 'Your Firebase login exists, but no authorized users/{uid} profile was found. Ask the system administrator to provision your account.'
        });
        return;
      }
      const profile = profileSnap.data();
      if (profile.status !== 'ACTIVE') {
        await signOut(auth);
        callback({ kind: 'disabled', message: 'This account is inactive. Contact your system administrator.' });
        return;
      }
      callback({ kind: 'signed-in', user, profile });
    } catch (error) {
      callback({ kind: 'error', message: friendlyError(error) });
    }
  });
}

export async function login(email, password) {
  if (firebaseConfigError) throw new Error(firebaseConfigError);
  await signInWithEmailAndPassword(auth, email.trim(), password);
}

export async function logout() {
  if (!auth) return;
  await signOut(auth);
}

export function friendlyError(error) {
  const code = error?.code || '';
  const messages = {
    'auth/invalid-credential': 'Email or password is incorrect.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/too-many-requests': 'Too many attempts. Wait a little and try again.',
    'auth/network-request-failed': 'Network error. Check your internet connection.',
    'permission-denied': 'Access denied by Firestore Security Rules.',
    'unavailable': 'Firebase is temporarily unavailable. Try again.'
  };
  return messages[code] || error?.message || 'Something went wrong. Please try again.';
}
