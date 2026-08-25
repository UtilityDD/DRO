const { isAdmin } = require('./permissions');

function store() {
  return require('./store');
}

const KINDS = new Set(['work', 'assignment', 'note']);
const PRIORITIES = new Set(['high', 'normal', 'low']);
const STATUSES = new Set(['open', 'waiting', 'done']);
const SITE_TYPES = new Set(['office', 'ss', 'custom']);

const CLOUD_KEYS = [
  'id',
  'site_type',
  'site_code',
  'site_name',
  'office_code',
  'office_type',
  'office_name',
  'division_code',
  'ccc_code',
  'region_code',
  'kind',
  'title',
  'body',
  'priority',
  'status',
  'assigned_to',
  'accompanied',
  'followup_at',
  'last_visited_at',
  'updates',
  'created_by',
  'created_at',
  'updated_at',
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

function hydrateFieldNote(row) {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    assigned_to: parseJsonList(row.assigned_to).map((u) => String(u || '').trim()).filter(Boolean),
    accompanied: parseNames(row.accompanied),
    updates: parseJsonList(row.updates)
      .filter((u) => u && typeof u === 'object')
      .map((u) => ({
        at: String(u.at || ''),
        by: String(u.by || ''),
        kind: String(u.kind || 'edit'),
        text: String(u.text || ''),
      })),
    title: String(row.title || ''),
    body: String(row.body || ''),
    site_name: String(row.site_name || ''),
    followup_at: row.followup_at || null,
    last_visited_at: row.last_visited_at || null,
  };
}

function packFieldNoteCloudRow(row) {
  const clean = hydrateFieldNote(row);
  const out = {};
  for (const k of CLOUD_KEYS) {
    if (k === 'assigned_to' || k === 'updates' || k === 'accompanied') {
      out[k] = k === 'assigned_to' ? clean.assigned_to : k === 'accompanied' ? clean.accompanied : clean.updates;
    } else {
      out[k] = clean[k] ?? null;
    }
  }
  return out;
}

function parseNames(raw) {
  const parts = [];
  if (Array.isArray(raw)) {
    for (const item of raw) parts.push(String(item || ''));
  } else if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) parts.push(String(item || ''));
      } else {
        parts.push(raw);
      }
    } catch {
      parts.push(raw);
    }
  }
  const names = [
    ...new Set(
      parts
        .flatMap((s) => String(s).split(/[,;\n]+/))
        .map((s) => s.replace(/\s+/g, ' ').trim())
        .filter((s) => s.length >= 2 && s.length <= 80 && !/[<>]/.test(s))
    ),
  ];
  return names.slice(0, 20);
}

function slugCustom(name) {
  const s = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return s || 'site';
}

function parseAssigned(raw) {
  const names = [
    ...new Set(
      (Array.isArray(raw) ? raw : [])
        .map((u) => String(u || '').trim())
        .filter(Boolean)
    ),
  ];
  if (!names.length) return { names: [] };
  const allowed = new Set(store().readUsers().map((u) => u.username));
  if (names.some((n) => !allowed.has(n))) return { error: 'Invalid assignee' };
  return { names };
}

function appendUpdate(row, user, kind, text) {
  if (!Array.isArray(row.updates)) row.updates = [];
  row.updates.unshift({
    at: new Date().toISOString(),
    by: user?.username || '',
    kind,
    text: String(text || '').slice(0, 500),
  });
  row.updates = row.updates.slice(0, 80);
}

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function isDone(status) {
  return String(status || '') === 'done';
}

function followupMs(row) {
  const t = Date.parse(String(row.followup_at || ''));
  return Number.isFinite(t) ? t : null;
}

function isOverdue(row, now = Date.now()) {
  if (isDone(row.status)) return false;
  const t = followupMs(row);
  return t != null && t < now;
}

function isDueToday(row, now = new Date()) {
  if (isDone(row.status)) return false;
  const t = followupMs(row);
  if (t == null) return false;
  return t >= startOfDay(now).getTime() && t <= endOfDay(now).getTime();
}

function itemRank(row, now = Date.now()) {
  if (isDone(row.status)) return 4;
  if (isOverdue(row, now)) return 0;
  if (isDueToday(row, new Date(now))) return 1;
  if (followupMs(row) != null) return 2;
  return 3;
}

