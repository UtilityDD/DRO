const sb = require('./supabase');
const nscLib = require('./nsc_parse');

const LIST_SELECT = [
  'application_no',
  'consumer_id',
  'consumer_name',
  'phone',
  'ccc_code',
  'division_code',
  'status',
  'stage',
  'sap_status',
  'consumer_class',
  'category',
  'quotation_age_days',
  'processing_days',
  'quotation_age_slab',
  'processing_slab',
  'pole_count',
  'procedure',
  'applicant_type',
  'wo_no',
  'agency_name',
  'collected_on',
  'withheld_on',
  'withheld_reason',
  'report_date',
  'applied_on',
  'remarks',
  'delay_days',
];

const DESK_SELECT = [
  'application_no',
  'ccc_code',
  'division_code',
  'status',
  'stage',
  'sap_status',
  'consumer_class',
  'category',
  'quotation_age_days',
  'processing_days',
  'quotation_age_slab',
  'processing_slab',
  'pole_count',
  'procedure',
  'applicant_type',
  'agency_name',
  'withheld_on',
  'withheld_reason',
  'collected_on',
  'applied_on',
  'quotation_issue_on',
  'report_date',
  'remarks',
  'delay_days',
];

const CHART_SELECT = [
  'application_no',
  'ccc_code',
  'division_code',
  'status',
  'stage',
  'sap_status',
  'consumer_class',
  'category',
  'quotation_age_days',
  'processing_days',
  'quotation_age_slab',
  'processing_slab',
  'pole_count',
  'procedure',
  'applicant_type',
  'agency_name',
  'withheld_on',
  'withheld_reason',
  'collected_on',
  'applied_on',
  'quotation_issue_on',
  'report_date',
  'delay_days',
];

const skippedCols = new Set();

function missingColumn(err) {
  const raw = String(err?.message || err || '');
  let msg = raw;
  const brace = raw.indexOf('{');
  if (brace >= 0) {
    try {
      msg = JSON.parse(raw.slice(brace)).message || raw;
    } catch {
      msg = raw;
    }
  }
  const m = String(msg).match(/column (?:[\w.]+\.)?(\w+) does not exist/i)
    || String(msg).match(/column "(\w+)" of relation/i)
    || String(msg).match(/Could not find the '(\w+)' column/i);
  return m ? m[1] : '';
}

function activeSelect(base) {
  return base.filter((c) => !skippedCols.has(c)).join(',');
}

function rememberMissing(err) {
  const col = missingColumn(err);
  if (col) skippedCols.add(col);
  return col;
}

function finishRows(rows) {
  const hydrated = nscLib.hydrateNscRows(Array.isArray(rows) ? rows : []);
  for (const r of hydrated) {
    if (!r.created_on && r.applied_on) r.created_on = r.applied_on;
  }
  return hydrated;
}

async function withSelectRetry(run) {
  for (let i = 0; i < 24; i += 1) {
    try {
      return await run();
    } catch (e) {
      if (!rememberMissing(e)) throw e;
    }
  }
  return run();
}

function enc(v) {
  return encodeURIComponent(String(v));
}

function clockCol(clock, kind) {
  const processing = String(clock || 'quotation') === 'processing';
  if (kind === 'days') {
    const col = processing ? 'processing_days' : 'quotation_age_days';
    return skippedCols.has(col) ? 'delay_days' : col;
  }
  return processing ? 'processing_slab' : 'quotation_age_slab';
}

function canFilter(col) {
  return col && !skippedCols.has(col);
}

function scopeParts(user) {
  const role = String(user?.role || '').toLowerCase();
  if (role === 'ccc' && user.ccc_code) return [`ccc_code=eq.${enc(user.ccc_code)}`];
  if (role === 'division' && user.division_code) {
    return [`division_code=eq.${enc(user.division_code)}`];
  }
  return [];
}

function queueParts(queue) {
  const q = String(queue || '').toLowerCase();
  if (q === 'withheld') return ['status=eq.withheld'];
  if (q === 'pending') return ['status=eq.pending'];
  return [];
}

