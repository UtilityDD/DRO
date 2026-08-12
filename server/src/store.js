const fs = require('fs');
const path = require('path');
const { normalizeUser } = require('./permissions');
const sb = require('./supabase');

const DATA_DIR = path.join(__dirname, '..', 'data');

const TABLES = {
  offices: 'offices',
  portal_users: 'portal_users',
  upload_batches: 'upload_batches',
  consumer_master: 'consumer_master',
  bulk_consumers: 'bulk_consumers',
  nsc_cases: 'nsc_cases',
  disconnections: 'disconnections',
  grievances: 'grievances',
  tech_works: 'tech_works',
  spot_billing: 'spot_billing',
  atc_snapshots: 'atc_snapshots',
  activity_logs: 'activity_logs',
};

/** In-memory cache when Supabase is active */
const cache = Object.create(null);
let initialized = false;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function filePath(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

function useSupabase() {
  return sb.isConfigured();
}

function storeMode() {
  return useSupabase() ? 'supabase' : 'local';
}

function readLocal(name, fallback = []) {
  ensureDir();
  const p = filePath(name);
  if (!fs.existsSync(p)) {
    writeLocal(name, fallback);
    return structuredClone(fallback);
  }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return structuredClone(fallback);
  }
}

function writeLocal(name, data) {
  ensureDir();
  fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2), 'utf8');
}

function sanitizeRow(row) {
  const r = { ...row };
  [
    'mod_nsc', 'mod_disco', 'mod_grievance', 'mod_tech_works', 'mod_spot_billing', 'mod_bulk',
    'upload_nsc', 'upload_disco', 'upload_grievance', 'upload_tech_works', 'upload_spot_billing',
    'upload_consumer_master', 'upload_bulk',
  ].forEach((k) => delete r[k]);
  return r;
}

/**
 * Load from your Supabase project into memory (+ local mirror).
 * Call once at server boot before accepting traffic.
 */
async function initStore() {
  if (!useSupabase()) {
    initialized = true;
    console.log('[store] Mode: local JSON (Supabase not configured)');
    return { mode: 'local' };
  }
  console.log('[store] Mode: supabase →', sb.status().host);
  for (const [name, table] of Object.entries(TABLES)) {
    try {
      const rows = await sb.selectAll(table);
      const remote = Array.isArray(rows) ? rows : [];
      const local = readLocal(name, []);
      // Never wipe a populated local mirror with an empty remote (schema lag / failed push).
      if (remote.length === 0 && local.length > 0) {
        cache[name] = local;
        console.warn(
          `[store] ${table}: supabase empty, keeping local mirror (${local.length} rows)`
        );
      } else {
        cache[name] = remote;
        writeLocal(name, cache[name]);
        console.log(`[store] loaded ${table}: ${cache[name].length} rows`);
      }
    } catch (e) {
      console.warn(`[store] ${table} load failed, using local mirror:`, e.message);
      cache[name] = readLocal(name, []);
    }
  }
  initialized = true;
  return { mode: 'supabase', host: sb.status().host };
}

function readCollection(name, fallback = []) {
  if (useSupabase() && cache[name]) {
    return structuredClone(cache[name]);
  }
  return readLocal(name, fallback);
}

function writeCollection(name, data) {
  const copy = structuredClone(data);
  if (useSupabase()) cache[name] = copy;
  writeLocal(name, copy);

  if (!useSupabase()) return;
  const table = TABLES[name];
  if (!table) return;

  // Fire-and-persist to your Supabase account
  const persist = async () => {
    if (name === 'consumer_master' && copy.length > 2000) {
      const chunk = 400;
      for (let i = 0; i < copy.length; i += chunk) {
        await sb.upsertRows(table, copy.slice(i, i + chunk).map(sanitizeRow), 'consumer_id');
      }
      return;
    }
    await sb.replaceTable(table, copy.map(sanitizeRow));
  };
  persist().catch((e) => console.error(`[store] supabase persist ${table}:`, e.message));
}

const readCollectionSync = readCollection;
const writeCollectionSync = writeCollection;

function nextId(rows) {
  const max = rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
  return max + 1;
}

function scopeFilter(user, row) {
  if (!user) return false;
  const role = String(user.role || '').toLowerCase();
  if (role === 'admin' || role === 'region') return true;
  if (role === 'division') {
    return String(row.division_code || '') === String(user.division_code || '');
  }
  if (role === 'ccc') {
    if (!row.ccc_code && row.division_code) {
      return String(row.division_code || '') === String(user.division_code || '');
    }
    return String(row.ccc_code || '') === String(user.ccc_code || '');
  }
  if (user.ccc_code) return String(row.ccc_code || '') === String(user.ccc_code);
  if (user.division_code) return String(row.division_code || '') === String(user.division_code);
  return String(row.region_code || '341') === String(user.region_code || '341');
}

function readUsers() {
  return readCollection('portal_users', []).map((u) => normalizeUser(u));
}

function saveUserRecord(rawUser) {
  const users = readCollection('portal_users', []);
  const idx = users.findIndex((u) => u.username === rawUser.username);
  const record = sanitizeRow({
    ...rawUser,
    permissions: rawUser.permissions,
    updated_at: new Date().toISOString(),
  });
  if (idx >= 0) users[idx] = { ...users[idx], ...record, id: users[idx].id };
  else users.push({ ...record, id: nextId(users) });
  writeCollection('portal_users', users);
  return normalizeUser(users.find((u) => u.username === rawUser.username));
}

async function pushAllLocalToSupabase() {
  if (!useSupabase()) throw new Error('Supabase not configured');
  const report = [];
  for (const [name, table] of Object.entries(TABLES)) {
    const rows = readLocal(name, []);
    await sb.replaceTable(table, rows.map(sanitizeRow));
    cache[name] = structuredClone(rows);
    report.push({ table, rows: rows.length });
    console.log(`[supabase:push] ${table} ← ${rows.length} rows`);
  }
  return report;
}

module.exports = {
  DATA_DIR,
  TABLES,
  useSupabase,
  storeMode,
  initStore,
  readCollection,
  writeCollection,
  readCollectionSync,
  writeCollectionSync,
  nextId,
  scopeFilter,
  readUsers,
  saveUserRecord,
  pushAllLocalToSupabase,
  isReady: () => initialized,
};
