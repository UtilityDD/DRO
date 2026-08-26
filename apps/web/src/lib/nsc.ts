export type NscQueue = 'pending' | 'withheld';
export type NscClock = 'quotation' | 'processing';

export type NscRow = {
  application_no: string;
  consumer_id: string;
  consumer_name: string;
  phone: string;
  consumer_class: string;
  class_code?: string;
  ccc_code: string;
  ccc_name: string;
  division_code: string;
  division_name: string;
  status: string;
  sap_status: string;
  created_on: string | null;
  applied_on?: string | null;
  quotation_issue_on: string | null;
  collected_on: string | null;
  wo_no: string;
  wo_issued?: string;
  agency_name: string;
  withheld_on: string | null;
  withheld_reason: string;
  quotation_age_days: number | null;
  processing_days: number | null;
  quotation_age_slab: string;
  quotation_age_label: string;
  processing_slab: string;
  processing_label: string;
  report_date: string | null;
  load_kw?: number;
  pole_count?: number | null;
  pole_kind?: 'pole' | 'non_pole' | 'unknown';
  applicant_type?: string;
  procedure?: 'proc_a' | 'proc_b' | 'unknown';
  procedure_label?: string;
  complex_name?: string;
};

export const NSC_SLABS = [
  { id: 'd0_3', label: '≤3d' },
  { id: 'd3_7', label: '3–7d' },
  { id: 'd7_15', label: '7–15d' },
  { id: 'd15_30', label: '15–30d' },
  { id: 'm1_3', label: '1–3m' },
  { id: 'm3_6', label: '3–6m' },
  { id: 'm6_12', label: '6–12m' },
  { id: 'y1', label: '>1y' },
] as const;

export type DelayOp = 'le' | 'gt' | 'bt';

export type DelayCut = {
  id: string;
  label: string;
  op: DelayOp;
  days: number;
  daysMax?: number;
  custom?: boolean;
};

export const NSC_CUMULATIVE: DelayCut[] = [
  { id: 'le3', label: '≤3d', op: 'le', days: 3 },
  { id: 'le7', label: '≤7d', op: 'le', days: 7 },
  { id: 'gt7', label: '>7d', op: 'gt', days: 7 },
  { id: 'gt15', label: '>15d', op: 'gt', days: 15 },
  { id: 'gt30', label: '>30d', op: 'gt', days: 30 },
  { id: 'gt90', label: '>90d', op: 'gt', days: 90 },
  { id: 'gt180', label: '>6m', op: 'gt', days: 180 },
  { id: 'gt365', label: '>1y', op: 'gt', days: 365 },
];

const SLAB_POS: Record<string, number> = {
  d0_3: 3,
  d3_7: 7,
  d7_15: 15,
  d15_30: 30,
  m1_3: 90,
  m3_6: 180,
  m6_12: 365,
  y1: 400,
};

export function delayCutId(op: DelayOp, days: number, daysMax?: number) {
  if (op === 'bt') return `c_bt_${days}_${daysMax ?? days}`;
  return `c_${op}_${days}`;
}

function delayDaysShort(days: number) {
  if (days === 180) return '6m';
  if (days === 365) return '1y';
  return `${days}d`;
}

export function delayCutLabel(op: DelayOp, days: number, daysMax?: number) {
  if (op === 'le') return `≤${delayDaysShort(days)}`;
  if (op === 'gt') return `>${delayDaysShort(days)}`;
  return `${days}–${daysMax ?? days}d`;
}

export function makeCustomCut(op: DelayOp, a: number, b?: number): DelayCut | null {
  const x = Math.max(0, Math.round(Number(a) || 0));
  const y = Math.max(0, Math.round(Number(b) || 0));
  if (x > 20000 || y > 20000) return null;
  const days = op === 'bt' ? Math.min(x, y) : x;
  const daysMax = op === 'bt' ? Math.max(x, y) : undefined;
  if (op === 'bt' && days === daysMax) return null;
  return {
    id: delayCutId(op, days, daysMax),
    label: delayCutLabel(op, days, daysMax),
    op,
    days,
    daysMax,
    custom: true,
  };
}

