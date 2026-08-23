const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'data', 'supabase_config.json');

let SCHEMA =
  process.env.SUPABASE_SCHEMA || process.env.DRO_SUPABASE_SCHEMA || 'dro';

let SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.DRO_SUPABASE_URL || '';
let SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.DRO_SUPABASE_KEY ||
  '';

let SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

let POWERMAP_URL =
  process.env.POWERMAP_SUPABASE_URL || process.env.VITE_POWERMAP_SUPABASE_URL || '';
let POWERMAP_ANON_KEY =
  process.env.POWERMAP_ANON_KEY || process.env.VITE_POWERMAP_ANON_KEY || '';
let POWERMAP_SCHEMA = process.env.POWERMAP_SCHEMA || 'powermap';

if (fs.existsSync(CONFIG_PATH)) {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (cfg.supabaseUrl) SUPABASE_URL = String(cfg.supabaseUrl).trim();
    if (cfg.supabaseKey) SUPABASE_KEY = String(cfg.supabaseKey).trim();
    if (cfg.supabaseServiceRoleKey) SUPABASE_KEY = String(cfg.supabaseServiceRoleKey).trim();
    if (cfg.schema) SCHEMA = String(cfg.schema).trim();
    if (cfg.supabaseAnonKey) SUPABASE_ANON_KEY = String(cfg.supabaseAnonKey).trim();
    if (cfg.anonKey) SUPABASE_ANON_KEY = String(cfg.anonKey).trim();
    if (cfg.powermapUrl) POWERMAP_URL = String(cfg.powermapUrl).trim();
    if (cfg.powermapAnonKey) POWERMAP_ANON_KEY = String(cfg.powermapAnonKey).trim();
    if (cfg.powermapSchema) POWERMAP_SCHEMA = String(cfg.powermapSchema).trim();
    console.log('[Supabase] Loaded credentials from server/data/supabase_config.json');
  } catch (e) {
    console.error('[Supabase] Failed to parse supabase_config.json:', e.message);
  }
}

function isConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY && !SUPABASE_URL.includes('YOUR_PROJECT'));
}

function status() {
  let host = '';
  try {
    host = SUPABASE_URL ? new URL(SUPABASE_URL).host : '';
  } catch {
    host = 'invalid-url';
  }
  return {
    configured: isConfigured(),
    url: SUPABASE_URL || null,
    host: host || null,
    schema: SCHEMA,
    source: fs.existsSync(CONFIG_PATH) ? 'config_file' : process.env.SUPABASE_URL ? 'env' : 'none',
  };
}

/**
 * Zero-dependency Supabase REST helper (schema `dro`).
 * Prefer service_role key on the server (bypasses RLS for portal ops).
 */
