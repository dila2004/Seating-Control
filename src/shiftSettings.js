import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase.js';

export const DEFAULT_SHIFT_SETTINGS = Object.freeze({
  morningStart: '07:30', morningEnd: '19:30',
  nightStart: '19:30', nightEnd: '07:30',
  departments: ['DP', 'WD', 'GS']
});

export async function getShiftSettings() {
  try {
    const snap = await getDoc(doc(db, 'systemSettings', 'shifts'));
    const saved = snap.exists() ? snap.data() : {};
    return {
      ...DEFAULT_SHIFT_SETTINGS,
      ...saved,
      departments: Array.isArray(saved.departments) && saved.departments.length
        ? saved.departments.map((value) => String(value).trim().toUpperCase()).filter(Boolean)
        : [...DEFAULT_SHIFT_SETTINGS.departments]
    };
  } catch (error) {
    console.warn('Could not read saved shift settings; using defaults.', error);
    return { ...DEFAULT_SHIFT_SETTINGS, departments: [...DEFAULT_SHIFT_SETTINGS.departments] };
  }
}

function minutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const h = Number(match[1]), m = Number(match[2]);
  return h < 24 && m < 60 ? h * 60 + m : null;
}

export function getColomboMinutes(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Colombo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  return Number(parts.find((p) => p.type === 'hour')?.value || 0) * 60
    + Number(parts.find((p) => p.type === 'minute')?.value || 0);
}

function inRange(now, start, end) {
  if (start === null || end === null || start === end) return false;
  return start < end ? now >= start && now < end : now >= start || now < end;
}

export function resolveShift(settings, date = new Date()) {
  const now = getColomboMinutes(date);
  const morningStart = minutes(settings?.morningStart ?? DEFAULT_SHIFT_SETTINGS.morningStart);
  const morningEnd = minutes(settings?.morningEnd ?? DEFAULT_SHIFT_SETTINGS.morningEnd);
  const nightStart = minutes(settings?.nightStart ?? DEFAULT_SHIFT_SETTINGS.nightStart);
  const nightEnd = minutes(settings?.nightEnd ?? DEFAULT_SHIFT_SETTINGS.nightEnd);
  if (inRange(now, morningStart, morningEnd)) return 'MORNING';
  if (inRange(now, nightStart, nightEnd)) return 'NIGHT';
  // Safe fallback for gaps/invalid overlapping configuration.
  return 'NIGHT';
}

export function shiftLabel(settings, shift) {
  const start = shift === 'MORNING' ? settings.morningStart : settings.nightStart;
  const end = shift === 'MORNING' ? settings.morningEnd : settings.nightEnd;
  return `${shift === 'MORNING' ? 'Morning' : 'Night'} · ${formatTime(start)}–${formatTime(end)}`;
}
function formatTime(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return String(value || '--:--');
  const hour = Number(match[1]);
  return `${String(hour % 12 || 12).padStart(2, '0')}:${match[2]} ${hour >= 12 ? 'PM' : 'AM'}`;
}
