import {
  NSC_CUMULATIVE,
  buildWithheldTimeline,
  isPendingQueue,
  monthOfIso,
  yearOfIso,
  type DelayCut,
  type DelayOp,
  type NscClock,
  type NscQueue,
} from './nsc';

export type NscChartRow = {
  application_no?: string;
  consumer_id?: string;
  consumer_name?: string;
  phone?: string;
  status: string;
  sap_status?: string;
  stage?: string;
  division_code: string;
  division_name: string;
  ccc_code: string;
  ccc_name: string;
  consumer_class: string;
  quotation_age_days: number | null;
  processing_days: number | null;
  quotation_age_slab: string;
  processing_slab: string;
  pole_count: number | null;
  procedure?: string;
  applied_phase?: string;
  applicant_type?: string;
  agency_name?: string;
  wo_no?: string;
  withheld_on: string | null;
  withheld_reason: string;
  collected_on: string | null;
  created_on?: string | null;
  applied_on?: string | null;
  quotation_issue_on: string | null;
  report_date: string | null;
  remarks?: string;
  first_seen_on?: string | null;
};

export type NscDeskQuery = {
  queue?: NscQueue | string;
  clock?: NscClock | string;
  division?: string;
  ccc?: string;
  class?: string;
  klass?: string;
  slab?: string;
  delay_min?: string | number | '';
  delay_max?: string | number | '';
  cuts?: string;
  pole?: string;
  pole_min?: string | number | '';
  pole_max?: string | number | '';
  procedure?: string;
  phase?: string;
  agri?: string;
  agency?: string;
  wo?: string;
  time?: string;
  q?: string;
  apply_time?: string;
};

/** Filter value used for rows with no agency recorded. */
export const NSC_NO_AGENCY = '__none__';

export type NscOfficeOpt = { code: string; name: string; division_code?: string };

const SLABS = [
  { id: 'd0_3', label: '≤3d', min: 0, max: 3 },
  { id: 'd3_7', label: '3–7d', min: 4, max: 7 },
  { id: 'd7_15', label: '7–15d', min: 8, max: 15 },
  { id: 'd15_30', label: '15–30d', min: 16, max: 30 },
  { id: 'm1_3', label: '1–3m', min: 31, max: 90 },
  { id: 'm3_6', label: '3–6m', min: 91, max: 180 },
  { id: 'm6_12', label: '6–12m', min: 181, max: 365 },
  { id: 'y1', label: '>1y', min: 366, max: Infinity },
];

const POLE_BINS = [
  { id: 'p0', label: 'Non-pole', min: 0, max: 0 },
  { id: 'p1_2', label: '1–2', min: 1, max: 2 },
  { id: 'p3_5', label: '3–5', min: 3, max: 5 },
  { id: 'p6_10', label: '6–10', min: 6, max: 10 },
  { id: 'p11', label: '>10', min: 11, max: Infinity },
];

function slabFor(days: number) {
  if (!Number.isFinite(days) || days < 0) return { id: 'unknown', label: 'Unknown' };
  return SLABS.find((s) => days >= s.min && days <= s.max) || SLABS[SLABS.length - 1];
}

