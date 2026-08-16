const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const {
  readCollection,
  writeCollection,
  writeCollectionAndPersist,
  nextId,
  scopeFilter,
  readUsers,
  initStore,
  refreshFromSupabase,
  storeMode,
  useSupabase,
} = require('./store');
const sb = require('./supabase');
const {
  MODULES,
  normalizeUser,
  normalizePermissions,
  emptyPerms,
  canView,
  canUpload,
  canEdit,
  uploadRouteToModule,
} = require('./permissions');
const { seedAll } = require('./seed_lib');

const PORT = process.env.PORT || 8787;
const app = express();

app.set('trust proxy', 1);
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json({ limit: '15mb' }));
app.use(cookieParser());
app.use(
  session({
    name: 'dro_sid',
    secret: process.env.SESSION_SECRET || 'dro-ops-dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.VERCEL === '1' || process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 12,
    },
  })
);

function ensureSeeded() {
  const offices = readCollection('offices', null);
  if (!offices || !offices.length) {
    const mapPath = path.join(__dirname, '..', '..', 'data', 'office_map.json');
    if (fs.existsSync(mapPath)) {
      seedAll(null);
      console.log('[DRO] Auto-seeded from data/office_map.json');
    }
  }
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    store: storeMode(),
    supabase: sb.status(),
  });
});

function publicUser(u) {
  if (!u) return null;
  const normalized = normalizeUser(u);
  const { pin, ...rest } = normalized;
  return rest;
}

function requireAuth(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  // refresh permissions from DB each request
  const users = readUsers();
  const fresh = users.find((u) => u.username === req.session.user.username);
  if (!fresh) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'User missing' });
  }
  req.user = publicUser(fresh);
  req.session.user = req.user;
  next();
}

function requireAdmin(req, res, next) {
  if (String(req.user?.role || '').toLowerCase() !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  next();
}

function requirePerm(moduleId, action) {
  return (req, res, next) => {
    const ok =
      action === 'view'
        ? canView(req.user, moduleId)
        : action === 'upload'
          ? canUpload(req.user, moduleId)
          : canEdit(req.user, moduleId);
    if (!ok) {
      return res.status(403).json({ error: `No ${action} permission for ${moduleId}` });
    }
    next();
  };
}

function logActivity(username, action, detail) {
  const logs = readCollection('activity_logs', []);
  logs.unshift({
    id: nextId(logs),
    username,
    action,
    detail,
    created_at: new Date().toISOString(),
  });
  writeCollection('activity_logs', logs.slice(0, 500));
}

function officeName(code) {
  const offices = readCollection('offices', []);
  return offices.find((o) => String(o.code) === String(code))?.name || code;
}

function enrichRows(rows) {
  return rows.map((r) => ({
    ...r,
    ccc_name: r.ccc_code ? officeName(r.ccc_code) : '',
    division_name: r.division_code ? officeName(r.division_code) : '',
  }));
}

function filterScoped(user, rows) {
  return enrichRows(rows.filter((r) => scopeFilter(user, r)));
}

function kpiPulse(user) {
  const nsc = filterScoped(user, readCollection('nsc_cases', []));
  const disco = filterScoped(user, readCollection('disconnections', []));
  const griev = filterScoped(user, readCollection('grievances', []));
  const tech = filterScoped(user, readCollection('tech_works', []));
  const spot = filterScoped(user, readCollection('spot_billing', []));
  const consumers = filterScoped(user, readCollection('consumer_master', []));
  const offices = readCollection('offices', []);
  const cccs = offices.filter((o) => o.office_type === 'ccc' && scopeFilter(user, o));

  const spotTarget = spot.reduce((s, r) => s + (r.target_count || 0), 0);
  const spotBilled = spot.reduce((s, r) => s + (r.billed_count || 0), 0);

  return {
    pending_nsc: nsc.filter((r) => r.status === 'pending' || r.status === 'in_progress').length,
    pending_disco: disco.filter((r) => r.status === 'pending').length,
    open_grievances: griev.filter((r) => r.status === 'open').length,
    open_tech_works: tech.filter((r) => r.status !== 'completed').length,
    spot_coverage_pct: spotTarget ? Math.round((spotBilled / spotTarget) * 1000) / 10 : 0,
    consumer_master_count: consumers.length,
    ccc_count: cccs.length,
    division_count: offices.filter((o) => o.office_type === 'division').length,
    region_consumers: offices.find((o) => o.code === '341')?.consumer_count || 0,
  };
}

// ——— Auth ———
app.post('/api/login', (req, res) => {
  try {
    const body = req.body || {};
    const username = String(body.username || '').trim();
    const pin = String(body.pin || '').trim();
    const users = readCollection('portal_users', []);
    const raw = users.find(
      (u) => String(u.username || '').toLowerCase() === username.toLowerCase() && String(u.pin) === pin
    );
    if (!raw) return res.status(401).json({ error: 'Invalid username or PIN' });

    raw.last_login = new Date().toISOString();
    writeCollection('portal_users', users);
    const user = publicUser(raw);
    req.session.user = user;
    logActivity(user.username, 'login', 'Signed in');
    res.json({ ok: true, user });
  } catch (e) {
    console.error('[login]', e);
    res.status(500).json({ error: e.message || 'Login failed' });
  }
});

app.post('/api/logout', (req, res) => {
  const u = req.session?.user?.username;
  req.session.destroy(() => {
    if (u) logActivity(u, 'logout', 'Signed out');
    res.clearCookie('dro_sid');
    res.json({ ok: true });
  });
});

app.get('/api/session', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'No session' });
  const users = readUsers();
  const fresh = users.find((u) => u.username === req.session.user.username);
  if (!fresh) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'User missing' });
  }
  const user = publicUser(fresh);
  req.session.user = user;
  res.json({ user });
});

