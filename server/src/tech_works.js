const { isAdmin, canEdit } = require('./permissions');

function store() {
  return require('./store');
}

const TECH_META = '\n||DRO-TW||\n';

const STATUSES = new Set(['planned', 'in_progress', 'on_hold', 'completed']);
const MATERIAL = new Set(['not_issued', 'partial', 'issued']);
const UNITS = new Set(['MVA', 'CKT KM', '']);

const EXTRA_KEYS = [
  'category_id',
  'category_name',
  'description',
  'related_ss_name',
  'related_ss_id',
  'existing_parameter',
  'proposed_parameter',
  'parameter_unit',
  'proposal_enote_no',
  'proposal_enote_date',
  'taa_no',
  'taa_date',
  'scheme_value',
  'billing_progress',
  'major_material',
  'pos',
  'work_start_date',
  'material_issue_status',
  'work_progress',
  'followups',
  'followup_users',
  'created_by',
  'created_at',
  'last_followup_on',
  'last_followup_by',
];

const CLOUD_KEYS = [
  'id',
  'work_id',
  'title',
  'ccc_code',
  'division_code',
  'region_code',
  'priority',
  'status',
  'vendor_name',
  'billing_status',
  'target_date',
  'completed_on',
  'remarks',
  'batch_id',
  'updated_at',
];

const DEFAULT_CATEGORIES = [
  { id: 1, name: 'New 33/11kV SS', parameter_unit: 'MVA', sort_order: 10, active: true },
  { id: 2, name: 'Augmentation of existing 33/11kV SS', parameter_unit: 'MVA', sort_order: 20, active: true },
  { id: 3, name: 'New 33kV feeder', parameter_unit: 'CKT KM', sort_order: 30, active: true },
  { id: 4, name: 'Augmentation of conductor of 33kV feeder', parameter_unit: 'CKT KM', sort_order: 40, active: true },
  { id: 5, name: 'Feeder Bifurcation of 11kV feeder', parameter_unit: 'CKT KM', sort_order: 50, active: true },
  { id: 6, name: 'Augmentation of conductor of 11kV feeder', parameter_unit: 'CKT KM', sort_order: 60, active: true },
];

