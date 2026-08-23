const fs = require('fs');
const path = require('path');
const { normalizeUser } = require('./permissions');
const sb = require('./supabase');
const { hydrateNscRows, packNscCloudRow, slimNscCloudRow } = require('./nsc_parse');

const DATA_DIR = path.join(__dirname, '..', 'data');
const READONLY_FS = Boolean(process.env.VERCEL || process.env.NOW_REGION);

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

/** Never fall back to local JSON for these when Supabase is configured. */
const CLOUD_ONLY = new Set(['atc_snapshots']);

/** In-memory cache when Supabase is active */
const cache = Object.create(null);
let initialized = false;

function ensureDir() {
  if (READONLY_FS) return;
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
    return cloneRows(name, fallback);
  }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return structuredClone(fallback);
  }
}

function writeLocal(name, data) {
  if (READONLY_FS) return;
  try {
    ensureDir();
    const pretty = name === 'nsc_cases' ? undefined : 2;
    fs.writeFileSync(filePath(name), JSON.stringify(data, null, pretty), 'utf8');
  } catch (e) {
    console.warn('[store] local write skipped:', e.message);
  }
}

function cloneRows(name, rows) {
  if (name === 'nsc_cases' && Array.isArray(rows) && rows.length > 5000) return rows;
  return structuredClone(rows);
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

const GRIEV_META = '\n||DRO||\n';
const GRIEV_EXTRA_KEYS = [
  'complaint_id',
  'followup_users',
  'followups',
  'created_by',
  'assigned_username',
  'target_resolve_on',
  'last_followup_on',
  'last_followup_by',
  'resolved_on',
  'resolved_by',
  'complainant_type',
  'complainant_phone',
  'office_code',
  'office_name',
  'office_type',
  'created_at',
];

function hydrateGrievance(row) {
  if (!row || typeof row !== 'object') return row;
  const raw = String(row.remarks || '');
  const i = raw.indexOf(GRIEV_META);
  const out = { ...row };
  if (i >= 0) {
    out.remarks = raw.slice(0, i);
    try {
      Object.assign(out, JSON.parse(raw.slice(i + GRIEV_META.length)) || {});
    } catch {
      /* keep text only */
    }
  }
  if (!out.complaint_id && out.docket_no) out.complaint_id = out.docket_no;
  if (!Array.isArray(out.followup_users)) {
    out.followup_users = out.assigned_username ? [String(out.assigned_username)] : [];
  }
  if (!Array.isArray(out.followups)) out.followups = [];
  return out;
}

function packGrievanceCloudRow(row) {
  const clean = sanitizeRow(row);
  const text = String(clean.remarks || '').split(GRIEV_META)[0];
  const extra = {};
  for (const k of GRIEV_EXTRA_KEYS) {
    if (clean[k] !== undefined) extra[k] = clean[k];
  }
  const keep = [
    'id',
    'docket_no',
    'consumer_id',
    'consumer_name',
    'ccc_code',
    'division_code',
    'region_code',
    'category',
    'lodged_on',
    'status',
    'aging_days',
    'priority',
    'remarks',
    'batch_id',
    'updated_at',
  ];
  const out = {};
  for (const k of keep) out[k] = k === 'remarks' ? `${text}${GRIEV_META}${JSON.stringify(extra)}` : clean[k] ?? null;
  return out;
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
  try {
    await sb.resolveAtcSchema();
  } catch (e) {
    console.warn('[store] schema probe failed:', e.message);
  }
  for (const [name, table] of Object.entries(TABLES)) {
    try {
      const local = name === 'nsc_cases' ? readLocal(name, []) : null;
      // 71k NSC rows: boot from local JSON so login is not blocked on a full Supabase pull + 68MB rewrite.
      if (name === 'nsc_cases' && local && local.length > 500) {
        cache[name] = hydrateNscRows(local);
        console.log(`[store] loaded ${table} from local: ${cache[name].length} rows (skipped supabase pull)`);
        continue;
      }
      const rows = await sb.selectAll(table);
      const remote = Array.isArray(rows) ? rows : [];
      const localRows = local || readLocal(name, []);
      if (CLOUD_ONLY.has(name)) {
        cache[name] = remote;
        writeLocal(name, cache[name]);
        console.log(`[store] loaded ${table} (cloud-only): ${cache[name].length} rows`);
        continue;
      }
      // Never wipe a populated local mirror with an empty remote (schema lag / failed push).
      if (remote.length === 0 && localRows.length > 0) {
        cache[name] =
          name === 'grievances' ? localRows.map(hydrateGrievance) : name === 'nsc_cases' ? hydrateNscRows(localRows) : localRows;
        console.warn(
          `[store] ${table}: supabase empty, keeping local mirror (${localRows.length} rows)`
        );
      } else {
        cache[name] =
          name === 'grievances' ? remote.map(hydrateGrievance) : name === 'nsc_cases' ? hydrateNscRows(remote) : remote;
        if (!(name === 'nsc_cases' && localRows.length === cache[name].length)) {
          writeLocal(name, cache[name]);
        }
        console.log(`[store] loaded ${table}: ${cache[name].length} rows`);
      }
    } catch (e) {
      if (CLOUD_ONLY.has(name)) {
        cache[name] = [];
        console.error(`[store] ${table} cloud load failed (no local fallback):`, e.message);
      } else {
        console.warn(`[store] ${table} load failed, using local mirror:`, e.message);
        const fallback = readLocal(name, []);
        cache[name] =
          name === 'grievances'
            ? fallback.map(hydrateGrievance)
            : name === 'nsc_cases'
              ? hydrateNscRows(fallback)
              : fallback;
      }
    }
  }
  initialized = true;
  return { mode: 'supabase', host: sb.status().host };
}

/**
 * Re-fetch a collection from Supabase into cache.
 * For cloud-only tables this is the source of truth for reads.
 */
async function refreshFromSupabase(name) {
  if (!useSupabase()) {
    throw new Error('Supabase not configured');
  }
  const table = TABLES[name];
  if (!table) throw new Error(`Unknown collection ${name}`);
  const rows = await sb.selectAll(table);
  const remote = Array.isArray(rows) ? rows : [];
  cache[name] =
    name === 'grievances' ? remote.map(hydrateGrievance) : name === 'nsc_cases' ? hydrateNscRows(remote) : remote;
  writeLocal(name, cache[name]);
  return cloneRows(name, cache[name]);
}

function readCollection(name, fallback = []) {
  let rows;
  if (useSupabase() && cache[name]) {
    rows = cloneRows(name, cache[name]);
  } else if (useSupabase() && CLOUD_ONLY.has(name)) {
    rows = cloneRows(name, fallback);
  } else {
    rows = readLocal(name, fallback);
  }
  if (name === 'grievances') return rows.map(hydrateGrievance);
  if (name === 'nsc_cases') return hydrateNscRows(rows);
  return rows;
}

function writeCollection(name, data) {
  const copy = cloneRows(name, data);
  if (useSupabase()) cache[name] = copy;
  writeLocal(name, copy);

  if (!useSupabase()) return;
  const table = TABLES[name];
  if (!table) return;

  // Fire-and-persist to your Supabase account
  persistCollection(name, copy).catch((e) =>
    console.error(`[store] supabase persist ${table}:`, e.message)
  );
}

async function writeCollectionAndPersist(name, data) {
  const copy = cloneRows(name, data);
  if (useSupabase()) cache[name] = copy;
  writeLocal(name, copy);

  if (!useSupabase()) {
    return { store: 'local', persisted: true, rows: copy.length };
  }
  const table = TABLES[name];
  if (!table) {
    return { store: 'supabase', persisted: false, error: `Unknown table ${name}`, rows: copy.length };
  }
  try {
    await persistCollection(name, copy);
    return {
      store: 'supabase',
      persisted: true,
      host: sb.status().host,
      table,
      rows: copy.length,
    };
  } catch (e) {
    console.error(`[store] supabase persist ${table}:`, e.message);
    return {
      store: 'supabase',
      persisted: false,
      host: sb.status().host,
      table,
      rows: copy.length,
      error: e.message,
    };
  }
}

async function persistCollection(name, copy) {
  const table = TABLES[name];
  if (!table) throw new Error(`Unknown collection ${name}`);
  if (name === 'consumer_master' && copy.length > 2000) {
    const chunk = 400;
    for (let i = 0; i < copy.length; i += chunk) {
      await sb.upsertRows(table, copy.slice(i, i + chunk).map(sanitizeRow), 'consumer_id');
    }
    return;
  }
  if (name === 'nsc_cases') {
    let useFull = true;
    try {
      await sb.querySupabase('nsc_cases?select=consumer_id,phone,report_date&limit=1');
    } catch {
      useFull = false;
    }
    const packed = copy.map((row) => sanitizeRow(useFull ? packNscCloudRow(row) : slimNscCloudRow(row)));
    await sb.replaceTable(table, packed, { chunk: 400, silent: true });
    return;
  }
  const mapped = copy.map((row) => {
    if (name === 'grievances') return packGrievanceCloudRow(row);
    return sanitizeRow(row);
  });
  if (name === 'grievances') {
    await sb.upsertRows(table, mapped, 'id');
    return;
  }
  await sb.replaceTable(table, mapped);
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

  const userDiv = String(user.division_code || '').trim();
  const userCcc = String(user.ccc_code || '').trim();
  const rowDiv = String(row.division_code || '').trim();
  const rowCcc = String(row.ccc_code || '').trim();
  const office = String(row.office_code || '').trim();
  const officeType = String(row.office_type || '').toLowerCase();

  // Infer division from office code when snapshot omitted division_code
  const inferredDiv =
    rowDiv ||
    (officeType === 'division' ? office : officeType === 'ccc' && office.length >= 4 ? office.slice(0, 4) : '');

  if (role === 'division') {
    if (!userDiv) return false;
    // Division users see their division rollup + their CCCs only — not region/zone/other divisions
    if (officeType === 'region' || officeType === 'zone' || officeType === 'utility') return false;
    if (officeType === 'division') return office === userDiv || inferredDiv === userDiv;
    if (officeType === 'ccc') {
      return inferredDiv === userDiv || office.startsWith(userDiv);
    }
    return inferredDiv === userDiv;
  }

  if (role === 'ccc') {
    if (!userCcc && !userDiv) return false;
    if (userCcc) {
      // Own CCC row, or parent division rollup for context
      if (officeType === 'ccc') return office === userCcc || rowCcc === userCcc;
      if (officeType === 'division' && userDiv) return office === userDiv || inferredDiv === userDiv;
      return false;
    }
    return inferredDiv === userDiv;
  }

  if (userCcc) return office === userCcc || rowCcc === userCcc;
  if (userDiv) return inferredDiv === userDiv || office.startsWith(userDiv);
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
    if (CLOUD_ONLY.has(name) || name === 'atc_snapshots') {
      console.warn(`[supabase:push] skipped ${table} (refusing to replace AT&C / cloud-only data)`);
      report.push({ table, rows: 0, skipped: true });
      continue;
    }
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
  refreshFromSupabase,
  readCollection,
  writeCollection,
  writeCollectionAndPersist,
  readCollectionSync,
  writeCollectionSync,
  nextId,
  scopeFilter,
  readUsers,
  saveUserRecord,
  pushAllLocalToSupabase,
  isReady: () => initialized,
  isCloudOnly: (name) => CLOUD_ONLY.has(name),
};