app.get('/api/auth/catalog', requireAuth, (req, res) => {
  const modules = MODULES.map((m) => ({
    ...m,
    view: canView(req.user, m.id),
    upload: canUpload(req.user, m.id),
    edit: canEdit(req.user, m.id),
  }));
  res.json({ modules, permissions: req.user.permissions });
});

// ——— Core ———
app.get('/api/pulse', requireAuth, (req, res) => {
  res.json({ pulse: kpiPulse(req.user) });
});

app.get('/api/offices', requireAuth, (req, res) => {
  const offices = readCollection('offices', []);
  const type = req.query.type;
  let rows = offices;
  if (type) rows = rows.filter((o) => o.office_type === type);
  // Scope: CCC users only their CCC; division only their div
  const role = String(req.user.role || '').toLowerCase();
  if (role === 'ccc') {
    rows = rows.filter(
      (o) =>
        o.code === req.user.ccc_code ||
        o.code === req.user.division_code ||
        o.office_type === 'region' ||
        o.office_type === 'zone'
    );
  } else if (role === 'division') {
    rows = rows.filter(
      (o) =>
        o.division_code === req.user.division_code ||
        o.code === req.user.division_code ||
        o.office_type === 'region' ||
        o.office_type === 'zone'
    );
  }
  res.json({ offices: rows });
});

app.get('/api/hierarchy', requireAuth, (req, res) => {
  const offices = readCollection('offices', []);
  const region = offices.find((o) => o.office_type === 'region');
  const divisions = offices.filter((o) => o.office_type === 'division');
  const tree = divisions
    .filter((d) => scopeFilter(req.user, { ...d, ccc_code: req.user.ccc_code || '' }) ||
      String(req.user.role).toLowerCase() === 'admin' ||
      String(req.user.role).toLowerCase() === 'region' ||
      d.code === req.user.division_code)
    .map((d) => ({
      ...d,
      cccs: offices.filter((c) => c.office_type === 'ccc' && c.division_code === d.code)
        .filter((c) => {
          const role = String(req.user.role || '').toLowerCase();
          if (role === 'ccc') return c.code === req.user.ccc_code;
          return true;
        }),
    }));

  // Fix filter for division role
  const role = String(req.user.role || '').toLowerCase();
  let filtered = tree;
  if (role === 'division') filtered = tree.filter((d) => d.code === req.user.division_code);
  if (role === 'ccc') filtered = tree.filter((d) => d.code === req.user.division_code);

  res.json({ region, divisions: filtered });
});

function listModule(collection, moduleId) {
  return (req, res) => {
    if (!canView(req.user, moduleId)) {
      return res.status(403).json({ error: `No view permission for ${moduleId}` });
    }
    const rows = filterScoped(req.user, readCollection(collection, []));
    const division = req.query.division;
    const ccc = req.query.ccc;
    const status = req.query.status;
    let out = rows;
    if (division) out = out.filter((r) => String(r.division_code) === String(division));
    if (ccc) out = out.filter((r) => String(r.ccc_code) === String(ccc));
    if (status) out = out.filter((r) => String(r.status) === String(status));
    res.json({
      rows: out,
      total: out.length,
      can_edit: canEdit(req.user, moduleId),
      can_upload: canUpload(req.user, moduleId),
    });
  };
}

app.get('/api/nsc', requireAuth, listModule('nsc_cases', 'nsc'));
app.get('/api/disco', requireAuth, listModule('disconnections', 'disco'));
app.get('/api/grievances', requireAuth, listModule('grievances', 'grievance'));
app.get('/api/tech-works', requireAuth, listModule('tech_works', 'tech_works'));
app.get('/api/spot-billing', requireAuth, listModule('spot_billing', 'spot_billing'));
app.get('/api/bulk', requireAuth, listModule('bulk_consumers', 'bulk'));
app.get('/api/consumers', requireAuth, requirePerm('consumers', 'view'), (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  let rows = filterScoped(req.user, readCollection('consumer_master', []));
  if (q) {
    rows = rows.filter(
      (r) =>
        String(r.consumer_id).toLowerCase().includes(q) ||
        String(r.name || '').toLowerCase().includes(q)
    );
  }
  res.json({
    rows: rows.slice(0, 500),
    total: rows.length,
    can_edit: canEdit(req.user, 'consumers'),
    can_upload: canUpload(req.user, 'consumers'),
  });
});