async function querySupabase(apiPath, options = {}) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured. Copy server/data/supabase_config.example.json → supabase_config.json');
  }
  const schema = options.schema || SCHEMA;
  const method = (options.method || 'GET').toUpperCase();
  const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${apiPath}`;
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Accept-Profile': schema,
    ...(options.headers || {}),
  };
  if (method !== 'GET' && method !== 'HEAD') {
    headers.Prefer = options.prefer || 'return=representation';
    headers['Content-Profile'] = schema;
  }

  const response = await fetch(url, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok && response.status !== 206) {
    const errText = await response.text();
    throw new Error(`Supabase HTTP ${response.status}: ${errText}`);
  }

  const text = await response.text();
  if (!text || !text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function selectAll(table, order = 'id.asc') {
  const page = 1000;
  const all = [];
  for (let from = 0; from < 500000; from += page) {
    const q = order ? `${table}?select=*&order=${order}` : `${table}?select=*`;
    const rows = await querySupabase(q, {
      headers: {
        Range: `${from}-${from + page - 1}`,
        'Range-Unit': 'items',
        Prefer: 'count=exact',
      },
    });
    const batch = Array.isArray(rows) ? rows : [];
    all.push(...batch);
    if (batch.length < page) break;
  }
  return all;
}

/** Use the exposed schema that already has AT&C rows (`dro` is often not in API settings). */
async function resolveAtcSchema() {
  const candidates = [...new Set(['public', 'dro', SCHEMA])];
  let best = SCHEMA;
  let bestCount = -1;
  for (const schema of candidates) {
    try {
      const rows = await querySupabase('atc_snapshots?select=id&limit=10000', { schema });
      const n = Array.isArray(rows) ? rows.length : 0;
      console.log(`[Supabase] atc_snapshots ${schema}: ${n} rows`);
      if (n > bestCount) {
        bestCount = n;
        best = schema;
      }
    } catch (e) {
      console.log(`[Supabase] atc_snapshots ${schema}: ${e.message}`);
    }
  }
  if (bestCount > 0 && best !== SCHEMA) {
    console.log(`[Supabase] using schema ${best} (${bestCount} AT&C rows; was ${SCHEMA})`);
    SCHEMA = best;
  }
  return { schema: SCHEMA, count: Math.max(bestCount, 0) };
}

async function upsertRows(table, rows, onConflict) {
  if (!rows.length) return [];
  const prefer = onConflict
    ? `resolution=merge-duplicates,return=representation`
    : 'return=representation';
  const headers = onConflict ? { Prefer: prefer } : undefined;
  // PostgREST upsert via Prefer + on_conflict query
  const path = onConflict ? `${table}?on_conflict=${encodeURIComponent(onConflict)}` : table;
  return querySupabase(path, {
    method: 'POST',
    body: alignObjectKeys(rows),
    prefer: onConflict ? 'resolution=merge-duplicates,return=representation' : 'return=representation',
    headers,
  });
}

/** PostgREST PGRST102: every object in a JSON array must have the same keys. */
function alignObjectKeys(rows) {
  if (!Array.isArray(rows) || rows.length <= 1) return rows;
  const keys = [];
  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }
  return rows.map((row) => {
    const out = {};
    for (const k of keys) {
      out[k] = row && Object.prototype.hasOwnProperty.call(row, k) ? row[k] : null;
    }
    return out;
  });
}

async function replaceTable(table, rows, opts = {}) {
  for (let i = 0; i < 2000; i += 1) {
    const probe = await querySupabase(`${table}?select=id&limit=1`);
    if (!Array.isArray(probe) || !probe.length) break;
    await querySupabase(`${table}?id=gte.0`, { method: 'DELETE', prefer: 'return=minimal' });
  }
  if (!rows.length) return [];
  const aligned = alignObjectKeys(rows);
  const chunk = opts.chunk || 200;
  const prefer = opts.silent ? 'return=minimal' : 'return=representation';
  const out = [];
  for (let i = 0; i < aligned.length; i += chunk) {
    const part = aligned.slice(i, i + chunk);
    const inserted = await querySupabase(table, {
      method: 'POST',
      body: part,
      prefer,
    });
    if (Array.isArray(inserted)) out.push(...inserted);
  }
  return out;
}

async function updateByFilter(table, filter, patch) {
  return querySupabase(`${table}?${filter}`, {
    method: 'PATCH',
    body: patch,
  });
}

async function deleteByFilter(table, filter) {
  return querySupabase(`${table}?${filter}`, {
    method: 'DELETE',
    prefer: 'return=minimal',
  });
}

function powerMapRest() {
  const url = POWERMAP_URL || SUPABASE_URL;
  const key = POWERMAP_ANON_KEY || SUPABASE_ANON_KEY || SUPABASE_KEY;
  const schema = POWERMAP_SCHEMA || 'powermap';
  return { url, key, schema };
}

async function probePowerMap() {
  const { url, key, schema } = powerMapRest();
  if (!url || !key) return { ok: false, reason: 'powermap_not_configured' };
  const attempts = [
    ['pm_v_substations', 'public'],
    ['v_substations', schema],
    ['substations', schema],
  ];
  let last = 'not found';
  for (const [table, sch] of attempts) {
    try {
      const r = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${table}?select=id&limit=1`, {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Accept-Profile': sch,
        },
      });
      if (r.ok) return { ok: true, table: sch === 'public' ? table : `${sch}.${table}` };
      last = `HTTP ${r.status}`;
    } catch (e) {
      last = e.message || String(e);
    }
  }
  return { ok: false, reason: last };
}

function publicPowerMapConfig() {
  const url = POWERMAP_URL || (isConfigured() ? SUPABASE_URL : null);
  const anonKey = POWERMAP_ANON_KEY || SUPABASE_ANON_KEY || null;
  return {
    url: url || null,
    anonKey,
    schema: POWERMAP_SCHEMA || 'public',
    configured: Boolean(url && anonKey),
  };
}

module.exports = {
  get SCHEMA() {
    return SCHEMA;
  },
  CONFIG_PATH,
  isConfigured,
  status,
  querySupabase,
  selectAll,
  resolveAtcSchema,
  upsertRows,
  replaceTable,
  updateByFilter,
  deleteByFilter,
  probePowerMap,
  publicPowerMapConfig,
  getUrl: () => SUPABASE_URL,
};