export function encodeCutsParam(cuts: DelayCut[]) {
  return cuts
    .filter((c) => c.custom)
    .map((c) => (c.op === 'bt' ? `bt:${c.days}-${c.daysMax}` : `${c.op}:${c.days}`))
    .join(',');
}

export function cutSortKey(cut: Pick<DelayCut, 'op' | 'days' | 'daysMax'>, exclusive = false) {
  if (exclusive) {
    if (cut.op === 'bt') return cut.daysMax ?? cut.days;
    return cut.days;
  }
  if (cut.op === 'le') return cut.days;
  if (cut.op === 'bt') return 5000 + cut.days;
  return 10000 + cut.days;
}

export function mergeDelayCuts(custom: DelayCut[], exclusive: boolean) {
  if (exclusive) {
    const slabs = NSC_SLABS.map((s) => ({
      id: s.id,
      label: s.label,
      sort: SLAB_POS[s.id] ?? 99,
      custom: false as boolean,
    }));
    const extra = custom
      .filter((c) => c.op === 'bt')
      .map((c) => ({
        id: c.id,
        label: c.label,
        sort: cutSortKey(c, true),
        custom: true,
        cut: c,
      }));
    return [...slabs.map((s) => ({ ...s, cut: undefined as DelayCut | undefined })), ...extra]
      .sort((a, b) => a.sort - b.sort || Number(a.custom) - Number(b.custom))
      .map((row) => ({
        id: row.id,
        label: row.label,
        custom: row.custom,
        cut: row.cut,
      }));
  }
  return [...NSC_CUMULATIVE, ...custom.filter((c) => c.op !== 'bt')]
    .sort((a, b) => cutSortKey(a) - cutSortKey(b) || Number(!!a.custom) - Number(!!b.custom))
    .map((c) => ({ id: c.id, label: c.label, custom: !!c.custom, cut: c }));
}

export function customCutFill(cut: DelayCut) {
  if (cut.op === 'le') return '#0f766e';
  if (cut.op === 'bt') return '#6366f1';
  if (cut.days >= 180) return '#7f1d1d';
  if (cut.days >= 90) return '#b91c1c';
  if (cut.days >= 30) return '#ea580c';
  return '#7c3aed';
}

export function isSameBuiltInCut(cut: DelayCut) {
  return NSC_CUMULATIVE.some((c) => c.op === cut.op && c.days === cut.days && cut.op !== 'bt');
}

export function loadCustomDelayCuts(storageKey: string): DelayCut[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: DelayCut[] = [];
    const seen = new Set<string>();
    for (const row of parsed) {
      const op = row?.op === 'le' || row?.op === 'gt' || row?.op === 'bt' ? row.op : null;
      if (!op) continue;
      const cut = makeCustomCut(op, Number(row.days), row.daysMax != null ? Number(row.daysMax) : undefined);
      if (!cut || seen.has(cut.id) || isSameBuiltInCut(cut)) continue;
      seen.add(cut.id);
      out.push(cut);
    }
    return out.slice(0, 12);
  } catch {
    return [];
  }
}

export function saveCustomDelayCuts(storageKey: string, cuts: DelayCut[]) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(cuts.filter((c) => c.custom).slice(0, 12)));
  } catch {
    /* ignore quota */
  }
}

export const CUM_COLORS: Record<string, string> = {
  le3: '#059669',
  le7: '#10b981',
  gt7: '#eab308',
  gt15: '#f59e0b',
  gt30: '#f97316',
  gt90: '#ef4444',
  gt180: '#dc2626',
  gt365: '#991b1b',
};

export const SLAB_COLORS: Record<string, string> = {
  d0_3: '#059669',
  d3_7: '#10b981',
  d7_15: '#84cc16',
  d15_30: '#eab308',
  m1_3: '#f59e0b',
  m3_6: '#f97316',
  m6_12: '#ef4444',
  y1: '#b91c1c',
};

export function isPendingQueue(row: Pick<NscRow, 'status' | 'sap_status'>) {
  const st = String(row.status || '').toLowerCase();
  const sap = String(row.sap_status || '').toLowerCase();
  if (st === 'withheld' || sap === 'withheld') return false;
  if (st === 'completed' || sap === 'completed') return false;
  return true;
}

