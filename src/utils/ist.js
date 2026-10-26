// Asia/Kolkata date helpers. Subscription rules (the 9 PM skip/pause
// cut-off, "today", plan ranges) are all defined in IST, while the server
// clock runs in UTC — so every comparison goes through these helpers and
// dates are handled as IST calendar-day strings ("2026-10-27").

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

function istNow(date = new Date()) {
  return new Date(date.getTime() + IST_OFFSET_MS);
}

// "2026-10-27" for the IST calendar day containing `date`.
function istDateKey(date = new Date()) {
  return istNow(date).toISOString().slice(0, 10);
}

// Minutes since IST midnight (for the cut-off check).
function istMinutesOfDay(date = new Date()) {
  const n = istNow(date);
  return n.getUTCHours() * 60 + n.getUTCMinutes();
}

function addDaysKey(key, days) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function diffDaysKey(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

const isValidKey = (key) => /^\d{4}-\d{2}-\d{2}$/.test(key || "");

// The skip/pause cut-off: changes for a delivery day must be made before
// 21:00 IST on the day before it.
const CUTOFF_MINUTES = 21 * 60;
function beforeCutoffFor(targetKey, now = new Date()) {
  const today = istDateKey(now);
  if (targetKey <= today) return false; // today/past is already locked in
  if (diffDaysKey(today, targetKey) >= 2) return true;
  return istMinutesOfDay(now) < CUTOFF_MINUTES; // target is tomorrow
}

module.exports = { istDateKey, istMinutesOfDay, addDaysKey, diffDaysKey, isValidKey, beforeCutoffFor, CUTOFF_MINUTES };