app.get('/api/atc', requireAuth, requirePerm('atc', 'view'), async (req, res) => {
  if (!useSupabase()) {
    return res.status(503).json({
      error: 'AT&C requires Supabase. Configure server/data/supabase_config.json.',
      rows: [],
      periods: [],
      formats: ['IA', 'IB'],
      source: 'none',
    });
  }

  let rows;
  try {
    rows = await refreshFromSupabase('atc_snapshots');
  } catch (e) {
    return res.status(502).json({
      error: `Failed to load AT&C from Supabase: ${e.message}`,
      rows: [],
      periods: [],
      formats: ['IA', 'IB'],
      source: 'supabase',
    });
  }

  const period = req.query.period ? String(req.query.period) : '';
  const format = req.query.format ? String(req.query.format).toUpperCase() : '';
  const officeType = req.query.office_type ? String(req.query.office_type) : '';
  const division = req.query.division_code ? String(req.query.division_code) : '';

  let out = rows.filter((r) => {
    const scoped = scopeFilter(req.user, {
      ...r,
      ccc_code: r.ccc_code || (r.office_type === 'ccc' ? r.office_code : ''),
      division_code:
        r.division_code ||
        (r.office_type === 'division' ? r.office_code : r.office_type === 'ccc' ? String(r.office_code || '').slice(0, 4) : ''),
      region_code: r.region_code || '341',
    });
    return scoped;
  });

  if (period) out = out.filter((r) => r.period_label === period);
  if (format) out = out.filter((r) => String(r.source_format || 'IA').toUpperCase() === format);
  if (officeType) out = out.filter((r) => r.office_type === officeType);
  if (division) {
    out = out.filter(
      (r) =>
        String(r.division_code || '') === division ||
        (r.office_type === 'division' && String(r.office_code) === division) ||
        (r.office_type === 'ccc' && String(r.office_code || '').startsWith(division))
    );
  }

  out.sort((a, b) => {
    const ps = String(a.period_sort || '').localeCompare(String(b.period_sort || ''));
    if (ps) return ps;
    const ft = String(a.source_format || '').localeCompare(String(b.source_format || ''));
    if (ft) return ft;
    return String(a.office_code || '').localeCompare(String(b.office_code || ''));
  });

  const periods = [
    ...new Set(out.map((r) => r.period_label).filter(Boolean)),
  ].sort((a, b) => {
    const ra = out.find((r) => r.period_label === a);
    const rb = out.find((r) => r.period_label === b);
    return String(ra?.period_sort || a).localeCompare(String(rb?.period_sort || b));
  });

  res.json({
    rows: out,
    periods,
    formats: ['IA', 'IB'],
    source: 'supabase',
    host: sb.status().host,
    can_edit: canEdit(req.user, 'atc'),
    can_upload: canUpload(req.user, 'atc'),
  });
});

/** Admin (or atc-edit) patch of a single snapshot row by natural key. */
app.patch('/api/atc', requireAuth, requirePerm('atc', 'edit'), async (req, res) => {
  const period_label = String(req.body?.period_label || '').trim();
  const office_code = String(req.body?.office_code || '').trim();
  const source_format = String(req.body?.source_format || 'IA').toUpperCase() === 'IB' ? 'IB' : 'IA';
  const patchIn = req.body?.patch && typeof req.body.patch === 'object' ? req.body.patch : {};
  if (!period_label || !office_code) {
    return res.status(400).json({ error: 'period_label and office_code required' });
  }

  const ALLOWED = [
    'atc_loss',
    'dist_loss',
    'coll_eff',
    'target_atc',
    'target_dist',
    'input_mu',
    'demand_mu',
    'collection_mu',
    'consumer_count',
  ];
  const n = (v) => {
    if (v == null || v === '') return null;
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  };
  const patch = { updated_at: new Date().toISOString() };
  for (const key of ALLOWED) {
    if (Object.prototype.hasOwnProperty.call(patchIn, key)) {
      patch[key] = n(patchIn[key]);
    }
  }
  if (Object.keys(patch).length <= 1) {
    return res.status(400).json({ error: 'No editable fields in patch' });
  }

  try {
    if (useSupabase()) {
      await refreshFromSupabase('atc_snapshots');
    }
    const rows = readCollection('atc_snapshots', []);
    const idx = rows.findIndex(
      (r) =>
        String(r.period_label) === period_label &&
        String(r.source_format || 'IA').toUpperCase() === source_format &&
        String(r.office_code) === office_code
    );
    if (idx < 0) {
      return res.status(404).json({ error: 'ATC row not found for that office / month / format' });
    }
    const existing = rows[idx];
    const inScope = scopeFilter(req.user, {
      ...existing,
      ccc_code: existing.ccc_code || (existing.office_type === 'ccc' ? existing.office_code : ''),
      division_code:
        existing.division_code ||
        (existing.office_type === 'division'
          ? existing.office_code
          : existing.office_type === 'ccc'
            ? String(existing.office_code || '').slice(0, 4)
            : ''),
      region_code: existing.region_code || '341',
    });
    if (!inScope) {
      return res.status(403).json({ error: 'Outside your office scope' });
    }
    const next = { ...existing, ...patch };
    rows[idx] = next;

    if (useSupabase()) {
      const filter =
        `period_label=eq.${encodeURIComponent(period_label)}` +
        `&source_format=eq.${encodeURIComponent(source_format)}` +
        `&office_code=eq.${encodeURIComponent(office_code)}`;
      await sb.updateByFilter('atc_snapshots', filter, patch);
      await refreshFromSupabase('atc_snapshots');
    } else {
      await writeCollectionAndPersist('atc_snapshots', rows);
    }

    const fresh = readCollection('atc_snapshots', []).find(
      (r) =>
        String(r.period_label) === period_label &&
        String(r.source_format || 'IA').toUpperCase() === source_format &&
        String(r.office_code) === office_code
    );

    logActivity(
      req.user.username,
      'edit',
      `atc ${source_format} ${period_label} ${office_code}: ${Object.keys(patch)
        .filter((k) => k !== 'updated_at')
        .join(',')}`
    );
    res.json({ ok: true, row: fresh || next });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to patch ATC row' });
  }
});

