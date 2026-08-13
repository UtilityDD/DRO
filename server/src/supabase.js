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

if (fs.existsSync(CONFIG_PATH)) {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (cfg.supabaseUrl) SUPABASE_URL = String(cfg.supabaseUrl).trim();
    if (cfg.supabaseKey) SUPABASE_KEY = String(cfg.supabaseKey).trim();
    if (cfg.supabaseServiceRoleKey) SUPABASE_KEY = String(cfg.supabaseServiceRoleKey).trim();
    if (cfg.schema) SCHEMA = String(cfg.schema).trim();
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

  if (!response.ok) {
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
  const q = order ? `${table}?select=*&order=${order}` : `${table}?select=*`;
  const rows = await querySupabase(q);
  return Array.isArray(rows) ? rows : [];
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

async function replaceTable(table, rows) {
  // Delete all then insert — used for full collection sync from local seed
  await querySupabase(`${table}?id=gte.0`, { method: 'DELETE', prefer: 'return=minimal' });
  if (!rows.length) return [];
  // Align keys across the full set first (chunks inherit the same shape).
  const aligned = alignObjectKeys(rows);
  const chunk = 200;
  const out = [];
  for (let i = 0; i < aligned.length; i += chunk) {
    const part = aligned.slice(i, i + chunk);
    const inserted = await querySupabase(table, {
      method: 'POST',
      body: part,
      prefer: 'return=representation',
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

module.exports = {
  SCHEMA,
  CONFIG_PATH,
  isConfigured,
  status,
  querySupabase,
  selectAll,
  upsertRows,
  replaceTable,
  updateByFilter,
  deleteByFilter,
  getUrl: () => SUPABASE_URL,
};