export function asNscRow(raw: Record<string, unknown>): NscRow {
  return {
    application_no: String(raw.application_no || ''),
    consumer_id: String(raw.consumer_id || ''),
    consumer_name: String(raw.consumer_name || ''),
    phone: String(raw.phone || ''),
    consumer_class: String(raw.consumer_class || raw.category || 'Others'),
    class_code: String(raw.class_code || ''),
    ccc_code: String(raw.ccc_code || ''),
    ccc_name: String(raw.ccc_name || raw.ccc_code || ''),
    division_code: String(raw.division_code || ''),
    division_name: String(raw.division_name || raw.division_code || ''),
    status: String(raw.status || 'pending'),
    sap_status: String(raw.sap_status || raw.stage || 'working'),
    created_on: raw.created_on ? String(raw.created_on).slice(0, 10) : raw.applied_on ? String(raw.applied_on).slice(0, 10) : null,
    applied_on: raw.applied_on ? String(raw.applied_on).slice(0, 10) : null,
    quotation_issue_on: raw.quotation_issue_on ? String(raw.quotation_issue_on).slice(0, 10) : null,
    collected_on: raw.collected_on ? String(raw.collected_on).slice(0, 10) : null,
    wo_no: String(raw.wo_no || ''),
    wo_issued: String(raw.wo_issued || ''),
    agency_name: String(raw.agency_name || ''),
    withheld_on: raw.withheld_on ? String(raw.withheld_on).slice(0, 10) : null,
    withheld_reason: String(raw.withheld_reason || raw.remarks || ''),
    quotation_age_days: raw.quotation_age_days == null ? (raw.delay_days as number) ?? null : Number(raw.quotation_age_days),
    processing_days: raw.processing_days == null ? null : Number(raw.processing_days),
    quotation_age_slab: String(raw.quotation_age_slab || ''),
    quotation_age_label: String(raw.quotation_age_label || ''),
    processing_slab: String(raw.processing_slab || ''),
    processing_label: String(raw.processing_label || ''),
    report_date: raw.report_date ? String(raw.report_date).slice(0, 10) : null,
    load_kw: Number(raw.load_kw || 0) || 0,
    pole_count: raw.pole_count == null || raw.pole_count === '' ? null : Number(raw.pole_count),
    pole_kind:
      raw.pole_kind === 'pole' || raw.pole_kind === 'non_pole' || raw.pole_kind === 'unknown'
        ? raw.pole_kind
        : raw.pole_count == null
          ? 'unknown'
          : Number(raw.pole_count) > 0
            ? 'pole'
            : 'non_pole',
    applicant_type: String(raw.applicant_type || ''),
    procedure:
      raw.procedure === 'proc_a' || raw.procedure === 'proc_b' || raw.procedure === 'unknown'
        ? raw.procedure
        : /promoter|developer|housing|complex/i.test(String(raw.applicant_type || ''))
          ? 'proc_b'
          : raw.applicant_type
            ? 'proc_a'
            : 'unknown',
    procedure_label: String(raw.procedure_label || ''),
    complex_name: String(raw.complex_name || ''),
  };
}

export function slabOf(row: NscRow, clock: NscClock) {
  if (clock === 'processing') {
    return { id: row.processing_slab || 'unknown', label: row.processing_label || 'Unknown' };
  }
  return { id: row.quotation_age_slab || 'unknown', label: row.quotation_age_label || 'Unknown' };
}

export function daysOf(row: NscRow, clock: NscClock) {
  return clock === 'processing' ? row.processing_days : row.quotation_age_days;
}

