/**
 * In-process NSC dump cache. The SAP file usually changes once a day.
 * Warm Vercel instances reuse the last status + queue payload instead of
 * pulling tens of thousands of rows from Supabase on every page open.
 */

const STATUS_TTL_MS = 5 * 60 * 1000;

let statusMemo = null;
const queueMemo = new Map();

function scopeKey(user) {
  const role = String(user?.role || '').toLowerCase();
  const ccc = String(user?.ccc_code || '').trim();
  const div = String(user?.division_code || '').trim();
  if (role === 'admin' || role === 'region') return 'region';
  if (ccc) return `ccc:${ccc}`;
  if (div) return `div:${div}`;
  return `user:${String(user?.username || 'anon').toLowerCase()}`;
}

function nscVersionOf(stamp) {
  if (!stamp) return '';
  return `${String(stamp.report_date || '').slice(0, 10)}|p${Number(stamp.pending) || 0}|w${Number(stamp.withheld) || 0}`;
}

function getStatus(user) {
  if (!statusMemo || Date.now() - statusMemo.at > STATUS_TTL_MS) return null;
  if (statusMemo.scope !== scopeKey(user)) return null;
  return statusMemo.value;
}

function putStatus(user, value) {
  statusMemo = { at: Date.now(), scope: scopeKey(user), value };
  return value;
}

function queueKey(user, queue, version) {
  return `${scopeKey(user)}|${queue}|${version}`;
}

function getQueue(user, queue, version) {
  if (!version) return null;
  return queueMemo.get(queueKey(user, queue, version)) || null;
}

function putQueue(user, queue, version, payload) {
  if (!version || !payload) return payload;
  queueMemo.set(queueKey(user, queue, version), payload);
  return payload;
}

function invalidate() {
  statusMemo = null;
  queueMemo.clear();
}

module.exports = {
  nscVersionOf,
  getStatus,
  putStatus,
  getQueue,
  putQueue,
  invalidate,
};