function parseJsonList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function isoDate(v) {
  const s = String(v || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(new Date(`${s}T00:00:00`).getTime()) ? s : null;
}

function numOrNull(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function moneyOrNull(v) {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

function clampProgress(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function cleanText(v, max = 400) {
  return String(v || '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function parsePos(raw) {
  return parseJsonList(raw)
    .map((p) => ({
      po_no: cleanText(p?.po_no, 40),
      po_date: isoDate(p?.po_date),
      agency_name: cleanText(p?.agency_name, 80),
    }))
    .filter((p) => p.po_no || p.agency_name || p.po_date)
    .slice(0, 20);
}

function parseFollowups(raw) {
  return parseJsonList(raw)
    .filter((u) => u && typeof u === 'object')
    .map((u) => ({
      at: String(u.at || ''),
      by: String(u.by || ''),
      remark: String(u.remark || u.text || '').slice(0, 400),
    }))
    .filter((u) => u.remark)
    .slice(0, 80);
}

function parseUsernames(raw) {
  return [
    ...new Set(
      parseJsonList(raw)
        .map((u) => String(u || '').trim())
        .filter(Boolean)
    ),
  ];
}

function normalizeStatus(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s === 'open') return 'planned';
  if (s === 'done' || s === 'closed' || s === 'resolved') return 'completed';
  if (STATUSES.has(s)) return s;
  return 'planned';
}

function hasSchemeShape(row) {
  if (!row || typeof row !== 'object') return false;
  return Boolean(
    Number(row.category_id) ||
      String(row.category_name || '').trim() ||
      String(row.taa_no || '').trim() ||
      String(row.proposal_enote_no || '').trim() ||
      (Array.isArray(row.pos) && row.pos.some((p) => p && String(p.po_no || '').trim()))
  );
}

function hydrateTechWork(row) {
  if (!row || typeof row !== 'object') return row;
  const raw = String(row.remarks || '');
  const i = raw.indexOf(TECH_META);
  const packed = {};
  const out = { ...row };
  if (i >= 0) {
    out.remarks = raw.slice(0, i);
    try {
      Object.assign(packed, JSON.parse(raw.slice(i + TECH_META.length)) || {});
    } catch {
      /* keep text only */
    }
  }
  for (const k of EXTRA_KEYS) {
    if (out[k] === undefined || out[k] === null || out[k] === '') {
      if (packed[k] !== undefined) out[k] = packed[k];
    }
  }
  out.pos = parsePos(out.pos?.length ? out.pos : packed.pos);
  out.followups = parseFollowups(out.followups?.length ? out.followups : packed.followups);
  out.followup_users = parseUsernames(
    Array.isArray(out.followup_users) && out.followup_users.length ? out.followup_users : packed.followup_users
  );
  out.description = cleanText(out.description || out.title || '', 400);
  out.title = out.description || String(out.title || out.work_id || 'Tech work');
  out.category_id = Number(out.category_id) || Number(packed.category_id) || null;
  out.category_name = String(out.category_name || packed.category_name || '').trim();
  if (!out.category_name && out.category_id) {
    const cat = categoryById(out.category_id);
    if (cat) {
      out.category_name = cat.name;
      if (!out.parameter_unit) out.parameter_unit = cat.parameter_unit || '';
    }
  }
  out.related_ss_name = String(out.related_ss_name || '').trim();
  out.related_ss_id = out.related_ss_id != null && out.related_ss_id !== '' ? String(out.related_ss_id) : '';
  out.existing_parameter = numOrNull(out.existing_parameter);
  out.proposed_parameter = numOrNull(out.proposed_parameter);
  out.parameter_unit = UNITS.has(String(out.parameter_unit || '').toUpperCase())
    ? String(out.parameter_unit).toUpperCase() === 'CKT KM'
      ? 'CKT KM'
      : String(out.parameter_unit).toUpperCase()
    : String(out.parameter_unit || '');
  if (out.parameter_unit === 'CKT KM' || out.parameter_unit === 'MVA') {
    /* keep */
  } else if (String(out.parameter_unit || '').toUpperCase() === 'CKT KM') {
    out.parameter_unit = 'CKT KM';
  }
  out.proposal_enote_no = cleanText(out.proposal_enote_no, 40);
  out.proposal_enote_date = isoDate(out.proposal_enote_date);
  out.taa_no = cleanText(out.taa_no, 40);
  out.taa_date = isoDate(out.taa_date);
  out.scheme_value = moneyOrNull(out.scheme_value);
  out.billing_progress = moneyOrNull(out.billing_progress);
  out.major_material = String(out.major_material || '').replace(/[<>]/g, '').trim().slice(0, 800);
  out.work_start_date = isoDate(out.work_start_date);
  out.material_issue_status = MATERIAL.has(String(out.material_issue_status || ''))
    ? String(out.material_issue_status)
    : 'not_issued';
  out.work_progress = clampProgress(out.work_progress);
  out.status = normalizeStatus(out.status);
  if (!out.pos.length && out.vendor_name) {
    out.pos = [{ po_no: '', po_date: '', agency_name: String(out.vendor_name) }];
  }
  out.vendor_name = out.pos[0]?.agency_name || out.vendor_name || '';
  out.created_by = String(out.created_by || '');
  return out;
}

function isLegacyTechRow(row) {
  const r = hydrateTechWork(row);
  if (hasSchemeShape(r)) return false;
  const title = String(r.title || r.description || '');
  return (
    /^Priority feeder work/i.test(title) ||
    /^TW-341-30\d$/i.test(String(r.work_id || '')) ||
    (Boolean(r.billing_status) && !r.taa_no && !Number(r.category_id))
  );
}

function packTechWorkCloudRow(row, opts = {}) {
  const clean = hydrateTechWork(row);
  const text = String(clean.remarks || '').split(TECH_META)[0];
  const extra = {};
  for (const k of EXTRA_KEYS) extra[k] = clean[k] ?? null;
  const out = {};
  for (const k of CLOUD_KEYS) {
    if (k === 'remarks') out[k] = `${text}${TECH_META}${JSON.stringify(extra)}`;
    else if (k === 'title') out[k] = clean.description || clean.title || clean.work_id;
    else if (k === 'vendor_name') out[k] = clean.pos[0]?.agency_name || clean.vendor_name || '';
    else if (k === 'status') out[k] = clean.status;
    else out[k] = clean[k] ?? null;
  }
  if (opts.extras !== false) {
    for (const k of EXTRA_KEYS) out[k] = extra[k];
  }
  for (const k of Object.keys(out)) {
    if (out[k] !== '') continue;
    if (/_date$|_on$|_at$/.test(k) || k === 'updated_at' || k === 'created_at') out[k] = null;
  }
  if (Array.isArray(out.pos)) {
    out.pos = out.pos.map((p) => ({
      ...p,
      po_date: p?.po_date || null,
    }));
  }
  return out;
}

function overlayDemoSchemeMoney(rows) {
  const samples = new Map(sampleWorks([]).map((s) => [s.work_id, s]));
  let changed = false;
  const next = (rows || []).map((r) => {
    const s = samples.get(r.work_id);
    if (!s) return r;
    if (r.scheme_value != null && r.billing_progress != null) return r;
    changed = true;
    return {
      ...r,
      scheme_value: r.scheme_value ?? s.scheme_value,
      billing_progress: r.billing_progress ?? s.billing_progress,
      work_progress: r.work_progress || s.work_progress,
      material_issue_status:
        r.material_issue_status && r.material_issue_status !== 'not_issued'
          ? r.material_issue_status
          : s.material_issue_status,
    };
  });
  return { rows: next, changed };
}

function resolveLoadedWorks(remoteRows, localRows, offices) {
  const remoteRaw = Array.isArray(remoteRows) ? remoteRows : [];
  const remoteH = remoteRaw.map(hydrateTechWork);
  const localH = (Array.isArray(localRows) ? localRows : []).map(hydrateTechWork);
  const nativeOk = remoteRaw.some(
    (r) => Number(r?.category_id) || String(r?.taa_no || '').trim() || String(r?.category_name || '').trim()
  );
  let picked;
  if (remoteH.some(hasSchemeShape)) {
    picked = { rows: remoteH, source: 'remote', persist: !nativeOk };
  } else if (localH.some(hasSchemeShape)) {
    picked = { rows: localH, source: 'local', persist: true };
  } else {
    const pool = remoteH.length ? remoteH : localH;
    if (!pool.length || pool.every(isLegacyTechRow)) {
      picked = { rows: sampleWorks(offices || []), source: 'seed', persist: true };
    } else {
      picked = { rows: pool, source: remoteH.length ? 'remote' : 'local', persist: !nativeOk };
    }
  }
  const money = overlayDemoSchemeMoney(picked.rows);
  return { ...picked, rows: money.rows, persist: picked.persist || money.changed };
}

function defaultCategories() {
  const now = new Date().toISOString();
  return DEFAULT_CATEGORIES.map((c) => ({ ...c, created_at: now, updated_at: now }));
}

function ensureCategories() {
  const rows = store().readCollection('tech_work_categories', []);
  if (Array.isArray(rows) && rows.length) return rows;
  const seeded = defaultCategories();
  store().writeCollection('tech_work_categories', seeded);
  return seeded;
}

function categoriesSorted() {
  return ensureCategories()
    .slice()
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || Number(a.id) - Number(b.id));
}

function categoryById(id) {
  const n = Number(id);
  return categoriesSorted().find((c) => Number(c.id) === n) || null;
}

function nextWorkId(rows) {
  let max = 0;
  for (const r of rows) {
    const m = String(r.work_id || '').match(/TW-341-(\d+)/i);
    if (m) max = Math.max(max, Number(m[1]) || 0);
  }
  return `TW-341-${String(max + 1).padStart(3, '0')}`;
}

function staffForUser(user) {
  const role = String(user?.role || '').toLowerCase();
  return store()
    .readUsers()
    .filter((u) => {
      const r = String(u.role || '').toLowerCase();
      if (r === 'admin') return false;
      if (role === 'admin' || role === 'region') return true;
      if (role === 'division') return String(u.division_code || '') === String(user.division_code || '');
      if (role === 'ccc') {
        return (
          String(u.ccc_code || '') === String(user.ccc_code || '') ||
          (u.role === 'division' && String(u.division_code || '') === String(user.division_code || ''))
        );
      }
      return false;
    })
    .map((u) => ({
      username: u.username,
      name: u.name,
      role: u.role,
    }));
}

function parseFollowupUsers(raw) {
  const names = parseUsernames(raw);
  const allowed = new Set(
    store()
      .readUsers()
      .filter((u) => String(u.role || '').toLowerCase() !== 'admin')
      .map((u) => u.username)
  );
  if (names.some((n) => !allowed.has(n))) return { error: 'Invalid follow-up user' };
  return { names };
}

function canCreate(user) {
  if (isAdmin(user) || canEdit(user, 'tech_works')) return true;
  return isSchemeAuthor(user);
}

function canPlan(user, row) {
  if (canCreate(user)) return true;
  if (!row) return false;
  const list = Array.isArray(row.followup_users) ? row.followup_users : [];
  return list.includes(user?.username);
}

function canAssign(user) {
  return canCreate(user);
}

function canFollowup(user, row) {
  if (canCreate(user)) return true;
  const list = Array.isArray(row?.followup_users) ? row.followup_users : [];
  return list.includes(user?.username);
}

function canUpdate(user, row) {
  return canFollowup(user, row);
}

function isSchemeAuthor(user) {
  const names = parseUsernames(ensureSettings().author_users);
  return names.includes(String(user?.username || ''));
}

function defaultSettings() {
  return { id: 1, author_users: [], updated_at: new Date().toISOString() };
}

function ensureSettings() {
  const rows = store().readCollection('tech_work_settings', []);
  const list = Array.isArray(rows) ? rows : [];
  if (list.length) {
    const row = list[0];
    if (!Array.isArray(row.author_users)) row.author_users = parseUsernames(row.author_users);
    return row;
  }
  const seeded = defaultSettings();
  store().writeCollection('tech_work_settings', [seeded]);
  return seeded;
}

function saveAuthors(raw) {
  const assigned = parseFollowupUsers(raw);
  if (assigned.error) return assigned;
  const row = ensureSettings();
  row.author_users = assigned.names;
  row.updated_at = new Date().toISOString();
  store().writeCollection('tech_work_settings', [{ ...row, id: 1 }]);
  return { names: assigned.names, row };
}

function inScope(user, row) {
  if (store().scopeFilter(user, row)) return true;
  const role = String(user?.role || '').toLowerCase();
  if (role !== 'ccc') return false;
  const userDiv = String(user.division_code || '').trim();
  const rowDiv = String(row.division_code || '').trim();
  if (!userDiv || !rowDiv || userDiv !== rowDiv) return false;
  const rowCcc = String(row.ccc_code || '').trim();
  const userCcc = String(user.ccc_code || '').trim();
  return !rowCcc || rowCcc === userCcc;
}

function isDone(status) {
  return normalizeStatus(status) === 'completed';
}

function sampleWorks(offices) {
  const now = new Date().toISOString();
  const divs = (offices || []).filter((o) => o.office_type === 'division');
  const code = (i) => divs[i % Math.max(divs.length, 1)]?.code || '3412';
  const cats = DEFAULT_CATEGORIES;
  return [
    {
      id: 1,
      work_id: 'TW-341-001',
      category_id: cats[0].id,
      category_name: cats[0].name,
      parameter_unit: 'MVA',
      title: 'New 33/11 kV SS at North Bengal Medical area',
      description: 'New 33/11 kV SS at North Bengal Medical area',
      division_code: code(0),
      related_ss_name: 'Salbari',
      existing_parameter: 0,
      proposed_parameter: 31.5,
      proposal_enote_no: 'EN/DRO/SS/26-01',
      proposal_enote_date: '2026-04-12',
      taa_no: 'TAA/341/26/011',
      taa_date: '2026-05-03',
      scheme_value: 186500000,
      billing_progress: 42000000,
      major_material: '2×12.6 MVA PTR, 33 kV VCB, 11 kV panel, control & relay panel',
      pos: [
        { po_no: 'PO/SS/26/104', po_date: '2026-05-18', agency_name: 'ABC Infra' },
        { po_no: 'PO/SS/26/118', po_date: '2026-06-02', agency_name: 'Eastern Switchgear' },
      ],
      work_start_date: '2026-06-15',
      material_issue_status: 'partial',
      work_progress: 35,
      status: 'in_progress',
      followup_users: ['stown', 'region'],
      followups: [
        { at: now, by: 'region', remark: 'PTR foundation in progress. 11 kV panel delivery awaited.' },
      ],
      remarks: 'Land handed over. Civil agency mobilised.',
    },
    {
      id: 2,
      work_id: 'TW-341-002',
      category_id: cats[1].id,
      category_name: cats[1].name,
      parameter_unit: 'MVA',
      title: 'Augmentation of Rabindranagar 33/11 kV SS',
      description: 'Augmentation of Rabindranagar 33/11 kV SS',
      division_code: '3412',
      related_ss_name: 'Rabindranagar',
      existing_parameter: 28.9,
      proposed_parameter: 37.8,
      proposal_enote_no: 'EN/DRO/SS/26-04',
      proposal_enote_date: '2026-03-22',
      taa_no: 'TAA/341/26/019',
      taa_date: '2026-04-16',
      scheme_value: 64000000,
      billing_progress: 38500000,
      major_material: '1×12.6 MVA PTR, 33 kV isolator, additional 11 kV feeder panels',
      pos: [{ po_no: 'PO/SS/26/077', po_date: '2026-04-28', agency_name: 'Siliguri Elec' }],
      work_start_date: '2026-05-20',
      material_issue_status: 'issued',
      work_progress: 70,
      status: 'in_progress',
      followup_users: ['stown'],
      followups: [],
      remarks: 'PTR received. Bay extension remaining.',
    },
    {
      id: 3,
      work_id: 'TW-341-003',
      category_id: cats[2].id,
      category_name: cats[2].name,
      parameter_unit: 'CKT KM',
      title: 'New 33 kV feeder Kurseong to Pankhabari',
      description: 'New 33 kV feeder Kurseong to Pankhabari',
      division_code: '3413',
      related_ss_name: 'Pankhabari',
      existing_parameter: 0,
      proposed_parameter: 12.4,
      proposal_enote_no: 'EN/DRO/FD/26-02',
      proposal_enote_date: '2026-02-11',
      taa_no: 'TAA/341/26/007',
      taa_date: '2026-03-04',
      scheme_value: 92000000,
      billing_progress: 0,
      major_material: 'ACSR Wolf conductor, 33 kV poles, disc insulators, AB switches',
      pos: [{ po_no: 'PO/LN/26/033', po_date: '2026-03-20', agency_name: 'Hill Power' }],
      work_start_date: '',
      material_issue_status: 'not_issued',
      work_progress: 0,
      status: 'planned',
      followup_users: ['region'],
      followups: [],
      remarks: 'ROW survey in progress. TAA issued.',
    },
    {
      id: 4,
      work_id: 'TW-341-004',
      category_id: cats[4].id,
      category_name: cats[4].name,
      parameter_unit: 'CKT KM',
      title: '11 kV feeder bifurcation from Bidhannagar SS',
      description: '11 kV feeder bifurcation from Bidhannagar SS',
      division_code: '3415',
      related_ss_name: 'Bidhannagar',
      existing_parameter: 8.2,
      proposed_parameter: 14.6,
      proposal_enote_no: 'EN/DRO/11/26-09',
      proposal_enote_date: '2026-01-18',
      taa_no: 'TAA/341/26/028',
      taa_date: '2026-02-09',
      scheme_value: 31500000,
      billing_progress: 11000000,
      major_material: 'AB cable 3×120, 11 kV RMU, poles, stay sets',
      pos: [
        { po_no: 'PO/11/26/051', po_date: '2026-02-22', agency_name: 'North Tech' },
        { po_no: 'PO/11/26/062', po_date: '2026-03-08', agency_name: 'Terai Cables' },
      ],
      work_start_date: '2026-04-01',
      material_issue_status: 'partial',
      work_progress: 45,
      status: 'in_progress',
      followup_users: ['region'],
      followups: [],
      remarks: 'Cable issued for 6 km. RMU pending.',
    },
  ].map((row) => ({
    ...row,
    ccc_code: '',
    region_code: '341',
    priority: row.work_progress >= 50 ? 'high' : 'medium',
    billing_status: row.material_issue_status === 'issued' ? 'submitted' : 'pending',
    target_date: '2026-12-31',
    completed_on: null,
    batch_id: null,
    created_by: 'admin',
    created_at: now,
    updated_at: now,
    last_followup_on: row.followups[0]?.at || null,
    last_followup_by: row.followups[0]?.by || null,
  }));
}

module.exports = {
  TECH_META,
  STATUSES,
  MATERIAL,
  UNITS,
  EXTRA_KEYS,
  DEFAULT_CATEGORIES,
  hasSchemeShape,
  isLegacyTechRow,
  hydrateTechWork,
  packTechWorkCloudRow,
  resolveLoadedWorks,
  defaultCategories,
  ensureCategories,
  categoriesSorted,
  categoryById,
  nextWorkId,
  staffForUser,
  parseFollowupUsers,
  parsePos,
  parseFollowups,
  cleanText,
  isoDate,
  numOrNull,
  moneyOrNull,
  clampProgress,
  normalizeStatus,
  canCreate,
  canPlan,
  canAssign,
  canFollowup,
  canUpdate,
  inScope,
  isDone,
  sampleWorks,
  isSchemeAuthor,
  ensureSettings,
  saveAuthors,
};