function sortItems(rows) {
  const now = Date.now();
  return [...rows].sort((a, b) => {
    const ra = itemRank(a, now);
    const rb = itemRank(b, now);
    if (ra !== rb) return ra - rb;
    const ta = followupMs(a) ?? (Date.parse(String(a.updated_at || '')) || 0);
    const tb = followupMs(b) ?? (Date.parse(String(b.updated_at || '')) || 0);
    return ta - tb;
  });
}

function countsOf(rows) {
  const now = Date.now();
  let open = 0;
  let overdue = 0;
  let today = 0;
  let waiting = 0;
  let done = 0;
  for (const r of rows) {
    const status = String(r.status || 'open');
    if (status === 'done') done += 1;
    else {
      open += 1;
      if (status === 'waiting') waiting += 1;
      if (isOverdue(r, now)) overdue += 1;
      else if (isDueToday(r, new Date(now))) today += 1;
    }
  }
  return { open, overdue, today, waiting, done, total: rows.length };
}

function staffForUser(user) {
  const role = String(user?.role || '').toLowerCase();
  return store().readUsers()
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

function resolveSite(siteType, siteCode, opts = {}) {
  const type = String(siteType || '').trim();
  const code = String(siteCode || '').trim();

  if (type === 'custom') {
    const name = cleanText(opts.site_name || opts.custom_name, 80).trim();
    if (name.length < 2) return { error: 'Enter a site name' };
    let parent = null;
    if (opts.parent_code) {
      parent = resolveSite('office', opts.parent_code);
      if (parent.error) parent = null;
    }
    const user = opts.user || {};
    const division_code = String(
      (parent && parent.division_code) || user.division_code || ''
    );
    const ccc_code = String(
      (parent && parent.office_type === 'ccc' && parent.site_code) || user.ccc_code || ''
    );
    const office_code = ccc_code || division_code;
    const site_code = code && code.startsWith('c-') ? code : `c-${slugCustom(name)}`;
    return {
      site_type: 'custom',
      site_code,
      site_name: name,
      office_code,
      office_type: ccc_code ? 'ccc' : division_code ? 'division' : 'region',
      office_name: (parent && parent.site_name) || name,
      division_code,
      ccc_code,
      region_code: String(user.region_code || '341'),
    };
  }

  if (!SITE_TYPES.has(type) || !code) return { error: 'Pick a site' };

  if (type === 'office') {
    const offices = store().readCollection('offices', []);
    const office = offices.find(
      (o) =>
        String(o.code) === code &&
        (o.office_type === 'ccc' || o.office_type === 'division')
    );
    if (!office) return { error: 'Invalid office' };
    const division_code = String(
      office.division_code || (office.office_type === 'division' ? office.code : '')
    );
    return {
      site_type: 'office',
      site_code: String(office.code),
      site_name: String(office.name || office.code),
      office_code: String(office.code),
      office_type: String(office.office_type || 'ccc'),
      office_name: String(office.name || office.code),
      division_code,
      ccc_code: office.office_type === 'ccc' ? String(office.code) : '',
      region_code: String(office.region_code || '341'),
    };
  }

  const substations = store().readCollection('substations', []);
  const ss = substations.find((r) => String(r.id) === code || String(r.code || '') === code);
  if (!ss) return { error: 'Invalid substation' };
  const offices = store().readCollection('offices', []);
  const div = offices.find((o) => o.office_type === 'division' && String(o.code) === String(ss.division_code || ''));
  const ccc = offices.find((o) => o.office_type === 'ccc' && String(o.code) === String(ss.ccc_code || ''));
  const ccc_code = String(ss.ccc_code || ccc?.code || '');
  const division_code = String(ss.division_code || div?.code || '');
  return {
    site_type: 'ss',
    site_code: String(ss.id),
    site_name: String(ss.name || `SS ${ss.id}`),
    office_code: ccc_code || division_code,
    office_type: ccc_code ? 'ccc' : 'division',
    office_name: ccc?.name || div?.name || ss.name || '',
    division_code,
    ccc_code,
    region_code: '341',
  };
}

function canSeeSite(user, site) {
  if (!site || site.error) return false;
  if (isAdmin(user) || String(user?.role || '').toLowerCase() === 'region') return true;
  return store().scopeFilter(user, site);
}

function siteKey(row) {
  return `${row.site_type}:${row.site_code}`;
}

function listCandidateSites(user, notes = []) {
  const offices = store().readCollection('offices', []);
  const substations = store().readCollection('substations', []);
  const officeSites = offices
    .filter((o) => o.office_type === 'ccc' || o.office_type === 'division')
    .map((o) => resolveSite('office', o.code))
    .filter((s) => !s.error && canSeeSite(user, s));
  const ssSites = substations
    .map((s) => resolveSite('ss', String(s.id)))
    .filter((s) => !s.error && canSeeSite(user, s));
  const seen = new Set();
  const customSites = [];
  for (const row of notes || []) {
    if (String(row.site_type) !== 'custom') continue;
    const key = siteKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    const site = {
      site_type: 'custom',
      site_code: String(row.site_code),
      site_name: String(row.site_name || row.site_code),
      office_code: String(row.office_code || ''),
      office_type: String(row.office_type || 'ccc'),
      office_name: String(row.office_name || row.site_name || ''),
      division_code: String(row.division_code || ''),
      ccc_code: String(row.ccc_code || ''),
      region_code: String(row.region_code || '341'),
    };
    if (canSeeSite(user, site)) customSites.push(site);
  }
  return [...officeSites, ...ssSites, ...customSites];
}

function buildSiteSummaries(user, notes) {
  const grouped = new Map();
  for (const row of notes) {
    const key = siteKey(row);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  const now = Date.now();
  return listCandidateSites(user, notes)
    .map((site) => {
      const items = grouped.get(siteKey(site)) || [];
      const standing = items.find((r) => r.kind === 'note') || null;
      const openItems = items.filter((r) => !isDone(r.status));
      const overdue = openItems.filter((r) => isOverdue(r, now)).length;
      const next = openItems
        .map((r) => followupMs(r))
        .filter((t) => t != null)
        .sort((a, b) => a - b)[0];
      const lastVisited = items
        .map((r) => Date.parse(String(r.last_visited_at || '')))
        .filter((t) => Number.isFinite(t))
        .sort((a, b) => b - a)[0];
      return {
        ...site,
        open_count: openItems.length,
        overdue_count: overdue,
        item_count: items.length,
        next_followup_at: next ? new Date(next).toISOString() : null,
        last_visited_at: lastVisited ? new Date(lastVisited).toISOString() : null,
        standing_id: standing?.id ?? null,
        standing_body: standing?.body || '',
      };
    })
    .sort((a, b) => {
      if (b.overdue_count !== a.overdue_count) return b.overdue_count - a.overdue_count;
      if (b.open_count !== a.open_count) return b.open_count - a.open_count;
      return String(a.site_name).localeCompare(String(b.site_name));
    });
}

function cleanText(value, max) {
  return String(value || '')
    .replace(/[<>]/g, '')
    .slice(0, max);
}

function parseWhen(raw, label = 'date/time') {
  if (raw == null || raw === '') return { value: null };
  const iso = String(raw).trim();
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return { error: `Invalid ${label}` };
  return { value: new Date(t).toISOString() };
}

function parseFollowupAt(raw) {
  return parseWhen(raw, 'follow-up date/time');
}

function visitLabel(at, accompanied) {
  const names = parseNames(accompanied);
  const withWho = names.length ? ` with ${names.join(', ')}` : '';
  return `Visited${withWho}`.slice(0, 500);
}

module.exports = {
  KINDS,
  PRIORITIES,
  STATUSES,
  SITE_TYPES,
  hydrateFieldNote,
  packFieldNoteCloudRow,
  parseAssigned,
  parseNames,
  parseWhen,
  visitLabel,
  appendUpdate,
  isDone,
  isOverdue,
  countsOf,
  sortItems,
  staffForUser,
  resolveSite,
  canSeeSite,
  siteKey,
  buildSiteSummaries,
  cleanText,
  parseFollowupAt,
};