function nscFilterParts(q = {}, user, opts = {}) {
  const chart = !!opts.chart;
  const parts = [...scopeParts(user), ...queueParts(q.queue)];
  if (q.division) parts.push(`division_code=eq.${enc(q.division)}`);
  if (q.ccc) parts.push(`ccc_code=eq.${enc(q.ccc)}`);
  if ((q.class || q.klass) && canFilter('consumer_class')) {
    parts.push(`consumer_class=eq.${enc(q.class || q.klass)}`);
  } else if ((q.class || q.klass) && skippedCols.has('consumer_class')) {
    parts.push(`category=eq.${enc(q.class || q.klass)}`);
  }
  if (!chart) {
    const slabCol = clockCol(q.clock, 'slab');
    if (q.slab && canFilter(slabCol)) parts.push(`${slabCol}=eq.${enc(q.slab)}`);
    const min = Number(q.delay_min);
    const max = Number(q.delay_max);
    const days = clockCol(q.clock, 'days');
    if (canFilter(days)) {
      if (Number.isFinite(min) && q.delay_min !== '' && q.delay_min != null) parts.push(`${days}=gte.${min}`);
      if (Number.isFinite(max) && q.delay_max !== '' && q.delay_max != null) parts.push(`${days}=lte.${max}`);
    }
    if (canFilter('pole_count')) {
      const pole = String(q.pole || '').toLowerCase();
      if (pole === 'non_pole') parts.push('pole_count=eq.0');
      if (pole === 'pole') parts.push('pole_count=gt.0');
      if (pole === 'unknown') parts.push('pole_count=is.null');
      const poleMin = Number(q.pole_min);
      const poleMax = Number(q.pole_max);
      if (Number.isFinite(poleMin) && q.pole_min !== '' && q.pole_min != null) parts.push(`pole_count=gte.${poleMin}`);
      if (Number.isFinite(poleMax) && q.pole_max !== '' && q.pole_max != null) parts.push(`pole_count=lte.${poleMax}`);
    }
    const procedure = String(q.procedure || '').toLowerCase();
    if (canFilter('procedure')) {
      if (procedure === 'proc_a' || procedure === 'proc_b') parts.push(`procedure=eq.${enc(procedure)}`);
      if (procedure === 'unknown') parts.push('procedure=is.null');
    }
  }
  const timeKey = String(q.time || '');
  const applyTime = String(q.apply_time || '1') !== '0';
  if (!chart && applyTime && timeKey && canFilter('withheld_on')) {
    const col = 'withheld_on';
    if (timeKey.length === 7) {
      parts.push(`${col}=gte.${timeKey}-01`);
      parts.push(`${col}=lt.${nextMonth(timeKey)}`);
    } else if (timeKey.length === 4) {
      parts.push(`${col}=gte.${timeKey}-01-01`);
      parts.push(`${col}=lt.${Number(timeKey) + 1}-01-01`);
    }
  }
  const search = String(q.q || '').trim().replace(/[,()]/g, ' ').slice(0, 40);
  if (search) {
    const star = `*${search}*`;
    const searchCols = ['application_no', 'consumer_id', 'consumer_name', 'phone', 'wo_no', 'agency_name'].filter(
      (c) => canFilter(c)
    );
    if (searchCols.length) {
      parts.push(`or=(${searchCols.map((c) => `${c}.ilike.${enc(star)}`).join(',')})`);
    }
  }
  return parts;
}

