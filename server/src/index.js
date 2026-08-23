const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const express = require('express');
const cookieSession = require('cookie-session');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const multer = require('multer');
const nscLib = require('./nsc_parse');
const {
  readCollection,
  writeCollection,
  writeCollectionAndPersist,
  nextId,
  scopeFilter,
  readUsers,
  initStore,
  ensureCollection,
  isNscLoaded,
  refreshFromSupabase,
  storeMode,
  useSupabase,
  isReady,
  isAuthReady,
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
  isAdmin,
} = require('./permissions');
const { seedAll, sampleSubstations } = require('./seed_lib');

const PORT = process.env.PORT || 8787;
const app = express();

const nscTmpDir = path.join(os.tmpdir(), 'dro-nsc');
fs.mkdirSync(nscTmpDir, { recursive: true });
const nscUpload = multer({
  dest: nscTmpDir,
  limits: { fileSize: 60 * 1024 * 1024 },
});

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
  cookieSession({
    name: 'dro_sid',
    keys: [process.env.SESSION_SECRET || 'dro-ops-dev-secret-change-me'],
    maxAge: 1000 * 60 * 60 * 12,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.VERCEL === '1' || process.env.NODE_ENV === 'production',
  })
);

let resolveAuthReady;
const initAuthPromise = new Promise((resolve) => {
  resolveAuthReady = resolve;
});
const initPromise = initStore({
  onAuthReady: () => resolveAuthReady(),
})
  .then(() => {
    ensureSeeded();
    resolveAuthReady();
    console.log('[DRO] store ready');
  })
  .catch((e) => {
    resolveAuthReady();
    console.error('[DRO] initStore failed:', e);
    throw e;
  });

const AUTH_PATHS = new Set(['/api/login', '/api/session', '/api/logout', '/api/health']);

app.use((req, res, next) => {
  if (!req.path.startsWith('/api') || req.path === '/api/health') return next();
  const authOnly = AUTH_PATHS.has(req.path);
  if (authOnly) {
    if (isAuthReady()) return next();
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        res.status(503).json({ error: 'API is starting. Wait a moment and retry.' });
      }
    }, 20000);
    initAuthPromise
      .then(() => {
        clearTimeout(timer);
        if (!res.headersSent) next();
      })
      .catch((e) => {
        clearTimeout(timer);
        if (!res.headersSent) res.status(503).json({ error: e.message || 'Store failed to start' });
      });
    return;
  }
  if (isReady()) return next();
  const timer = setTimeout(() => {
    if (!res.headersSent) {
      res.status(503).json({ error: 'API is still starting. Wait a few seconds and retry.' });
    }
  }, 30000);
  initPromise
    .then(() => {
      clearTimeout(timer);
      if (!res.headersSent) next();
    })
    .catch((e) => {
      clearTimeout(timer);
      if (!res.headersSent) res.status(503).json({ error: e.message || 'Store failed to start' });
    });
});

function clearSession(req) {
  req.session = null;
}

function ensureSeeded() {
  const offices = readCollection('offices', null);
  if (!offices || !offices.length) {
    const mapPath = path.join(__dirname, '..', '..', 'data', 'office_map.json');
    if (fs.existsSync(mapPath)) {
      seedAll(null);
      console.log('[DRO] Auto-seeded from data/office_map.json');
    }
  }
  const substations = readCollection('substations', []);
  if (!Array.isArray(substations) || !substations.length) {
    writeCollection('substations', sampleSubstations());
    console.log('[DRO] Seeded 33/11 kV substations under DRO divisions');
  }
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    ready: isReady(),
    auth_ready: isAuthReady(),
    store: storeMode(),
    supabase: sb.status(),
  });
});