/** Authoritative ATC workbook parse (server) — keeps Division TOTAL inference in sync. */
app.post('/api/atc/parse', requireAuth, requirePerm('atc', 'upload'), (req, res) => {
  try {
    const XLSX = require('xlsx');
    const { parseAtcWorkbook } = require('./atc_parse');
    const b64 = String(req.body?.base64 || '');
    if (!b64) return res.status(400).json({ error: 'Missing workbook (base64)' });
    const buf = Buffer.from(b64, 'base64');
    const wb = XLSX.read(buf, { type: 'buffer' });
    const sheetToAoa = (sheet) =>
      XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
    const parsed = parseAtcWorkbook(wb, sheetToAoa, {
      period_label: req.body?.period_label || '',
    });
    res.json({
      ok: true,
      period_label: parsed.period_label,
      target_fy: parsed.target_fy,
      rows: parsed.rows,
      filtered_out: parsed.filtered_out,
      counts: parsed.counts,
    });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Failed to parse ATC workbook' });
  }
});

app.get('/api/batches', requireAuth, (req, res) => {
  const rows = readCollection('upload_batches', []);
  res.json({ rows });
});

app.get('/api/activity', requireAuth, requireAdmin, (req, res) => {
  res.json({ rows: readCollection('activity_logs', []) });
});

app.get('/api/nsc/summary', requireAuth, requirePerm('nsc', 'view'), (req, res) => {
  const rows = filterScoped(req.user, readCollection('nsc_cases', []));
  const byDivision = {};
  const byStatus = {};
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    const key = r.division_code || 'unknown';
    if (!byDivision[key]) byDivision[key] = { division_code: key, division_name: officeName(key), pending: 0, total: 0, avg_delay: 0, delay_sum: 0 };
    byDivision[key].total += 1;
    if (r.status === 'pending' || r.status === 'in_progress') byDivision[key].pending += 1;
    byDivision[key].delay_sum += r.delay_days || 0;
  }
  Object.values(byDivision).forEach((d) => {
    d.avg_delay = d.total ? Math.round(d.delay_sum / d.total) : 0;
    delete d.delay_sum;
  });
  res.json({ byStatus, byDivision: Object.values(byDivision), total: rows.length });
});

app.get('/api/disco/summary', requireAuth, requirePerm('disco', 'view'), (req, res) => {
  const rows = filterScoped(req.user, readCollection('disconnections', []));
  const byDivision = {};
  let totalDue = 0;
  for (const r of rows) {
    totalDue += Number(r.amount_due) || 0;
    const key = r.division_code || 'unknown';
    if (!byDivision[key]) byDivision[key] = { division_code: key, division_name: officeName(key), pending: 0, reconnected: 0, total_due: 0 };
    if (r.status === 'pending') byDivision[key].pending += 1;
    if (r.status === 'reconnected') byDivision[key].reconnected += 1;
    byDivision[key].total_due += Number(r.amount_due) || 0;
  }
  res.json({ byDivision: Object.values(byDivision), total: rows.length, totalDue, pending: rows.filter((r) => r.status === 'pending').length });
});

// ——— Uploads (batched JSON rows from client parse) ———
function upsertByKey(collection, rows, keyFn, mapFn) {
  const existing = readCollection(collection, []);
  const index = new Map(existing.map((r) => [keyFn(r), r]));
  let upserted = 0;
  for (const raw of rows) {
    const mapped = mapFn(raw);
    if (!mapped) continue;
    const key = keyFn(mapped);
    const prev = index.get(key);
    if (prev) {
      Object.assign(prev, mapped, { id: prev.id });
    } else {
      mapped.id = nextId(existing);
      existing.push(mapped);
      index.set(key, mapped);
    }
    upserted += 1;
  }
  writeCollection(collection, existing);
  return upserted;
}