export function isoDayOf(v: unknown): string | null {
  if (v == null || v === '') return null;
  const s = String(v).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

export function daysBetweenIso(from: unknown, to: unknown): number | null {
  const a = isoDayOf(from);
  const b = isoDayOf(to);
  if (!a || !b) return null;
  const t0 = Date.parse(`${a}T00:00:00Z`);
  const t1 = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return null;
  const d = Math.round((t1 - t0) / 86400000);
  return d >= 0 ? d : null;
}

/** Days from application to quotation issue — office processing delay. */
export function quoteProcessDays(
  row: Pick<NscChartRow, 'created_on' | 'quotation_issue_on'> & { applied_on?: string | null }
): number | null {
  return daysBetweenIso(row.created_on || row.applied_on, row.quotation_issue_on);
}

/** Empty / "null" WO number means the work order has not been issued. */
export function woNotIssued(row: Pick<NscChartRow, 'wo_no'> & { wo_issued?: string | null }): boolean {
  const s = String(row.wo_no ?? '').trim();
  if (!s) return true;
  const u = s.toLowerCase();
  return u === 'null' || u === '(null)' || u === 'nil' || u === 'n/a' || u === 'na' || u === '-';
}

function poleCountOf(row: NscChartRow) {
  if (row.pole_count == null || row.pole_count === ('' as unknown)) return null;
  const n = Number(row.pole_count);
  return Number.isFinite(n) ? n : null;
}

function poleKindOf(row: NscChartRow): 'pole' | 'non_pole' | 'unknown' {
  const n = poleCountOf(row);
  if (n == null) return 'unknown';
  return n > 0 ? 'pole' : 'non_pole';
}

function procedureOf(row: NscChartRow) {
  if (row.procedure === 'proc_a' || row.procedure === 'proc_b' || row.procedure === 'unknown') return row.procedure;
  const u = String(row.applicant_type || '').toUpperCase();
  if (/PROMOTER|DEVELOPER|HOUSING|COMPLEX/.test(u)) return 'proc_b';
  if (row.applicant_type) return 'proc_a';
  return 'unknown';
}

export function isAgriClass(row: Pick<NscChartRow, 'consumer_class'> & { class_code?: string; category?: string }) {
  return isAgriName(row.consumer_class || row.category || '', row.class_code);
}

export function isAgriName(name: string, code?: string) {
  const cls = String(name || '').trim().toLowerCase();
  const c = String(code || '').trim().toUpperCase();
  if (c === 'A') return true;
  return cls.includes('agri') || cls === 'stw';
}

export function mapAppliedPhase(raw: unknown): '' | '1' | '2' | '3' {
  const s = String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!s) return '';
  if (s === 'III' || s === '3' || s === '03' || s === '3PH' || s === '3PHASE' || s === 'THREE' || s === 'THREEPHASE') {
    return '3';
  }
  if (s === 'II' || s === '2' || s === '02' || s === '2PH' || s === '2PHASE') return '2';
  if (s === 'I' || s === '1' || s === '01' || s === '1PH' || s === '1PHASE' || s === 'SINGLE' || s === 'SINGLEPHASE') {
    return '1';
  }
  return '';
}

export function phaseOf(row: Pick<NscChartRow, 'applied_phase'> & { phase?: unknown }) {
  return mapAppliedPhase(row.applied_phase || row.phase);
}

function poleBinOf(count: number) {
  const n = Number(count) || 0;
  return POLE_BINS.find((b) => n >= b.min && n <= b.max) || POLE_BINS[0];
}

export function nscEventOn(row: NscChartRow) {
  return row.withheld_on || row.collected_on || row.created_on || row.quotation_issue_on || null;
}

function eventOn(row: NscChartRow) {
  return nscEventOn(row);
}

function slabIdOf(row: NscChartRow, clock: NscClock) {
  if (clock === 'processing') return row.processing_slab || 'unknown';
  return row.quotation_age_slab || 'unknown';
}

function daysOf(row: NscChartRow, clock: NscClock) {
  return clock === 'processing' ? row.processing_days : row.quotation_age_days;
}

function matchesCut(days: number, cut: DelayCut) {
  if (!Number.isFinite(days) || days < 0) return false;
  if (cut.op === 'le') return days <= cut.days;
  if (cut.op === 'gt') return days > cut.days;
  const max = cut.daysMax != null ? cut.daysMax : cut.days;
  return days >= cut.days && days <= max;
}