function nextMonth(ym) {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  if (m === 12) return `${y + 1}-01-01`;
  return `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

function qs(parts, extra = '') {
  return [...parts, extra].filter(Boolean).join('&');
}

async function nscCount(q, user, opts) {
  return withSelectRetry(() =>
    sb.countRows('nsc_cases', qs(nscFilterParts(q, user, opts), 'select=application_no'))
  );
}

async function nscPage(q, user, { select, limit, offset, order } = {}) {
  const from = Math.max(0, Number(offset) || 0);
  const size = Math.min(1000, Math.max(1, Number(limit) || 80));
  const to = from + size - 1;
  const cols = select || LIST_SELECT;
  const colList = Array.isArray(cols) ? cols : String(cols).split(',');
  return withSelectRetry(async () => {
    const orderCol = skippedCols.has('quotation_age_days') ? 'delay_days.desc.nullslast' : order || 'quotation_age_days.desc.nullslast';
    const path = `nsc_cases?select=${encodeURIComponent(activeSelect(colList))}&${qs(
      nscFilterParts(q, user),
      `order=${orderCol}`
    )}`;
    const { body, headers } = await sb.querySupabaseMeta(path, {
      headers: {
        Range: `${from}-${to}`,
        'Range-Unit': 'items',
        Prefer: 'count=exact',
      },
    });
    const cr = headers.get('content-range') || '';
    const m = cr.match(/\/(\d+)/);
    return {
      rows: finishRows(body),
      total: m ? Number(m[1]) : Array.isArray(body) ? body.length : 0,
    };
  });
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i;
      i += 1;
      out[idx] = await fn(items[idx], idx);
    }
  }
  const n = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

async function nscRange(colList, parts, from, to, withCount) {
  return withSelectRetry(async () => {
    const path = `nsc_cases?select=${encodeURIComponent(activeSelect(colList))}&${qs(parts)}`;
    const headers = {
      Range: `${from}-${to}`,
      'Range-Unit': 'items',
    };
    if (withCount) headers.Prefer = 'count=exact';
    const { body, headers: h } = await sb.querySupabaseMeta(path, { headers });
    const cr = h.get('content-range') || '';
    const m = cr.match(/\/(\d+)\s*$/);
    return {
      rows: Array.isArray(body) ? body : [],
      total: m ? Number(m[1]) : null,
    };
  });
}

async function nscFetchAll(q, user, { select, chart } = {}) {
  const page = 1000;
  const cols = select || (chart ? CHART_SELECT : DESK_SELECT);
  const colList = Array.isArray(cols) ? cols : String(cols).split(',');
  const parts = nscFilterParts(q, user, { chart });
  const first = await nscRange(colList, parts, 0, page - 1, true);
  const all = [...first.rows];
  if (first.rows.length < page) return finishRows(all);
  const total = first.total;
  const exact = total != null && Number.isFinite(Number(total)) && Number(total) >= all.length;
  if (exact && all.length >= Number(total)) return finishRows(all);
  if (exact) {
    const starts = [];
    for (let from = page; from < Math.min(Number(total), 200000); from += page) starts.push(from);
    const rest = await mapPool(starts, 6, async (from) => {
      const batch = await nscRange(colList, parts, from, from + page - 1, false);
      return { from, rows: batch.rows };
    });
    rest.sort((a, b) => a.from - b.from);
    for (const batch of rest) all.push(...batch.rows);
    return finishRows(all);
  }
  for (let from = page; from < 200000; from += page) {
    const batch = await nscRange(colList, parts, from, from + page - 1, false);
    all.push(...batch.rows);
    if (batch.rows.length < page) break;
  }
  return finishRows(all);
}

async function nscStatus(user) {
  const [pending, withheld] = await Promise.all([
    nscCount({ queue: 'pending' }, user),
    nscCount({ queue: 'withheld' }, user),
  ]);
  let report_date = null;
  let updated_at = null;
  try {
    const latest = await sb.querySupabase(
      'nsc_cases?select=report_date,updated_at&order=updated_at.desc.nullslast&limit=1'
    );
    report_date = Array.isArray(latest) ? latest[0]?.report_date || null : null;
    updated_at = Array.isArray(latest) ? latest[0]?.updated_at || null : null;
  } catch {
    try {
      const latest = await sb.querySupabase(
        'nsc_cases?select=report_date&order=report_date.desc.nullslast&limit=1'
      );
      report_date = Array.isArray(latest) ? latest[0]?.report_date || null : null;
    } catch {
      /* keep */
    }
  }
  return {
    report_date,
    updated_at,
    pending,
    withheld,
    total: pending + withheld,
  };
}

function csvEscape(v) {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

async function nscExportCsv(q, user, write) {
  const cols = Object.keys(nscLib.nscExportRow({}));
  await write(`${cols.join(',')}\n`);
  let written = 0;
  for (let from = 0; from < 200000; from += 500) {
    const { rows } = await nscPage(q, user, { select: LIST_SELECT, limit: 500, offset: from });
    if (!rows.length) break;
    const hydrated = nscLib.hydrateNscRows(rows);
    for (const r of hydrated) {
      const o = nscLib.nscExportRow(r);
      await write(`${cols.map((k) => csvEscape(o[k])).join(',')}\n`);
      written += 1;
    }
    if (rows.length < 500) break;
  }
  return written;
}

module.exports = {
  LIST_SELECT,
  DESK_SELECT,
  CHART_SELECT,
  nscFilterParts,
  nscCount,
  nscPage,
  nscFetchAll,
  nscExportCsv,
  nscStatus,
};