async function upsertByKeyPersisted(collection, rows, keyFn, mapFn) {
  // ATC is cloud-only and may be updated outside this process — always merge from live cloud.
  if (collection === 'atc_snapshots' && useSupabase()) {
    try {
      await refreshFromSupabase('atc_snapshots');
    } catch (e) {
      console.error('[upload] refresh atc_snapshots failed:', e.message);
    }
  }
  const existing = readCollection(collection, []);
  const index = new Map(existing.map((r) => [keyFn(r), r]));
  let upserted = 0;
  for (const raw of rows) {
    const mapped = mapFn(raw);
    if (!mapped) continue;
    const key = keyFn(mapped);
    const prev = index.get(key);
    if (prev) {
      Object.assign(prev, mapped, { id: prev.id });
    } else {
      mapped.id = nextId(existing);
      existing.push(mapped);
      index.set(key, mapped);
    }
    upserted += 1;
  }
  const cloud = await writeCollectionAndPersist(collection, existing);
  return { upserted, cloud };
}

function resolveDivision(cccCode) {
  const offices = readCollection('offices', []);
  const ccc = offices.find((o) => o.office_type === 'ccc' && String(o.code) === String(cccCode));
  return ccc ? ccc.division_code : '';
}

function createBatch(module, req, rowCount, period) {
  const batches = readCollection('upload_batches', []);
  const batch = {
    id: nextId(batches),
    module,
    filename: req.body.filename || '',
    uploaded_by: req.user.username,
    row_count: rowCount,
    error_count: 0,
    period_label: period || '',
    notes: req.body.notes || '',
    created_at: new Date().toISOString(),
  };
  batches.unshift(batch);
  writeCollection('upload_batches', batches);
  return batch;
}

async function createBatchPersisted(module, req, rowCount, period) {
  const batches = readCollection('upload_batches', []);
  const batch = {
    id: nextId(batches),
    module,
    filename: req.body.filename || '',
    uploaded_by: req.user.username,
    row_count: rowCount,
    error_count: 0,
    period_label: period || '',
    notes: req.body.notes || '',
    created_at: new Date().toISOString(),
  };
  batches.unshift(batch);
  const cloud = await writeCollectionAndPersist('upload_batches', batches);
  return { batch, cloud };
}