function parseExtraCuts(raw: string | undefined): DelayCut[] {
  const parts = String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12);
  const out: DelayCut[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const m = part.match(/^(le|gt|bt):(\d+)(?:-(\d+))?$/i);
    if (!m) continue;
    const op = m[1].toLowerCase() as DelayOp;
    const a = Number(m[2]);
    const b = m[3] != null ? Number(m[3]) : NaN;
    if (!Number.isFinite(a) || a < 0 || a > 20000) continue;
    let days = a;
    let daysMax: number | undefined;
    let id: string;
    let label: string;
    if (op === 'bt') {
      if (!Number.isFinite(b) || b < 0 || b > 20000) continue;
      days = Math.min(a, b);
      daysMax = Math.max(a, b);
      if (days === daysMax) continue;
      id = `c_bt_${days}_${daysMax}`;
      label = `${days}–${daysMax}d`;
    } else if (op === 'le') {
      id = `c_le_${a}`;
      label = a === 180 ? '≤6m' : a === 365 ? '≤1y' : `≤${a}d`;
    } else {
      id = `c_gt_${a}`;
      label = a === 180 ? '>6m' : a === 365 ? '>1y' : `>${a}d`;
    }
    if (seen.has(id)) continue;
    if (NSC_CUMULATIVE.some((c) => c.op === op && c.days === a && op !== 'bt')) continue;
    seen.add(id);
    out.push({ id, label, op, days, daysMax });
  }
  return out;
}

function numOrNull(v: unknown) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function daysInRange(days: unknown, min: number | null, max: number | null) {
  if (days == null || !Number.isFinite(Number(days)) || Number(days) < 0) return false;
  const d = Number(days);
  if (min != null && d < min) return false;
  if (max != null && d > max) return false;
  return true;
}

