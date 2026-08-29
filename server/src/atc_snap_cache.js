const STATUS_TTL_MS = 5 * 60 * 1000;

let statusMemo = null;
let payloadMemo = null;

function scopeKey(user) {
  const role = String(user?.role || '').toLowerCase();
  const ccc = String(user?.ccc_code || '').trim();
  const div = String(user?.division_code || '').trim();
  if (role === 'admin' || role === 'region') return 'region';
  if (ccc) return `ccc:${ccc}`;
  if (div) return `div:${div}`;
  return `user:${String(user?.username || 'anon').toLowerCase()}`;
}

function atcVersionOf(stamp) {
  if (!stamp) return '';
  return `${String(stamp.latest_period || '').trim()}|n${Number(stamp.count) || 0}`;
}

function stampFromRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let latest = '';
  let sort = '';
  for (const r of list) {
    const s = String(r.period_sort || r.period_label || '');
    if (s >= sort) {
      sort = s;
      latest = String(r.period_label || latest);
    }
  }
  const stamp = { latest_period: latest || null, count: list.length };
  stamp.version = atcVersionOf(stamp);
  return stamp;
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

function getPayload(user, version) {
  if (!payloadMemo || !version) return null;
  if (payloadMemo.scope !== scopeKey(user) || payloadMemo.version !== version) return null;
  return payloadMemo.value;
}

function putPayload(user, version, value) {
  payloadMemo = { scope: scopeKey(user), version, value };
  return value;
}

function invalidate() {
  statusMemo = null;
  payloadMemo = null;
}

module.exports = {
  atcVersionOf,
  stampFromRows,
  getStatus,
  putStatus,
  getPayload,
  putPayload,
  invalidate,
};