app.post('/api/upload/:module', requireAuth, async (req, res) => {
  const module = req.params.module;
  const moduleId = uploadRouteToModule(module);
  if (!moduleId) return res.status(400).json({ error: 'Unknown module' });
  if (!canUpload(req.user, moduleId)) {
    return res.status(403).json({ error: `No upload permission for ${moduleId}` });
  }

  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'No rows' });

  if (module === 'atc') {
    const iaCccPeriods = new Set();
    const iaDivPeriods = new Set();
    for (const raw of rows) {
      const fmt = String(raw.source_format || 'IA').toUpperCase() === 'IB' ? 'IB' : 'IA';
      if (fmt !== 'IA') continue;
      const period_label = String(raw.period_label || req.body.period_label || '').trim();
      const office_type = String(raw.office_type || '').toLowerCase();
      if (!period_label) continue;
      if (office_type === 'ccc') iaCccPeriods.add(period_label);
      if (office_type === 'division') iaDivPeriods.add(period_label);
    }
    const missingDiv = [...iaCccPeriods].filter((p) => !iaDivPeriods.has(p));
    const focus = String(req.body.period_label || '').trim();
    const badFocus = focus ? missingDiv.filter((p) => p === focus) : missingDiv;
    if (badFocus.length) {
      return res.status(400).json({
        error: `Excl. Bulk missing Division TOTAL for ${badFocus.join(', ')}. Hard-refresh Upload (Ctrl+F5), re-drop the Format-IA file, and confirm the parse message shows division rows.`,
      });
    }
  }

  const { batch } = await createBatchPersisted(module, req, rows.length, req.body.period_label);
  let upserted = 0;
  let cloud = { store: storeMode(), persisted: !useSupabase() };

  const run = async (collection, keyFn, mapFn) => {
    const result = await upsertByKeyPersisted(collection, rows, keyFn, mapFn);
    upserted = result.upserted;
    cloud = result.cloud;
  };

  if (module === 'nsc') {
    await run(
      'nsc_cases',
      (r) => r.application_no,
      (raw) => {
        const application_no = String(raw.application_no || raw.ApplicationNo || raw['Application No'] || '').trim();
        const ccc_code = String(raw.ccc_code || raw.CCC || raw['CCC Code'] || '').trim();
        if (!application_no || !ccc_code) return null;
        return {
          application_no,
          consumer_name: raw.consumer_name || raw.Name || '',
          ccc_code,
          division_code: raw.division_code || resolveDivision(ccc_code),
          region_code: '341',
          applied_on: raw.applied_on || raw.Date || null,
          status: String(raw.status || 'pending').toLowerCase(),
          stage: raw.stage || '',
          delay_days: Number(raw.delay_days || raw.Delay || 0),
          load_kw: Number(raw.load_kw || raw.Load || 0),
          category: raw.category || raw.Category || '',
          remarks: raw.remarks || '',
          batch_id: batch.id,
          updated_at: new Date().toISOString(),
        };
      }
    );
  } else if (module === 'disco') {
    await run(
      'disconnections',
      (r) => `${r.consumer_id}|${r.disco_date || ''}`,
      (raw) => {
        const consumer_id = String(raw.consumer_id || raw.ConsumerID || raw['Consumer ID'] || '').trim();
        const ccc_code = String(raw.ccc_code || raw.CCC || raw['CCC Code'] || '').trim();
        if (!consumer_id || !ccc_code) return null;
        return {
          consumer_id,
          consumer_name: raw.consumer_name || raw.Name || '',
          ccc_code,
          division_code: raw.division_code || resolveDivision(ccc_code),
          region_code: '341',
          disco_date: raw.disco_date || raw.Date || null,
          amount_due: Number(raw.amount_due || raw.Amount || 0),
          status: String(raw.status || 'pending').toLowerCase(),
          reconnect_date: raw.reconnect_date || null,
          remarks: raw.remarks || '',
          batch_id: batch.id,
          updated_at: new Date().toISOString(),
        };
      }
    );
  } else if (module === 'grievance') {
    await run(
      'grievances',
      (r) => r.docket_no,
      (raw) => {
        const docket_no = String(raw.docket_no || raw.Docket || raw['Docket No'] || '').trim();
        const ccc_code = String(raw.ccc_code || raw.CCC || raw['CCC Code'] || '').trim();
        if (!docket_no || !ccc_code) return null;
        return {
          docket_no,
          consumer_id: raw.consumer_id || '',
          consumer_name: raw.consumer_name || raw.Name || '',
          ccc_code,
          division_code: raw.division_code || resolveDivision(ccc_code),
          region_code: '341',
          category: raw.category || 'Other',
          lodged_on: raw.lodged_on || raw.Date || null,
          status: String(raw.status || 'open').toLowerCase(),
          aging_days: Number(raw.aging_days || raw.Aging || 0),
          priority: raw.priority || 'normal',
          remarks: raw.remarks || '',
          batch_id: batch.id,
          updated_at: new Date().toISOString(),
        };
      }
    );
  } else if (module === 'tech-works') {
    await run(
      'tech_works',
      (r) => r.work_id,
      (raw) => {
        const work_id = String(raw.work_id || raw.WorkID || raw['Work ID'] || '').trim();
        if (!work_id) return null;
        const ccc_code = String(raw.ccc_code || raw.CCC || '').trim();
        return {
          work_id,
          title: raw.title || raw.Title || work_id,
          ccc_code,
          division_code: raw.division_code || resolveDivision(ccc_code) || String(raw.Division || ''),
          region_code: '341',
          priority: raw.priority || 'medium',
          status: String(raw.status || 'open').toLowerCase(),
          vendor_name: raw.vendor_name || raw.Vendor || '',
          billing_status: String(raw.billing_status || 'pending').toLowerCase(),
          target_date: raw.target_date || null,
          completed_on: raw.completed_on || null,
          remarks: raw.remarks || '',
          batch_id: batch.id,
          updated_at: new Date().toISOString(),
        };
      }
    );
  } else if (module === 'spot-billing') {
    await run(
      'spot_billing',
      (r) => `${r.period_label}|${r.ccc_code}|${r.consumer_class}`,
      (raw) => {
        const ccc_code = String(raw.ccc_code || raw.CCC || raw['CCC Code'] || '').trim();
        const period_label = String(raw.period_label || req.body.period_label || "Aug'26").trim();
        if (!ccc_code) return null;
        const target = Number(raw.target_count || raw.Target || 0);
        const billed = Number(raw.billed_count || raw.Billed || 0);
        return {
          period_label,
          ccc_code,
          division_code: raw.division_code || resolveDivision(ccc_code),
          region_code: '341',
          consumer_class: raw.consumer_class || raw.Class || 'Domestic',
          target_count: target,
          billed_count: billed,
          unbilled_count: Number(raw.unbilled_count || Math.max(0, target - billed)),
          batch_id: batch.id,
          updated_at: new Date().toISOString(),
        };
      }
    );
  } else if (module === 'consumers') {
    await run(
      'consumer_master',
      (r) => r.consumer_id,
      (raw) => {
        const consumer_id = String(raw.consumer_id || raw.ConsumerID || raw['Consumer ID'] || '').trim();
        const ccc_code = String(raw.ccc_code || raw.CCC || raw['CCC Code'] || '').trim();
        if (!consumer_id || !ccc_code) return null;
        return {
          consumer_id,
          name: raw.name || raw.Name || '',
          ccc_code,
          division_code: raw.division_code || resolveDivision(ccc_code),
          region_code: '341',
          consumer_class: raw.consumer_class || raw.Class || '',
          status: raw.status || 'active',
          meter_no: raw.meter_no || raw.Meter || '',
          address: raw.address || '',
          updated_at: new Date().toISOString(),
        };
      }
    );
  } else if (module === 'bulk') {
    await run(
      'bulk_consumers',
      (r) => r.consumer_id,
      (raw) => {
        const consumer_id = String(raw.consumer_id || raw.ConsumerID || '').trim();
        if (!consumer_id) return null;
        return {
          consumer_id,
          name: raw.name || raw.Name || consumer_id,
          division_code: String(raw.division_code || raw.Division || ''),
          ccc_code: String(raw.ccc_code || raw.CCC || ''),
          contract_demand: Number(raw.contract_demand || raw.CD || 0),
          voltage_level: raw.voltage_level || raw.Voltage || '',
          category: raw.category || '',
          status: raw.status || 'active',
          notes: raw.notes || '',
          updated_at: new Date().toISOString(),
        };
      }
    );
  } else if (module === 'atc') {
    const { periodSortKey, isDroScopedOffice } = require('./atc_parse');
    await run(
      'atc_snapshots',
      (r) => `${r.period_label}|${r.source_format || 'IA'}|${r.office_code}`,
      (raw) => {
        const office_code = String(raw.office_code || raw.Code || raw['CCC Code'] || '').trim();
        const period_label = String(raw.period_label || req.body.period_label || '').trim();
        if (!office_code || !period_label) return null;
        if (!isDroScopedOffice(office_code)) return null;
        const source_format = String(raw.source_format || 'IA').toUpperCase() === 'IB' ? 'IB' : 'IA';
        const office_type = raw.office_type || raw.Type || 'ccc';
        const now = new Date().toISOString();
        const n = (v) => {
          if (v == null || v === '') return null;
          const x = Number(v);
          return Number.isFinite(x) ? x : null;
        };
        return {
          period_label,
          period_sort: raw.period_sort || periodSortKey(period_label),
          target_fy: raw.target_fy || '',
          source_format,
          basis_label:
            raw.basis_label ||
            (source_format === 'IB'
              ? 'Format-IB (Div/Reg excl. bulk path)'
              : 'Format-IA (CCC path)'),
          office_type,
          office_code,
          office_name: raw.office_name || raw.Name || officeName(office_code),
          division_code:
            raw.division_code ||
            (office_type === 'division' ? office_code : office_type === 'ccc' ? office_code.slice(0, 4) : ''),
          division_name: raw.division_name || '',
          region_code: raw.region_code || '341',
          ccc_code: raw.ccc_code || (office_type === 'ccc' ? office_code : ''),
          consumer_count: n(raw.consumer_count ?? raw.Consumers),
          target_atc: n(raw.target_atc),
          target_dist: n(raw.target_dist),
          atc_mar: n(raw.atc_mar),
          dist_mar: n(raw.dist_mar),
          atc_yoy: n(raw.atc_yoy),
          dist_yoy: n(raw.dist_yoy),
          input_mu: n(raw.input_mu),
          demand_mu: n(raw.demand_mu),
          collection_mu: n(raw.collection_mu),
          atc_loss: n(raw.atc_loss ?? raw.ATC),
          dist_loss: n(raw.dist_loss ?? raw.Dist),
          coll_eff: n(raw.coll_eff ?? raw.CollEff),
          coll_eff_mar: n(raw.coll_eff_mar),
          coll_eff_yoy: n(raw.coll_eff_yoy),
          point_source: raw.point_source || null,
          batch_id: batch.id,
          updated_at: now,
          created_at: now,
        };
      }
    );
  }

  logActivity(req.user.username, 'upload', `${module}: ${upserted} rows (${req.body.filename || 'file'})`);
  res.json({
    ok: true,
    upserted,
    batch,
    store: cloud.store || storeMode(),
    cloud,
  });
});