function extraFromRemarks(remarks?: string): Record<string, unknown> {
  const raw = String(remarks || '');
  const i = raw.indexOf('\n||NSC||\n');
  if (i < 0) return {};
  try {
    const parsed = JSON.parse(raw.slice(i + '\n||NSC||\n'.length) || '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function hydrateChartRow(row: NscChartRow): NscChartRow {
  const extra = extraFromRemarks(row.remarks);
  const out: NscChartRow = {
    application_no: row.application_no || '',
    consumer_id: row.consumer_id || '',
    consumer_name: row.consumer_name || '',
    phone: row.phone || '',
    status: String(row.status || 'pending').toLowerCase() === 'withheld' ? 'withheld' : String(row.status || 'pending'),
    sap_status: row.sap_status || '',
    stage: row.stage || '',
    division_code: row.division_code || '',
    division_name: row.division_name || row.division_code || '',
    ccc_code: row.ccc_code || '',
    ccc_name: row.ccc_name || row.ccc_code || '',
    consumer_class: row.consumer_class || 'Others',
    quotation_age_days: row.quotation_age_days ?? null,
    processing_days: row.processing_days ?? null,
    quotation_age_slab: row.quotation_age_slab || '',
    processing_slab: row.processing_slab || '',
    pole_count: row.pole_count == null || Number.isNaN(Number(row.pole_count)) ? null : Number(row.pole_count),
    procedure: row.procedure || 'unknown',
    applied_phase: mapAppliedPhase(row.applied_phase || extra.applied_phase || extra.phase),
    applicant_type: row.applicant_type || '',
    agency_name: row.agency_name || '',
    wo_no: String(row.wo_no || extra.wo_no || '').trim(),
    withheld_on: row.withheld_on || null,
    withheld_reason: row.withheld_reason || '',
    collected_on: isoDayOf(row.collected_on) || isoDayOf(extra.collected_on),
    created_on:
      isoDayOf(row.created_on) ||
      isoDayOf(row.applied_on) ||
      isoDayOf(extra.created_on) ||
      isoDayOf(extra.applied_on),
    applied_on: isoDayOf(row.applied_on) || isoDayOf(extra.applied_on),
    quotation_issue_on: isoDayOf(row.quotation_issue_on) || isoDayOf(extra.quotation_issue_on),
    report_date: row.report_date || null,
    remarks: row.remarks || '',
    first_seen_on: row.first_seen_on || null,
  };
  if (out.quotation_age_days != null && !out.quotation_age_slab) {
    out.quotation_age_slab = slabFor(Number(out.quotation_age_days)).id;
  }
  if (out.processing_days != null && !out.processing_slab) {
    out.processing_slab = slabFor(Number(out.processing_days)).id;
  }
  return out;
}

export function filterNscChartRows(rows: NscChartRow[], q: NscDeskQuery = {}) {
  const queue = String(q.queue || '').toLowerCase();
  const division = String(q.division || '');
  const ccc = String(q.ccc || '');
  const klass = String(q.class || q.klass || '');
  const slab = String(q.slab || '');
  const clock: NscClock = String(q.clock || 'quotation') === 'processing' ? 'processing' : 'quotation';
  const timeKey = String(q.time || '');
  const search = String(q.q || '').trim().toLowerCase();
  const applyTime = String(q.apply_time || '1') !== '0';
  const delayMin = numOrNull(q.delay_min);
  const delayMax = numOrNull(q.delay_max);
  const pole = String(q.pole || '').toLowerCase();
  const poleMin = numOrNull(q.pole_min);
  const poleMax = numOrNull(q.pole_max);
  const procedure = String(q.procedure || '').toLowerCase();
  const phase = mapAppliedPhase(q.phase);
  const agri = String(q.agri || '').toLowerCase();
  const agency = String(q.agency || '').trim().toLowerCase();
  const wo = String(q.wo || '').toLowerCase();
  return rows.filter((r) => {
    if (queue === 'pending' && !isPendingQueue({ status: r.status, sap_status: r.sap_status || '' })) return false;
    if (queue === 'withheld' && String(r.status) !== 'withheld') return false;
    if (division && String(r.division_code) !== division) return false;
    if (ccc && String(r.ccc_code) !== ccc) return false;
    if (klass && String(r.consumer_class) !== klass) return false;
    if (slab && slabIdOf(r, clock) !== slab) return false;
    if (delayMin != null || delayMax != null) {
      if (!daysInRange(daysOf(r, clock), delayMin, delayMax)) return false;
    }
    if (pole === 'pole' || pole === 'non_pole' || pole === 'unknown') {
      if (poleKindOf(r) !== pole) return false;
    }
    if (poleMin != null || poleMax != null) {
      const n = poleCountOf(r);
      if (n == null || !daysInRange(n, poleMin, poleMax)) return false;
    }
    if (procedure === 'proc_a' || procedure === 'proc_b' || procedure === 'unknown') {
      if (procedureOf(r) !== procedure) return false;
    }
    if (phase && phaseOf(r) !== phase) return false;
    if (agri === 'agri' && !isAgriClass(r)) return false;
    if (agri === 'non_agri' && isAgriClass(r)) return false;
    if (wo === 'none' && !woNotIssued(r)) return false;
    if (wo === 'issued' && woNotIssued(r)) return false;
    if (agency) {
      const name = String(r.agency_name || '').trim().toLowerCase();
      if (agency === NSC_NO_AGENCY ? name !== '' : name !== agency) return false;
    }
    if (applyTime && timeKey) {
      const iso = eventOn(r);
      if (timeKey.length === 7 && monthOfIso(iso) !== timeKey) return false;
      if (timeKey.length === 4 && yearOfIso(iso) !== timeKey) return false;
    }
    if (search) {
      const blob = `${r.application_no || ''} ${r.consumer_id || ''} ${r.consumer_name || ''} ${r.phone || ''} ${r.ccc_name || ''} ${r.withheld_reason || ''} ${r.agency_name || ''} ${r.wo_no || ''}`.toLowerCase();
      if (!blob.includes(search)) return false;
    }
    return true;
  });
}

export function buildNscDesk(allRows: NscChartRow[], q: NscDeskQuery = {}) {
  const clock: NscClock = String(q.clock || 'quotation') === 'processing' ? 'processing' : 'quotation';
  const queue = String(q.queue || 'pending').toLowerCase();
  const timeKey = String(q.time || '');
  const pendingRows = allRows.filter((r) => isPendingQueue({ status: r.status, sap_status: r.sap_status || '' }));
  const withheldRows = allRows.filter((r) => String(r.status) === 'withheld');
  const scoped = filterNscChartRows(allRows, { ...q, apply_time: '0', queue });
  const view = filterNscChartRows(allRows, { ...q, queue });
  const chartRows = filterNscChartRows(allRows, {
    ...q,
    queue,
    slab: '',
    delay_min: '',
    delay_max: '',
  });

  const divisions = new Map<string, string>();
  const cccs = new Map<string, string>();
  const classes = new Set<string>();
  const years = new Set<string>();
  for (const r of allRows) {
    if (r.division_code) divisions.set(String(r.division_code), r.division_name || r.division_code);
    if (r.ccc_code) {
      if (!q.division || String(r.division_code) === String(q.division)) {
        cccs.set(String(r.ccc_code), r.ccc_name || r.ccc_code);
      }
    }
    if (r.consumer_class) classes.add(r.consumer_class);
  }
  for (const r of scoped) {
    const y = yearOfIso(eventOn(r));
    if (y) years.add(y);
  }

  const extraCuts = parseExtraCuts(q.cuts);
  const allCuts = [...NSC_CUMULATIVE, ...extraCuts];
  const HOT_SLABS = new Set(['m1_3', 'm3_6', 'm6_12', 'y1']);
  const CRITICAL_SLABS = new Set(['m6_12', 'y1']);
  const byDivision = new Map<string, Record<string, string | number>>();
  const byCcc = new Map<
    string,
    {
      code: string;
      name: string;
      count: number;
      hot: number;
      critical: number;
      delay_sum: number;
      delay_n: number;
      non_pole: number;
      pole: number;
      hot_non_pole: number;
      hot_pole: number;
      poles_sum: number;
      proc_a: number;
      proc_b: number;
      hot_proc_b: number;
    }
  >();
  const byClass = new Map<string, number>();
  const bySlab = new Map<string, number>();
  const byCum = new Map<string, number>();
  const reasons = new Map<string, number>();
  const ages: number[] = [];
  let gtYear = 0;
  let stuck30 = 0;
  let stuck180 = 0;
  for (const cut of allCuts) byCum.set(cut.id, 0);

  function ensureDiv(r: NscChartRow) {
    const divName = r.division_name || r.division_code || 'Unknown';
    if (!byDivision.has(divName)) {
      const rec: Record<string, string | number> = {
        name: divName,
        code: r.division_code || '',
        total: 0,
        hot: 0,
        critical: 0,
        delay_sum: 0,
        delay_n: 0,
        non_pole: 0,
        pole: 0,
        poles_sum: 0,
        proc_a: 0,
        proc_b: 0,
        hot_proc_b: 0,
        unknown: 0,
      };
      for (const s of SLABS) rec[s.id] = 0;
      for (const cut of allCuts) rec[cut.id] = 0;
      byDivision.set(divName, rec);
    }
    return byDivision.get(divName)!;
  }

  const byPoleBin = new Map<string, number>();
  for (const b of POLE_BINS) byPoleBin.set(b.id, 0);
  let mixNonPole = 0;
  let mixPole = 0;
  let mixUnknown = 0;
  let mixPolesSum = 0;
  let mixHotNonPole = 0;
  let mixHotPole = 0;
  let mixProcA = 0;
  let mixProcB = 0;
  let mixProcUnknown = 0;
  let mixHotProcA = 0;
  let mixHotProcB = 0;

  for (const r of chartRows) {
    const rec = ensureDiv(r);
    const sid = slabIdOf(r, clock) || 'unknown';
    rec[sid] = Number(rec[sid] || 0) + 1;
    rec.total = Number(rec.total) + 1;
    bySlab.set(sid, (bySlab.get(sid) || 0) + 1);
    const d = Number(daysOf(r, clock));
    if (Number.isFinite(d) && d >= 0) {
      rec.delay_sum = Number(rec.delay_sum) + d;
      rec.delay_n = Number(rec.delay_n) + 1;
    }
    if (HOT_SLABS.has(sid)) rec.hot = Number(rec.hot) + 1;
    if (CRITICAL_SLABS.has(sid)) rec.critical = Number(rec.critical) + 1;
    for (const cut of allCuts) {
      if (matchesCut(d, cut)) {
        rec[cut.id] = Number(rec[cut.id] || 0) + 1;
        byCum.set(cut.id, (byCum.get(cut.id) || 0) + 1);
      }
    }
    const kind = poleKindOf(r);
    const poles = poleCountOf(r) || 0;
    if (kind === 'pole') {
      mixPole += 1;
      rec.pole = Number(rec.pole) + 1;
      rec.poles_sum = Number(rec.poles_sum) + poles;
      mixPolesSum += poles;
      if (HOT_SLABS.has(sid)) mixHotPole += 1;
    } else if (kind === 'non_pole') {
      mixNonPole += 1;
      rec.non_pole = Number(rec.non_pole) + 1;
      if (HOT_SLABS.has(sid)) mixHotNonPole += 1;
    } else {
      mixUnknown += 1;
    }
    const bin = poleBinOf(kind === 'unknown' ? 0 : poles);
    if (kind !== 'unknown') byPoleBin.set(bin.id, (byPoleBin.get(bin.id) || 0) + 1);
    const proc = procedureOf(r);
    if (proc === 'proc_b') {
      mixProcB += 1;
      rec.proc_b = Number(rec.proc_b) + 1;
      if (HOT_SLABS.has(sid)) {
        mixHotProcB += 1;
        rec.hot_proc_b = Number(rec.hot_proc_b) + 1;
      }
    } else if (proc === 'proc_a') {
      mixProcA += 1;
      rec.proc_a = Number(rec.proc_a) + 1;
      if (HOT_SLABS.has(sid)) mixHotProcA += 1;
    } else mixProcUnknown += 1;
  }

  for (const r of view) {
    const cccName = r.ccc_name || r.ccc_code || 'Unknown';
    if (!byCcc.has(cccName)) {
      byCcc.set(cccName, {
        code: r.ccc_code || '',
        name: cccName,
        count: 0,
        hot: 0,
        critical: 0,
        delay_sum: 0,
        delay_n: 0,
        non_pole: 0,
        pole: 0,
        hot_non_pole: 0,
        hot_pole: 0,
        poles_sum: 0,
        proc_a: 0,
        proc_b: 0,
        hot_proc_b: 0,
      });
    }
    const cccRec = byCcc.get(cccName)!;
    cccRec.count += 1;
    const cls = r.consumer_class || 'Others';
    byClass.set(cls, (byClass.get(cls) || 0) + 1);
    const sid = slabIdOf(r, clock) || 'unknown';
    const d = Number(daysOf(r, clock));
    if (Number.isFinite(d) && d >= 0) {
      ages.push(d);
      cccRec.delay_sum += d;
      cccRec.delay_n += 1;
    }
    if (HOT_SLABS.has(sid)) {
      cccRec.hot += 1;
      stuck30 += 1;
    }
    if (CRITICAL_SLABS.has(sid)) {
      cccRec.critical += 1;
      stuck180 += 1;
    }
    const kind = poleKindOf(r);
    const poles = poleCountOf(r) || 0;
    if (kind === 'pole') {
      cccRec.pole += 1;
      cccRec.poles_sum += poles;
      if (HOT_SLABS.has(sid)) cccRec.hot_pole += 1;
    } else if (kind === 'non_pole') {
      cccRec.non_pole += 1;
      if (HOT_SLABS.has(sid)) cccRec.hot_non_pole += 1;
    }
    const proc = procedureOf(r);
    if (proc === 'proc_b') {
      cccRec.proc_b += 1;
      if (HOT_SLABS.has(sid)) cccRec.hot_proc_b += 1;
    } else if (proc === 'proc_a') cccRec.proc_a += 1;
    if (sid === 'y1') gtYear += 1;
    if (queue === 'withheld') {
      const reason = String(r.withheld_reason || '').trim() || 'Not recorded';
      reasons.set(reason, (reasons.get(reason) || 0) + 1);
    }
  }

  const divNames = [...new Set(scoped.map((r) => r.division_name || r.division_code).filter(Boolean))];
  const timeline =
    queue === 'withheld'
      ? buildWithheldTimeline(scoped as unknown as import('./nsc').NscRow[], {
          grain: 'month',
          year: timeKey.length === 4 ? timeKey : '',
          divisions: divNames,
        })
      : [];

  return {
    report_date: allRows[0]?.report_date || null,
    pending: pendingRows.length,
    withheld: withheldRows.length,
    view: view.length,
    mix_total: chartRows.length,
    avg_days: ages.length ? Math.round(ages.reduce((s, n) => s + n, 0) / ages.length) : 0,
    gt_year: gtYear,
    stuck_30: stuck30,
    stuck_180: stuck180,
    pole: {
      non_pole: mixNonPole,
      pole: mixPole,
      unknown: mixUnknown,
      poles_sum: mixPolesSum,
      hot_non_pole: mixHotNonPole,
      hot_pole: mixHotPole,
      avg_poles: mixPole ? Math.round((10 * mixPolesSum) / mixPole) / 10 : 0,
    },
    by_pole_bin: POLE_BINS.map((b) => ({
      id: b.id,
      name: b.label,
      min: b.min,
      max: b.max === Infinity ? null : b.max,
      count: byPoleBin.get(b.id) || 0,
    })),
    procedure: {
      proc_a: mixProcA,
      proc_b: mixProcB,
      unknown: mixProcUnknown,
      hot_proc_a: mixHotProcA,
      hot_proc_b: mixHotProcB,
    },
    divisions: [...divisions.entries()]
      .sort((a, b) => String(a[1]).localeCompare(String(b[1])))
      .map(([code, name]) => ({ code, name })),
    cccs: [...cccs.entries()]
      .sort((a, b) => String(a[1]).localeCompare(String(b[1])))
      .map(([code, name]) => ({ code, name })),
    classes: [...classes].sort(),
    years: [...years].sort(),
    by_division: [...byDivision.values()]
      .map((d): Record<string, string | number> => ({
        ...d,
        avg_days: Number(d.delay_n) ? Math.round(Number(d.delay_sum) / Number(d.delay_n)) : 0,
        hot_pct: Number(d.total) ? Math.round((1000 * Number(d.hot)) / Number(d.total)) / 10 : 0,
      }))
      .sort((a, b) => Number(b.hot) - Number(a.hot) || Number(b.total) - Number(a.total)),
    by_ccc: [...byCcc.values()]
      .map((c) => ({
        code: c.code,
        name: c.name,
        count: c.count,
        hot: c.hot,
        critical: c.critical,
        avg_days: c.delay_n ? Math.round(c.delay_sum / c.delay_n) : 0,
        hot_pct: c.count ? Math.round((1000 * c.hot) / c.count) / 10 : 0,
        non_pole: c.non_pole || 0,
        pole: c.pole || 0,
        hot_non_pole: c.hot_non_pole || 0,
        hot_pole: c.hot_pole || 0,
        poles_sum: c.poles_sum || 0,
        proc_a: c.proc_a || 0,
        proc_b: c.proc_b || 0,
        hot_proc_b: c.hot_proc_b || 0,
      }))
      .sort((a, b) => b.hot - a.hot || b.hot_pct - a.hot_pct)
      .slice(0, 21),
    by_class: [...byClass.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    by_slab: SLABS.map((s) => ({
      id: s.id,
      name: s.label,
      count: bySlab.get(s.id) || 0,
    })),
    by_cumulative: allCuts.map((c) => ({
      id: c.id,
      name: c.label,
      op: c.op,
      days: c.days,
      days_max: c.daysMax,
      count: byCum.get(c.id) || 0,
      custom: !!c.id && String(c.id).startsWith('c_'),
    })),
    timeline,
    timeline_divisions: divNames,
    reasons: [...reasons.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12),
  };
}

export function overlayNscOffices(
  desk: ReturnType<typeof buildNscDesk>,
  offices: { divisions: NscOfficeOpt[]; cccs: NscOfficeOpt[] },
  division?: string
) {
  if (offices.divisions.length) desk.divisions = offices.divisions;
  if (offices.cccs.length) {
    desk.cccs = offices.cccs
      .filter((c) => !division || String(c.division_code) === String(division))
      .map((c) => ({ code: c.code, name: c.name }));
  }
  return desk;
}
