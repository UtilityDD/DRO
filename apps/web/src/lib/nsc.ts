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
};

export const NSC_SLABS = [
  { id: 'd0_3', label: 'Within 3 days' },
  { id: 'd3_7', label: '3–7 days' },
  { id: 'd7_15', label: '7–15 days' },
  { id: 'd15_30', label: '15–30 days' },
  { id: 'm1_3', label: '1–3 months' },
  { id: 'm3_6', label: '3–6 months' },
  { id: 'm6_12', label: '6–12 months' },
  { id: 'y1', label: 'More than 1 year' },
  { id: 'unknown', label: 'Unknown' },
] as const;

export const SLAB_COLORS: Record<string, string> = {
  d0_3: '#059669',
  d3_7: '#10b981',
  d7_15: '#84cc16',
  d15_30: '#eab308',
  m1_3: '#f59e0b',
  m3_6: '#f97316',
  m6_12: '#ef4444',
  y1: '#b91c1c',
  unknown: '#94a3b8',
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

const MONTH_LABEL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
    const year = opts.year || '';
    const buckets = new Map<string, Record<string, number>>();
    for (let m = 1; m <= 12; m += 1) {
      buckets.set(`${year}-${String(m).padStart(2, '0')}`, empty());
    }
    for (const r of rows) {
      const ym = monthOfIso(withheldEventOn(r));
      if (!ym || ym.slice(0, 4) !== year) continue;
      const rec = buckets.get(ym) || empty();
      rec.added += 1;
      const div = r.division_name || r.division_code || 'Unknown';
      rec[div] = (rec[div] || 0) + 1;
      buckets.set(ym, rec);
    }
    let run = 0;
    return [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, rec]) => {
      run += rec.added;
      const month = Number(key.slice(5, 7));
      return {
        key,
        label: MONTH_LABEL[month - 1] || key,
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