// ——— Admin users ———
app.get('/api/users', requireAuth, requireAdmin, (req, res) => {
  res.json({ users: readUsers().map(publicUser), modules: MODULES });
});

app.post('/api/users', requireAuth, requireAdmin, (req, res) => {
  const { fullPerms } = require('./permissions');
  const users = readCollection('portal_users', []);
  const username = String(req.body.username || '').trim();
  if (!username) return res.status(400).json({ error: 'Username required' });
  if (users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ error: 'Username exists' });
  }
  const role = req.body.role || 'viewer';
  const user = {
    id: nextId(users),
    username,
    pin: String(req.body.pin || '0000'),
    name: String(req.body.name || username),
    role,
    zone_code: req.body.zone_code || '34',
    region_code: req.body.region_code || '341',
    division_code: req.body.division_code || '',
    ccc_code: req.body.ccc_code || '',
    permissions: role === 'admin' ? fullPerms() : normalizePermissions(req.body.permissions || emptyPerms()),
    last_login: null,
  };
  users.push(user);
  writeCollection('portal_users', users);
  logActivity(req.user.username, 'user_create', username);
  res.json({ user: publicUser(user) });
});

app.put('/api/users/:username', requireAuth, requireAdmin, (req, res) => {
  const users = readCollection('portal_users', []);
  const idx = users.findIndex((u) => u.username === req.params.username);
  if (idx < 0) return res.status(404).json({ error: 'Not found' });
  const prev = users[idx];
  const { fullPerms } = require('./permissions');
  if (req.body.pin !== undefined) prev.pin = String(req.body.pin);
  if (req.body.name !== undefined) prev.name = String(req.body.name);
  if (req.body.role !== undefined) prev.role = String(req.body.role);
  if (req.body.zone_code !== undefined) prev.zone_code = String(req.body.zone_code);
  if (req.body.region_code !== undefined) prev.region_code = String(req.body.region_code);
  if (req.body.division_code !== undefined) prev.division_code = String(req.body.division_code);
  if (req.body.ccc_code !== undefined) prev.ccc_code = String(req.body.ccc_code);
  if (req.body.permissions !== undefined) {
    prev.permissions = prev.role === 'admin' || req.body.role === 'admin'
      ? fullPerms()
      : normalizePermissions(req.body.permissions);
  } else if (req.body.role === 'admin') {
    prev.permissions = fullPerms();
  }
  // drop legacy flat flags if present
  [
    'mod_nsc', 'mod_disco', 'mod_grievance', 'mod_tech_works', 'mod_spot_billing', 'mod_bulk',
    'upload_nsc', 'upload_disco', 'upload_grievance', 'upload_tech_works', 'upload_spot_billing',
    'upload_consumer_master', 'upload_bulk',
  ].forEach((k) => delete prev[k]);
  writeCollection('portal_users', users);
  logActivity(req.user.username, 'user_update', prev.username);
  res.json({ user: publicUser(prev) });
});