export function fmtDay(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function procedureLabel(procedure?: string | null, applicantType?: string | null) {
  if (procedure === 'proc_b') return 'Proc. B';
  if (procedure === 'proc_a') return 'Individual';
  if (applicantType) return applicantType;
  return '—';
}

export function poleLabel(kind?: string | null, count?: number | null) {
  if (kind === 'pole') return count && count > 0 ? `${count} poles` : 'Pole';
  if (kind === 'non_pole') return 'Non-pole';
  return '—';
}

export function fmtInt(n: number) {
  return n.toLocaleString('en-IN');
}

/** Date used to place a withheld case on the historical timeline. */
export function withheldEventOn(row: NscRow): string | null {
  return row.withheld_on || row.collected_on || row.created_on || row.quotation_issue_on || null;
}

export function yearOfIso(iso: string | null): string | null {
  if (!iso || iso.length < 4) return null;
  const y = Number(iso.slice(0, 4));
  if (!Number.isFinite(y) || y < 2000 || y > 2035) return null;
  return String(y);
}

export function monthOfIso(iso: string | null): string | null {
  if (!iso || iso.length < 7) return null;
  if (!yearOfIso(iso)) return null;
  return iso.slice(0, 7);
}

export function monthYearLabel(ym: string) {
  if (!ym || ym.length < 7) return ym;
  const month = Number(ym.slice(5, 7));
  const yy = ym.slice(2, 4);
  if (!Number.isFinite(month) || month < 1 || month > 12) return ym;
  return `${month}/${yy}`;
}

function eachMonth(fromYm: string, toYm: string) {
  const out: string[] = [];
  let y = Number(fromYm.slice(0, 4));
  let m = Number(fromYm.slice(5, 7));
  const y2 = Number(toYm.slice(0, 4));
  const m2 = Number(toYm.slice(5, 7));
  if (![y, m, y2, m2].every(Number.isFinite)) return out;
  while (y < y2 || (y === y2 && m <= m2)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (out.length > 240) break;
  }
  return out;
}

export type WithheldTimelinePoint = {
  key: string;
  label: string;
  added: number;
  cumulative: number;
  [k: string]: string | number;
};

export function buildWithheldTimeline(
  rows: NscRow[],
  opts: { grain: 'year' | 'month'; year?: string; divisions: string[] }
): WithheldTimelinePoint[] {
  const divs = opts.divisions;
  const empty = (): Record<string, number> => {
    const rec: Record<string, number> = { added: 0 };
    for (const d of divs) rec[d] = 0;
    return rec;
  };

  if (opts.grain === 'month') {
    const year = String(opts.year || '');
    const buckets = new Map<string, Record<string, number>>();
    const seen: string[] = [];
    for (const r of rows) {
      const ym = monthOfIso(withheldEventOn(r));
      if (!ym) continue;
      if (year && ym.slice(0, 4) !== year) continue;
      const rec = buckets.get(ym) || empty();
      rec.added += 1;
      const div = r.division_name || r.division_code || 'Unknown';
      rec[div] = (rec[div] || 0) + 1;
      buckets.set(ym, rec);
      seen.push(ym);
    }
    let keys: string[];
    if (year && year.length === 4) {
      keys = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
    } else if (seen.length) {
      const sortedSeen = [...new Set(seen)].sort();
      keys = eachMonth(sortedSeen[0], sortedSeen[sortedSeen.length - 1]);
    } else {
      return [];
    }
    let run = 0;
    return keys.map((key) => {
      const rec = buckets.get(key) || empty();
      run += rec.added;
      return {
        key,
        label: monthYearLabel(key),
        added: rec.added,
        cumulative: run,
        ...rec,
      };
    });
  }

  const years = new Set<string>();
  const buckets = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const y = yearOfIso(withheldEventOn(r));
    if (!y) continue;
    years.add(y);
    const rec = buckets.get(y) || empty();
    rec.added += 1;
    const div = r.division_name || r.division_code || 'Unknown';
    rec[div] = (rec[div] || 0) + 1;
    buckets.set(y, rec);
  }
  if (!years.size) return [];
  const sorted = [...years].sort();
  const min = Number(sorted[0]);
  const max = Number(sorted[sorted.length - 1]);
  let run = 0;
  const out: WithheldTimelinePoint[] = [];
  for (let y = min; y <= max; y += 1) {
    const key = String(y);
    const rec = buckets.get(key) || empty();
    run += rec.added;
    out.push({ key, label: key, added: rec.added, cumulative: run, ...rec });
  }
  return out;
}