app.get('/api/powermap/config', requireAuth, async (req, res) => {
  const pub = sb.publicPowerMapConfig();
  let live = { ok: false, reason: 'not probed' };
  try {
    live = await sb.probePowerMap();
  } catch (e) {
    live = { ok: false, reason: e.message || 'probe failed' };
  }
  const schema =
    String(live.table || '').startsWith('powermap.') || String(live.table || '') === 'v_substations'
      ? 'powermap'
      : String(live.table || '').startsWith('pm_')
        ? 'public'
        : pub.schema;
  res.json({ ...pub, schema, live });
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
    clearSession(req);
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

function officeNameMap() {
  const offices = readCollection('offices', []);
  return new Map(offices.map((o) => [String(o.code), o.name]));
}

function enrichRows(rows) {
  const names = officeNameMap();
  return rows.map((r) => {
    if (r.ccc_name && r.division_name) return r;
    return {
      ...r,
      ccc_name: r.ccc_name || (r.ccc_code ? names.get(String(r.ccc_code)) || r.ccc_code : ''),
      division_name: r.division_name || (r.division_code ? names.get(String(r.division_code)) || r.division_code : ''),
    };
  });
}

function droCccList() {
  const offices = readCollection('offices', []);
  const divs = officeNameMap();
  return offices
    .filter((o) => o.office_type === 'ccc')
    .map((o) => ({
      code: String(o.code),
      name: o.name,
      division_code: String(o.division_code || ''),
      division_name: divs.get(String(o.division_code)) || o.division_code || '',
    }));
}

function filterScoped(user, rows) {
  return enrichRows(rows.filter((r) => scopeFilter(user, r)));
}

function nscScopeQuery(user) {
  const role = String(user?.role || '').toLowerCase();
  if (role === 'ccc' && user.ccc_code) return `ccc_code=eq.${encodeURIComponent(user.ccc_code)}`;
  if (role === 'division' && user.division_code) {
    return `division_code=eq.${encodeURIComponent(user.division_code)}`;
  }
  return '';
}

function joinQs(...parts) {
  return parts.filter(Boolean).join('&');
}

async function nscCounts(user) {
  if (isNscLoaded()) {
    const nsc = filterScoped(user, readCollection('nsc_cases', []));
    return {
      pending: nsc.filter((r) => nscLib.isPendingQueue(r)).length,
      withheld: nsc.filter((r) => String(r.status || '').toLowerCase() === 'withheld').length,
    };
  }
  if (!useSupabase()) return { pending: 0, withheld: 0 };
  const scope = nscScopeQuery(user);
  const [pending, withheld] = await Promise.all([
    sb.countRows('nsc_cases', joinQs('status=eq.pending', scope)),
    sb.countRows('nsc_cases', joinQs('status=eq.withheld', scope)),
  ]);
  return { pending, withheld };
}

async function kpiPulse(user) {
  const nsc = await nscCounts(user);
  const disco = filterScoped(user, readCollection('disconnections', []));
  const griev = filterScoped(user, readCollection('grievances', [])).filter((r) => !isDemoGrievance(r));
  const tech = filterScoped(user, readCollection('tech_works', []));
  const spot = filterScoped(user, readCollection('spot_billing', []));
  const consumers = filterScoped(user, readCollection('consumer_master', []));
  const offices = readCollection('offices', []);
  const cccs = offices.filter((o) => o.office_type === 'ccc' && scopeFilter(user, o));

  const spotTarget = spot.reduce((s, r) => s + (r.target_count || 0), 0);
  const spotBilled = spot.reduce((s, r) => s + (r.billed_count || 0), 0);

  return {
    pending_nsc: nsc.pending,
    withheld_nsc: nsc.withheld,
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
  if (u) logActivity(u, 'logout', 'Signed out');
  clearSession(req);
  res.clearCookie('dro_sid');
  res.json({ ok: true });
});

app.get('/api/session', (req, res) => {
  if (!req.session?.user) return res.json({ user: null });
  const users = readUsers();
  const fresh = users.find((u) => u.username === req.session.user.username);
  if (!fresh) {
    clearSession(req);
    return res.json({ user: null });
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
app.get('/api/pulse', requireAuth, async (req, res) => {
  try {
    res.json({ pulse: await kpiPulse(req.user) });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Pulse failed' });
  }
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

function filterSubstations(user, rows) {
  const role = String(user?.role || '').toLowerCase();
  if (role === 'admin' || role === 'region') return rows;
  const div = String(user?.division_code || '').trim();
  if (!div) return [];
  return rows.filter((r) => String(r.division_code || '') === div);
}

function hydrateSubstation(row, offices) {
  const list = offices || readCollection('offices', []);
  const div = list.find((o) => o.office_type === 'division' && String(o.code) === String(row.division_code || ''));
  const ccc = list.find((o) => o.office_type === 'ccc' && String(o.code) === String(row.ccc_code || ''));
  return {
    ...row,
    division_name: div?.name || row.division_name || '',
    ccc_name: ccc?.name || row.ccc_name || '',
  };
}

app.get('/api/substations', requireAuth, (req, res) => {
  const offices = readCollection('offices', []);
  const rows = filterSubstations(req.user, readCollection('substations', [])).map((r) =>
    hydrateSubstation(r, offices)
  );
  const byDivision = {};
  for (const r of rows) {
    const key = String(r.division_code || 'unassigned');
    if (!byDivision[key]) {
      byDivision[key] = { division_code: key, division_name: r.division_name || key, count: 0, capacity_mva: 0 };
    }
    byDivision[key].count += 1;
    byDivision[key].capacity_mva += Number(r.capacity_mva) || 0;
  }
  res.json({
    rows,
    total: rows.length,
    by_division: Object.values(byDivision).map((d) => ({
      ...d,
      capacity_mva: Math.round(d.capacity_mva * 100) / 100,
    })),
    can_edit: String(req.user?.role || '').toLowerCase() === 'admin',
  });
});

const SS_FIELDS = [
  'name',
  'voltage_kv',
  'capacity_mva',
  'division_code',
  'ccc_code',
  'district',
  'latitude',
  'longitude',
  'feeder_count',
  'status',
  'commissioned_on',
  'remarks',
];

function applySubstationPatch(row, body, offices) {
  const next = { ...row };
  for (const key of SS_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    let val = body[key];
    if (key === 'capacity_mva' || key === 'latitude' || key === 'longitude' || key === 'feeder_count') {
      if (val === '' || val == null) val = key === 'feeder_count' ? null : null;
      else {
        const n = Number(val);
        val = Number.isFinite(n) ? n : row[key];
      }
    } else if (val == null) {
      val = '';
    } else {
      val = String(val).trim();
    }
    next[key] = val;
  }
  const div = offices.find((o) => o.office_type === 'division' && String(o.code) === String(next.division_code || ''));
  const ccc = offices.find((o) => o.office_type === 'ccc' && String(o.code) === String(next.ccc_code || ''));
  next.division_name = div?.name || next.division_name || '';
  next.ccc_name = ccc?.name || '';
  if (ccc && String(ccc.division_code) !== String(next.division_code)) {
    next.ccc_code = '';
    next.ccc_name = '';
  }
  next.updated_at = new Date().toISOString();
  return next;
}

app.post('/api/substations', requireAuth, requireAdmin, (req, res) => {
  const offices = readCollection('offices', []);
  const rows = readCollection('substations', []);
  const row = applySubstationPatch(
    {
      id: nextId(rows),
      voltage_kv: '33/11',
      status: 'in_service',
      source: 'DRO admin',
      district: 'Darjeeling',
    },
    req.body || {},
    offices
  );
  if (!row.name) return res.status(400).json({ error: 'Name is required' });
  rows.push(row);
  writeCollection('substations', rows);
  logActivity(req.user.username, 'substation_create', row.name);
  res.json({ row: hydrateSubstation(row, offices) });
});

app.patch('/api/substations/:id', requireAuth, requireAdmin, (req, res) => {
  const offices = readCollection('offices', []);
  const rows = readCollection('substations', []);
  const idx = rows.findIndex((r) => String(r.id) === String(req.params.id));
  if (idx < 0) return res.status(404).json({ error: 'Not found' });
  const row = applySubstationPatch(rows[idx], req.body || {}, offices);
  if (!row.name) return res.status(400).json({ error: 'Name is required' });
  rows[idx] = row;
  writeCollection('substations', rows);
  logActivity(req.user.username, 'substation_update', row.name);
  res.json({ row: hydrateSubstation(row, offices) });
});

app.delete('/api/substations/:id', requireAuth, requireAdmin, (req, res) => {
  const rows = readCollection('substations', []);
  const idx = rows.findIndex((r) => String(r.id) === String(req.params.id));
  if (idx < 0) return res.status(404).json({ error: 'Not found' });
  const [removed] = rows.splice(idx, 1);
  writeCollection('substations', rows);
  logActivity(req.user.username, 'substation_delete', removed.name);
  res.json({ ok: true });
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

function nscQueryFromReq(req) {
  return {
    queue: req.query.queue,
    clock: req.query.clock,
    division: req.query.division,
    ccc: req.query.ccc,
    class: req.query.class,
    slab: req.query.slab,
    time: req.query.time,
    q: req.query.q,
    status: req.query.status,
  };
}

app.get('/api/nsc', requireAuth, async (req, res) => {
  if (!canView(req.user, 'nsc')) {
    return res.status(403).json({ error: 'No view permission for nsc' });
  }
  await ensureCollection('nsc_cases');
  const rows = filterScoped(req.user, readCollection('nsc_cases', []));
  const q = nscQueryFromReq(req);
  let out = nscLib.filterNscRows(rows, q);
  if (q.status) {
    out = out.filter((r) => String(r.status) === String(q.status) || String(r.sap_status) === String(q.status));
  }
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 80));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  res.json({
    rows: out.slice(offset, offset + limit).map(nscLib.nscListRow),
    total: out.length,
    limit,
    offset,
    report_date: rows[0]?.report_date || null,
    can_edit: canEdit(req.user, 'nsc'),
    can_upload: canUpload(req.user, 'nsc'),
  });
});

app.get('/api/nsc/desk', requireAuth, requirePerm('nsc', 'view'), async (req, res) => {
  await ensureCollection('nsc_cases');
  const rows = filterScoped(req.user, readCollection('nsc_cases', []));
  res.json(nscLib.buildNscDesk(rows, nscQueryFromReq(req)));
});

app.get('/api/nsc/export', requireAuth, requirePerm('nsc', 'view'), async (req, res) => {
  req.setTimeout(180000);
  res.setTimeout(180000);
  await ensureCollection('nsc_cases');
  const rows = filterScoped(req.user, readCollection('nsc_cases', []));
  const filtered = nscLib.filterNscRows(rows, nscQueryFromReq(req));
  const cols = Object.keys(nscLib.nscExportRow({}));
  const header = cols.join(',');
  const body = filtered
    .map((r) => {
      const o = nscLib.nscExportRow(r);
      return cols.map((k) => `"${String(o[k] ?? '').replace(/"/g, '""')}"`).join(',');
    })
    .join('\n');
  const queue = String(req.query.queue || 'all');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="nsc_${queue}.csv"`);
  res.send(`${header}\n${body}`);
});
app.get('/api/disco', requireAuth, listModule('disconnections', 'disco'));
function isDemoGrievance(r) {
  const name = String(r.consumer_name || r.complainant_name || '');
  const ref = String(r.complaint_id || r.docket_no || '');
  if (/^CG\/\d{4}\/\d{4}$/i.test(ref)) return false;
  if (/^Complainant\s+\d+$/i.test(name)) return true;
  if (/^DKT-/i.test(ref)) return true;
  if (/^C34120\d{3}$/i.test(String(r.consumer_id || ''))) return true;
  return false;
}

app.get('/api/grievances', requireAuth, requirePerm('grievance', 'view'), (req, res) => {
  let rows = readCollection('grievances', []);
  const kept = rows.filter((r) => !isDemoGrievance(r));
  if (kept.length !== rows.length) {
    writeCollection('grievances', kept);
    rows = kept;
  }
  let out = filterScoped(req.user, rows);
  const division = req.query.division;
  const ccc = req.query.ccc;
  const status = req.query.status;
  if (division) out = out.filter((r) => String(r.division_code) === String(division));
  if (ccc) out = out.filter((r) => String(r.ccc_code) === String(ccc));
  if (status) out = out.filter((r) => String(r.status) === String(status));
  res.json({
    rows: out,
    total: out.length,
    can_edit: canEdit(req.user, 'grievance'),
    can_upload: canUpload(req.user, 'grievance'),
  });
});
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

  const inferOfficeType = (code, hinted) => {
    if (hinted) return hinted;
    const c = String(code || '').trim();
    if (c === '34') return 'zone';
    if (c === '341') return 'region';
    if (/^341[2-5]$/.test(c)) return 'division';
    if (/^341[2-5]\d{3}$/.test(c)) return 'ccc';
    return hinted || '';
  };

  rows = rows.map((r) => {
    const office_code = String(r.office_code || '').trim();
    const office_type = inferOfficeType(office_code, r.office_type);
    return {
      ...r,
      office_code,
      office_type,
      ccc_code: r.ccc_code || (office_type === 'ccc' ? office_code : ''),
      division_code:
        r.division_code ||
        (office_type === 'division' ? office_code : office_type === 'ccc' ? office_code.slice(0, 4) : ''),
      region_code: r.region_code || '341',
    };
  });

  let out = rows.filter((r) => scopeFilter(req.user, r));

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

app.get('/api/nsc/summary', requireAuth, requirePerm('nsc', 'view'), async (req, res) => {
  try {
    if (!isNscLoaded() && useSupabase()) {
      const offices = readCollection('offices', []).filter(
        (o) => o.office_type === 'division' && scopeFilter(req.user, o)
      );
      const scope = nscScopeQuery(req.user);
      const jobs = [
        sb.countRows('nsc_cases', joinQs('status=eq.pending', scope)),
        sb.countRows('nsc_cases', joinQs('status=eq.withheld', scope)),
      ];
      for (const d of offices) {
        const extra = String(req.user.role || '').toLowerCase() === 'ccc' ? scope : '';
        jobs.push(
          sb.countRows(
            'nsc_cases',
            joinQs('status=eq.pending', `division_code=eq.${encodeURIComponent(d.code)}`, extra)
          )
        );
        jobs.push(
          sb.countRows(
            'nsc_cases',
            joinQs('status=eq.withheld', `division_code=eq.${encodeURIComponent(d.code)}`, extra)
          )
        );
      }
      const nums = await Promise.all(jobs);
      const pending = nums[0];
      const withheld = nums[1];
      const byDivision = offices.map((d, i) => ({
        division_code: d.code,
        division_name: d.name,
        pending: nums[2 + i * 2] || 0,
        withheld: nums[3 + i * 2] || 0,
        total: (nums[2 + i * 2] || 0) + (nums[3 + i * 2] || 0),
        avg_delay: 0,
      }));
      return res.json({
        byStatus: { pending, withheld },
        byDivision,
        total: pending + withheld,
        pending,
        withheld,
        report_date: null,
      });
    }
    const rows = filterScoped(req.user, readCollection('nsc_cases', []));
  const byDivision = {};
  const byStatus = {};
  let pending = 0;
  let withheld = 0;
  for (const r of rows) {
    const sap = r.sap_status || r.stage || r.status;
    byStatus[sap] = (byStatus[sap] || 0) + 1;
    const key = r.division_code || 'unknown';
    if (!byDivision[key]) {
      byDivision[key] = {
        division_code: key,
        division_name: r.division_name || officeName(key),
        pending: 0,
        withheld: 0,
        total: 0,
        avg_delay: 0,
        delay_sum: 0,
      };
    }
    byDivision[key].total += 1;
    if (nscLib.isPendingQueue(r)) {
      byDivision[key].pending += 1;
      pending += 1;
    }
    if (String(r.status) === 'withheld') {
      byDivision[key].withheld += 1;
      withheld += 1;
    }
    byDivision[key].delay_sum += Number(r.quotation_age_days ?? r.delay_days) || 0;
  }
  Object.values(byDivision).forEach((d) => {
    d.avg_delay = d.total ? Math.round(d.delay_sum / d.total) : 0;
    delete d.delay_sum;
  });
  res.json({
    byStatus,
    byDivision: Object.values(byDivision),
    total: rows.length,
    pending,
    withheld,
    report_date: rows[0]?.report_date || null,
  });
  } catch (e) {
    res.status(500).json({ error: e.message || 'NSC summary failed' });
  }
});

app.post('/api/nsc/parse', requireAuth, requirePerm('nsc', 'upload'), nscUpload.single('file'), (req, res) => {
  req.setTimeout(180000);
  res.setTimeout(180000);
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const report_date = String(req.body.report_date || '').trim().slice(0, 10);
  try {
    const { rows, preview } = nscLib.parseNscWorkbook({
      filePath: req.file.path,
      filename: req.file.originalname || req.body.filename || 'nsc.xlsb',
      reportDate: report_date,
      droCccs: droCccList(),
    });
    const parse_id = crypto.randomUUID();
    fs.writeFileSync(
      path.join(nscTmpDir, `${parse_id}.json`),
      JSON.stringify({ report_date: preview.report_date, filename: preview.filename, rows })
    );
    res.json({ ok: true, parse_id, preview });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Failed to parse NSC workbook' });
  } finally {
    try {
      fs.unlinkSync(req.file.path);
    } catch {
      /* ignore */
    }
  }
});

app.post('/api/nsc/commit', requireAuth, requirePerm('nsc', 'upload'), async (req, res) => {
  req.setTimeout(300000);
  res.setTimeout(300000);
  const parse_id = String(req.body.parse_id || '').trim();
  const staging = path.join(nscTmpDir, `${parse_id}.json`);
  if (!parse_id || !fs.existsSync(staging)) {
    return res.status(400).json({ error: 'Parse expired — drop the file again' });
  }
  try {
    const payload = JSON.parse(fs.readFileSync(staging, 'utf8'));
    const rows = (payload.rows || []).map((r, i) => ({ ...r, id: i + 1 }));
    req.body.filename = payload.filename;
    req.body.notes = `report ${payload.report_date}`;
    const { batch } = await createBatchPersisted('nsc', req, rows.length, payload.report_date);
    for (const r of rows) r.batch_id = batch.id;
    const cloud = await writeCollectionAndPersist('nsc_cases', rows);
    try {
      fs.unlinkSync(staging);
    } catch {
      /* ignore */
    }
    logActivity(req.user.username, 'upload', `nsc: ${rows.length} rows (${payload.filename || 'file'})`);
    res.json({
      ok: true,
      upserted: rows.length,
      batch,
      cloud,
      report_date: payload.report_date,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to save pending NSC' });
  }
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
  if (module === 'grievance' || moduleId === 'grievance') {
    return res.status(400).json({
      error: 'Grievances are not Excel-uploaded. Add them one by one on the Grievance desk.',
    });
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

function nextComplaintId(rows, year) {
  const y = String(year);
  const re = new RegExp(`^CG/${y}/(\\d{4})$`, 'i');
  let max = 0;
  for (const r of rows) {
    const id = String(r.complaint_id || r.docket_no || '');
    const m = id.match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `CG/${y}/${String(max + 1).padStart(4, '0')}`;
}

function parseFollowupUsers(raw) {
  const names = [
    ...new Set(
      (Array.isArray(raw) ? raw : [])
        .map((u) => String(u || '').trim())
        .filter(Boolean)
    ),
  ];
  if (!names.length) return { error: 'Pick at least one follow-up user' };
  const allowed = new Set(
    readUsers()
      .filter((u) => String(u.role || '').toLowerCase() !== 'admin')
      .map((u) => u.username)
  );
  if (names.some((n) => !allowed.has(n))) return { error: 'Invalid follow-up user' };
  return { names };
}

function canFollowupGrievance(user, row) {
  if (isAdmin(user)) return true;
  const list = Array.isArray(row.followup_users) ? row.followup_users : [];
  return list.includes(user?.username);
}

const GRIEVANCE_STATUSES = new Set(['open', 'resolved', 'closed']);
const GRIEVANCE_DONE = new Set(['resolved', 'closed']);

function canCloseGrievance(user, row) {
  if (isAdmin(user) || canEdit(user, 'grievance')) return true;
  return canFollowupGrievance(user, row);
}

app.post('/api/grievances', requireAuth, requireAdmin, (req, res) => {
  const complainant_type = String(req.body?.complainant_type || 'consumer') === 'non_consumer' ? 'non_consumer' : 'consumer';
  const consumer_id = complainant_type === 'consumer' ? String(req.body?.consumer_id || '').trim() : '';
  const complainant_name = String(req.body?.complainant_name || req.body?.consumer_name || '').trim();
  const office_code = String(req.body?.office_code || req.body?.ccc_code || '').trim();
  const short_description = String(req.body?.short_description || req.body?.remarks || '').trim();
  const type = String(req.body?.type || req.body?.category || 'other').trim().toLowerCase();
  const priority = String(req.body?.priority || 'normal').trim().toLowerCase();
  const phone = String(req.body?.complainant_phone || '').replace(/\D/g, '').slice(-10);
  if (!['billing', 'technical', 'legal', 'metering', 'supply', 'other'].includes(type)) {
    return res.status(400).json({ error: 'Invalid type' });
  }
  if (!['high', 'normal', 'low'].includes(priority)) {
    return res.status(400).json({ error: 'Invalid priority' });
  }
  if (!/^[\p{L}][\p{L} .'-]{1,59}$/u.test(complainant_name)) {
    return res.status(400).json({ error: 'Invalid name' });
  }
  if (complainant_type === 'consumer' && !/^\d{11}$/.test(consumer_id)) {
    return res.status(400).json({ error: 'Consumer ID must be 11 digits' });
  }
  if (phone && !/^[6-9]\d{9}$/.test(phone)) {
    return res.status(400).json({ error: 'Invalid phone' });
  }
  if (short_description.length < 8 || short_description.length > 240 || /[<>]/.test(short_description)) {
    return res.status(400).json({ error: 'Invalid description' });
  }
  const assigned = parseFollowupUsers(req.body?.followup_users);
  if (assigned.error) return res.status(400).json({ error: assigned.error });

  const offices = readCollection('offices', []);
  const office = offices.find(
    (o) => String(o.code) === office_code && (o.office_type === 'ccc' || o.office_type === 'division')
  );
  if (!office) return res.status(400).json({ error: 'Invalid office' });
  const now = new Date().toISOString();
  const lodged_on = String(req.body?.lodged_on || now.slice(0, 10)).slice(0, 10);
  const target_resolve_on = String(req.body?.target_resolve_on || '').slice(0, 10);
  const isoDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00`).getTime());
  const today = now.slice(0, 10);
  if (!isoDate(lodged_on) || lodged_on > today || lodged_on < '2020-01-01') {
    return res.status(400).json({ error: 'Invalid lodged date' });
  }
  if (!isoDate(target_resolve_on) || target_resolve_on < lodged_on) {
    return res.status(400).json({ error: 'Invalid target date' });
  }
  const division_code = String(
    req.body?.division_code ||
      office.division_code ||
      (office.office_type === 'division' ? office.code : office_code.slice(0, 4))
  );
  const rows = readCollection('grievances', []);
  const id = nextId(rows);
  const year = lodged_on.slice(0, 4) || String(new Date().getFullYear());
  const complaint_id = nextComplaintId(rows, year);
  const row = {
    id,
    complaint_id,
    docket_no: complaint_id,
    complainant_type,
    consumer_id,
    consumer_name: complainant_name,
    complainant_phone: phone,
    ccc_code: office?.office_type === 'ccc' ? office_code : '',
    office_code,
    office_type: office?.office_type || 'ccc',
    office_name: office?.name || office_code,
    division_code,
    region_code: '341',
    category: type,
    lodged_on,
    target_resolve_on,
    status: 'open',
    aging_days: 0,
    priority,
    remarks: short_description,
    followups: [],
    followup_users: assigned.names,
    assigned_username: assigned.names[0],
    created_by: req.user.username,
    batch_id: null,
    created_at: now,
    updated_at: now,
  };
  rows.push(row);
  writeCollection('grievances', rows);
  res.json({ row });
});

app.patch('/api/grievances/:id', requireAuth, requirePerm('grievance', 'view'), (req, res) => {
  const rows = readCollection('grievances', []);
  const key = String(req.params.id);
  const row = rows.find(
    (r) => String(r.id) === key || String(r.complaint_id) === key || String(r.docket_no) === key
  );
  if (!row || !scopeFilter(req.user, row)) return res.status(404).json({ error: 'Not found' });
  const admin = isAdmin(req.user);
  const prevStatus = String(row.status || 'open').toLowerCase();
  const nextStatus =
    req.body.status !== undefined ? String(req.body.status || '').trim().toLowerCase() : undefined;
  if (nextStatus !== undefined) {
    if (!GRIEVANCE_STATUSES.has(nextStatus)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    if (nextStatus !== prevStatus && !canCloseGrievance(req.user, row)) {
      return res.status(403).json({ error: 'Not authorized to change case status' });
    }
  }
  const editFields = ['priority', 'remarks', 'aging_days', 'target_resolve_on'];
  const wantsEdit = editFields.some((k) => req.body[k] !== undefined);
  if (wantsEdit && !admin && !canEdit(req.user, 'grievance')) {
    return res.status(403).json({ error: 'No edit permission for grievance' });
  }
  editFields.forEach((k) => {
    if (req.body[k] !== undefined) row[k] = req.body[k];
  });
  if (req.body.followup_users !== undefined) {
    if (!admin) return res.status(403).json({ error: 'Admin only' });
    const assigned = parseFollowupUsers(req.body.followup_users);
    if (assigned.error) return res.status(400).json({ error: assigned.error });
    row.followup_users = assigned.names;
    row.assigned_username = assigned.names[0];
  }
  const note = String(req.body?.followup || '').trim().slice(0, 240);
  if (note && (note.length < 3 || /[<>]/.test(note))) {
    return res.status(400).json({ error: 'Invalid follow-up' });
  }
  const now = new Date().toISOString();
  const closingNow = nextStatus !== undefined && GRIEVANCE_DONE.has(nextStatus) && nextStatus !== prevStatus;
  if (note) {
    if (GRIEVANCE_DONE.has(prevStatus) && !closingNow) {
      return res.status(400).json({ error: 'Case is already resolved or closed' });
    }
    if (!closingNow && !canFollowupGrievance(req.user, row)) {
      return res.status(403).json({ error: 'Not assigned to follow up this case' });
    }
    if (!Array.isArray(row.followups)) row.followups = [];
    row.followups.unshift({
      at: now,
      by: req.user.username,
      remark: note,
    });
    row.last_followup_on = row.followups[0].at;
    row.last_followup_by = req.user.username;
  }
  if (nextStatus !== undefined && nextStatus !== prevStatus) {
    row.status = nextStatus;
    if (GRIEVANCE_DONE.has(nextStatus)) {
      row.resolved_on = now.slice(0, 10);
      row.resolved_by = req.user.username;
      if (!note) {
        if (!Array.isArray(row.followups)) row.followups = [];
        row.followups.unshift({
          at: now,
          by: req.user.username,
          remark: nextStatus === 'closed' ? 'Marked closed' : 'Marked resolved',
        });
        row.last_followup_on = row.followups[0].at;
        row.last_followup_by = req.user.username;
      }
    } else {
      row.resolved_on = null;
      row.resolved_by = null;
    }
  }
  row.updated_at = now;
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

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`DRO Ops API on http://localhost:${PORT}${isReady() ? '' : ' — loading store…'}`);
    console.log(`[DRO] data store: ${storeMode()}${useSupabase() ? ' (' + sb.status().host + ')' : ''}`);
  });
}

module.exports = app;
module.exports.initPromise = initPromise;
module.exports.initAuthPromise = initAuthPromise;