app.delete('/api/users/:username', requireAuth, requireAdmin, (req, res) => {
  if (req.params.username === 'admin') return res.status(400).json({ error: 'Cannot delete admin' });
  let users = readCollection('portal_users', []);
  users = users.filter((u) => u.username !== req.params.username);
  writeCollection('portal_users', users);
  logActivity(req.user.username, 'user_delete', req.params.username);
  res.json({ ok: true });
});

// ——— Patch status helpers (edit permission) ———
app.patch('/api/nsc/:application_no', requireAuth, requirePerm('nsc', 'edit'), (req, res) => {
  const rows = readCollection('nsc_cases', []);
  const row = rows.find((r) => r.application_no === req.params.application_no);
  if (!row || !scopeFilter(req.user, row)) return res.status(404).json({ error: 'Not found' });
  if (req.body.status) row.status = req.body.status;
  if (req.body.remarks !== undefined) row.remarks = req.body.remarks;
  row.updated_at = new Date().toISOString();
  writeCollection('nsc_cases', rows);
  res.json({ row });
});

app.patch('/api/disco/:id', requireAuth, requirePerm('disco', 'edit'), (req, res) => {
  const rows = readCollection('disconnections', []);
  const row = rows.find((r) => String(r.id) === String(req.params.id));
  if (!row || !scopeFilter(req.user, row)) return res.status(404).json({ error: 'Not found' });
  if (req.body.status) row.status = req.body.status;
  if (req.body.reconnect_date !== undefined) row.reconnect_date = req.body.reconnect_date;
  row.updated_at = new Date().toISOString();
  writeCollection('disconnections', rows);
  res.json({ row });
});

app.patch('/api/grievances/:docket_no', requireAuth, requirePerm('grievance', 'edit'), (req, res) => {
  const rows = readCollection('grievances', []);
  const row = rows.find((r) => r.docket_no === req.params.docket_no);
  if (!row || !scopeFilter(req.user, row)) return res.status(404).json({ error: 'Not found' });
  ['status', 'priority', 'remarks', 'aging_days'].forEach((k) => {
    if (req.body[k] !== undefined) row[k] = req.body[k];
  });
  row.updated_at = new Date().toISOString();
  writeCollection('grievances', rows);
  res.json({ row });
});

app.patch('/api/tech-works/:work_id', requireAuth, requirePerm('tech_works', 'edit'), (req, res) => {
  const rows = readCollection('tech_works', []);
  const row = rows.find((r) => r.work_id === req.params.work_id);
  if (!row || !scopeFilter(req.user, row)) return res.status(404).json({ error: 'Not found' });
  ['status', 'billing_status', 'remarks', 'completed_on'].forEach((k) => {
    if (req.body[k] !== undefined) row[k] = req.body[k];
  });
  row.updated_at = new Date().toISOString();
  writeCollection('tech_works', rows);
  res.json({ row });
});

app.patch('/api/bulk/:consumer_id', requireAuth, requirePerm('bulk', 'edit'), (req, res) => {
  const rows = readCollection('bulk_consumers', []);
  const row = rows.find((r) => r.consumer_id === req.params.consumer_id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  ['name', 'status', 'contract_demand', 'voltage_level', 'category', 'notes', 'division_code', 'ccc_code'].forEach((k) => {
    if (req.body[k] !== undefined) row[k] = req.body[k];
  });
  row.updated_at = new Date().toISOString();
  writeCollection('bulk_consumers', rows);
  res.json({ row });
});

// Static production serve
const webDist = path.join(__dirname, '..', '..', 'apps', 'web', 'dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(webDist, 'index.html'));
  });
}

const initPromise = initStore()
  .then(() => {
    ensureSeeded();
  })
  .catch((e) => {
    console.error('[DRO] initStore failed:', e);
  });

if (require.main === module) {
  initPromise.then(() => {
    app.listen(PORT, () => {
      console.log(`DRO Ops API on http://localhost:${PORT}`);
      console.log(`[DRO] data store: ${storeMode()}${useSupabase() ? ' (' + sb.status().host + ')' : ''}`);
    });
  });
}

module.exports = app;
module.exports.initPromise = initPromise;
