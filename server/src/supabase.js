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
  const { body } = await querySupabaseMeta(apiPath, options);
  return body;
}

async function querySupabaseMeta(apiPath, options = {}) {
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
  let parsed = null;
  if (text && text.trim()) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { body: parsed, headers: response.headers, status: response.status };
}

async function countRows(table, query = '') {
  if (!isConfigured()) {
    throw new Error('Supabase not configured');
  }
  const qs = query
    ? query.includes('select=')
      ? query
      : `select=id&${query}`
    : 'select=id';
  const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${table}?${qs}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Accept-Profile': SCHEMA,
      Prefer: 'count=exact',
      Range: '0-0',
      'Range-Unit': 'items',
    },
  });
  if (!response.ok && response.status !== 206) {
    const errText = await response.text();
    throw new Error(`Supabase HTTP ${response.status}: ${errText}`);
  }
  const cr = response.headers.get('content-range') || '';
  const m = cr.match(/\/(\d+)/);
  return m ? Number(m[1]) : 0;
}

async function selectAll(table, order = 'id.asc', select = '*') {
  const page = 1000;
  const all = [];
  const sel = select || '*';
  for (let from = 0; from < 500000; from += page) {
    const q = `${table}?select=${encodeURIComponent(sel)}${order ? `&order=${order}` : ''}`;
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

function missingPgColumn(err) {
  const raw = String(err?.message || err || '');
  let msg = raw;
  const brace = raw.indexOf('{');
  if (brace >= 0) {
    try {
      const j = JSON.parse(raw.slice(brace));
      msg = j.message || j.hint || raw;
    } catch {
      /* keep */
    }
  }
  const m = String(msg).match(/column (?:[\w.]+\.)?(\w+) does not exist/i)
    || String(msg).match(/column "(\w+)" of relation/i)
    || String(msg).match(/Could not find the '(\w+)' column/i);
  return m ? m[1] : '';
}

async function upsertRows(table, rows, onConflict, opts = {}) {
  if (!rows.length) return [];
  const silent = !!opts.silent;
  const prefer = onConflict
    ? `resolution=merge-duplicates,return=${silent ? 'minimal' : 'representation'}`
    : `return=${silent ? 'minimal' : 'representation'}`;
  const path = onConflict ? `${table}?on_conflict=${encodeURIComponent(onConflict)}` : table;
  let payload = alignObjectKeys(rows);
  for (let i = 0; i < 24; i += 1) {
    try {
      return await querySupabase(path, {
        method: 'POST',
        body: payload,
        prefer,
      });
    } catch (e) {
      const col = missingPgColumn(e);
      if (!col || !payload.some((r) => r && Object.prototype.hasOwnProperty.call(r, col))) throw e;
      payload = payload.map((r) => {
        if (!r || typeof r !== 'object') return r;
        const next = { ...r };
        delete next[col];
        return next;
      });
    }
  }
  return querySupabase(path, { method: 'POST', body: payload, prefer });
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

/** Repeat DELETE until the filter matches nothing (PostgREST may cap one request). */
async function deleteAllMatching(table, filter, opts = {}) {
  const max = opts.max || 400;
  let removed = 0;
  for (let i = 0; i < max; i += 1) {
    const left = await countRows(table, filter);
    if (!left) return removed;
    await deleteByFilter(table, filter);
    const next = await countRows(table, filter);
    const batch = Math.max(0, left - next);
    removed += batch;
    if (!batch) return removed;
  }
  return removed;
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

function storageUrl(path) {
  return `${String(SUPABASE_URL || '').replace(/\/$/, '')}/storage/v1/${path.replace(/^\//, '')}`;
}

async function storageSignedUpload(bucket, objectPath) {
  const response = await fetch(storageUrl(`object/upload/sign/${bucket}/${objectPath}`), {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expiresIn: 900 }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || data.message || `Storage sign HTTP ${response.status}`);
  }
  const signed = data.url || data.signedUrl || data.signedURL;
  const token = data.token || '';
  const abs = String(signed || '').startsWith('http')
    ? signed
    : `${String(SUPABASE_URL || '').replace(/\/$/, '')}/storage/v1${String(signed).startsWith('/') ? signed : `/${signed}`}`;
  return { url: abs, token, path: objectPath };
}

async function storagePutJson(bucket, objectPath, value) {
  const response = await fetch(storageUrl(`object/${bucket}/${objectPath}`), {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'x-upsert': 'true',
    },
    body: JSON.stringify(value),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Storage put HTTP ${response.status}: ${errText.slice(0, 240)}`);
  }
}

async function storagePutText(bucket, objectPath, text, contentType = 'text/csv') {
  const response = await fetch(storageUrl(`object/${bucket}/${objectPath}`), {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
    body: text,
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Storage put HTTP ${response.status}: ${errText.slice(0, 240)}`);
  }
}

async function storageDownload(bucket, objectPath) {
  const response = await fetch(storageUrl(`object/${bucket}/${objectPath}`), {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Storage get HTTP ${response.status}: ${errText.slice(0, 240)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function storageSignedDownload(bucket, objectPath, expiresIn = 300) {
  const response = await fetch(storageUrl(`object/sign/${bucket}/${objectPath}`), {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expiresIn }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || data.message || `Storage sign-get HTTP ${response.status}`);
  }
  const signed = data.signedURL || data.signedUrl || data.url;
  const abs = String(signed || '').startsWith('http')
    ? signed
    : `${String(SUPABASE_URL || '').replace(/\/$/, '')}/storage/v1${String(signed).startsWith('/') ? signed : `/${signed}`}`;
  return abs;
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
  countRows,
  resolveAtcSchema,
  upsertRows,
  replaceTable,
  updateByFilter,
  deleteByFilter,
  deleteAllMatching,
  probePowerMap,
  publicPowerMapConfig,
  querySupabaseMeta,
  storageSignedUpload,
  storagePutJson,
  storagePutText,
  storageDownload,
  storageSignedDownload,
  getUrl: () => SUPABASE_URL,
  getKey: () => SUPABASE_KEY,
};
