import { NSC_SLABS, type DelayCut, type NscClock } from './nsc';
import { filterNscChartRows, type NscChartRow, type NscDeskQuery } from './nscDesk';

export type OfficeGrain = 'division' | 'ccc';

export type StackedOffice = {
  code: string;
  name: string;
  total: number;
  hot: number;
  [k: string]: string | number;
};

const HOT = new Set(['m1_3', 'm3_6', 'm6_12', 'y1']);

function slabId(row: NscChartRow, clock: NscClock) {
  if (clock === 'processing') return row.processing_slab || 'unknown';
  return row.quotation_age_slab || 'unknown';
}

function poleKind(row: NscChartRow): 'pole' | 'non_pole' | 'unknown' {
  if (row.pole_count == null) return 'unknown';
  return Number(row.pole_count) > 0 ? 'pole' : 'non_pole';
}

export function facetQuery(q: NscDeskQuery, clear: Partial<NscDeskQuery>): NscDeskQuery {
  return { ...q, ...clear };
}

export function facetRows(rows: NscChartRow[], q: NscDeskQuery, clear: Partial<NscDeskQuery> = {}) {
  return filterNscChartRows(rows, facetQuery(q, clear));
}

export function stackOffices(rows: NscChartRow[], grain: OfficeGrain, clock: NscClock): StackedOffice[] {
  const map = new Map<string, StackedOffice>();
  for (const r of rows) {
    const code = grain === 'ccc' ? String(r.ccc_code || '') : String(r.division_code || '');
    const name = grain === 'ccc' ? r.ccc_name || r.ccc_code || 'Unknown' : r.division_name || r.division_code || 'Unknown';
    const key = code || name;
    if (!map.has(key)) {
      const rec: StackedOffice = { code, name, total: 0, hot: 0 };
      for (const s of NSC_SLABS) rec[s.id] = 0;
      rec.unknown = 0;
      map.set(key, rec);
    }
    const rec = map.get(key)!;
    const sid = slabId(r, clock) || 'unknown';
    rec[sid] = Number(rec[sid] || 0) + 1;
    rec.total += 1;
    if (HOT.has(sid)) rec.hot += 1;
  }
  return [...map.values()].sort((a, b) => b.total - a.total || String(a.name).localeCompare(String(b.name)));
}

export function countClasses(rows: NscChartRow[]) {
  const map = new Map<string, number>();
  for (const r of rows) {
    const name = r.consumer_class || 'Others';
    map.set(name, (map.get(name) || 0) + 1);
  }
  return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

export function countPoles(rows: NscChartRow[]) {
  let non_pole = 0;
  let pole = 0;
  let unknown = 0;
  let poles_sum = 0;
  for (const r of rows) {
    const kind = poleKind(r);
    if (kind === 'pole') {
      pole += 1;
      poles_sum += Number(r.pole_count || 0);
    } else if (kind === 'non_pole') non_pole += 1;
    else unknown += 1;
  }
  return { non_pole, pole, unknown, poles_sum };
}

export function countProcs(rows: NscChartRow[]) {
  let proc_a = 0;
  let proc_b = 0;
  for (const r of rows) {
    if (r.procedure === 'proc_b') proc_b += 1;
    else if (r.procedure === 'proc_a') proc_a += 1;
  }
  return { proc_a, proc_b };
}

export function countSlabs(rows: NscChartRow[], clock: NscClock) {
  const map = new Map<string, number>();
  for (const s of NSC_SLABS) map.set(s.id, 0);
  for (const r of rows) {
    const sid = slabId(r, clock) || 'unknown';
    map.set(sid, (map.get(sid) || 0) + 1);
  }
  return NSC_SLABS.map((s) => ({ id: s.id, name: s.label, count: map.get(s.id) || 0 }));
}

export type NscSumRow = {
  key: string;
  label: string;
  count: number;
  pct: number;
  non_pole: number;
  pole: number;
  poles_sum: number;
  industrial: number;
  proc_b: number;
  hot: number;
  avg_days: number | null;
};

type SumAcc = {
  label: string;
  count: number;
  non_pole: number;
  pole: number;
  poles_sum: number;
  industrial: number;
  proc_b: number;
  hot: number;
  daySum: number;
  dayN: number;
};

function emptyAcc(label: string): SumAcc {
  return { label, count: 0, non_pole: 0, pole: 0, poles_sum: 0, industrial: 0, proc_b: 0, hot: 0, daySum: 0, dayN: 0 };
}

function addToAcc(acc: SumAcc, row: NscChartRow, clock: NscClock) {
  acc.count += 1;
  const kind = poleKind(row);
  if (kind === 'non_pole') acc.non_pole += 1;
  else if (kind === 'pole') {
    acc.pole += 1;
    acc.poles_sum += Number(row.pole_count || 0);
  }
  if (String(row.consumer_class || '').toLowerCase() === 'industrial') acc.industrial += 1;
  if (row.procedure === 'proc_b') acc.proc_b += 1;
  if (HOT.has(slabId(row, clock))) acc.hot += 1;
  const days = clock === 'processing' ? row.processing_days : row.quotation_age_days;
  if (days != null && Number.isFinite(days)) {
    acc.daySum += days;
    acc.dayN += 1;
  }
}

function finishAcc(key: string, acc: SumAcc, total: number): NscSumRow {
  return {
    key,
    label: acc.label,
    count: acc.count,
    pct: total ? Math.round((1000 * acc.count) / total) / 10 : 0,
    non_pole: acc.non_pole,
    pole: acc.pole,
    poles_sum: acc.poles_sum,
    industrial: acc.industrial,
    proc_b: acc.proc_b,
    hot: acc.hot,
    avg_days: acc.dayN ? Math.round(acc.daySum / acc.dayN) : null,
  };
}

export function summarizeBy(
  rows: NscChartRow[],
  clock: NscClock,
  pick: (row: NscChartRow) => { key: string; label: string }
): NscSumRow[] {
  const map = new Map<string, SumAcc>();
  for (const row of rows) {
    const { key, label } = pick(row);
    const id = key || label || 'unknown';
    if (!map.has(id)) map.set(id, emptyAcc(label || id));
    addToAcc(map.get(id)!, row, clock);
  }
  const total = rows.length;
  return [...map.entries()]
    .map(([key, acc]) => finishAcc(key, acc, total))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function summarizeOffices(rows: NscChartRow[], grain: OfficeGrain, clock: NscClock) {
  return summarizeBy(rows, clock, (row) =>
    grain === 'ccc'
      ? { key: String(row.ccc_code || row.ccc_name || 'unknown'), label: row.ccc_name || row.ccc_code || 'Unknown' }
      : { key: String(row.division_code || row.division_name || 'unknown'), label: row.division_name || row.division_code || 'Unknown' }
  );
}

export function summarizeSlabs(rows: NscChartRow[], clock: NscClock) {
  const grouped = summarizeBy(rows, clock, (row) => {
    const id = slabId(row, clock) || 'unknown';
    const label = NSC_SLABS.find((s) => s.id === id)?.label || 'Unknown';
    return { key: id, label };
  });
  const byId = new Map(grouped.map((r) => [r.key, r]));
  const total = rows.length;
  const out = NSC_SLABS.map((s) => byId.get(s.id) || finishAcc(s.id, emptyAcc(s.label), total));
  const unknown = byId.get('unknown');
  if (unknown && unknown.count) out.push(unknown);
  return out;
}

function matchesCut(days: number, cut: DelayCut) {
  if (!Number.isFinite(days) || days < 0) return false;
  if (cut.op === 'le') return days <= cut.days;
  if (cut.op === 'gt') return days > cut.days;
  const max = cut.daysMax != null ? cut.daysMax : cut.days;
  return days >= cut.days && days <= max;
}

export function summarizeRanges(
  rows: NscChartRow[],
  clock: NscClock,
  ranges: { id: string; label: string; cut?: DelayCut }[]
): NscSumRow[] {
  const total = rows.length;
  return ranges.map((range) => {
    const acc = emptyAcc(range.label);
    for (const row of rows) {
      if (range.cut) {
        const days = clock === 'processing' ? row.processing_days : row.quotation_age_days;
        if (days == null || !matchesCut(Number(days), range.cut)) continue;
      } else if (slabId(row, clock) !== range.id) continue;
      addToAcc(acc, row, clock);
    }
    return finishAcc(range.id, acc, total);
  });
}

export function sumFooter(rows: NscSumRow[], total: number): NscSumRow {
  const acc = emptyAcc('Total');
  for (const r of rows) {
    acc.count += r.count;
    acc.non_pole += r.non_pole;
    acc.pole += r.pole;
    acc.poles_sum += r.poles_sum;
    acc.industrial += r.industrial;
    acc.proc_b += r.proc_b;
    acc.hot += r.hot;
    if (r.avg_days != null && r.count) {
      acc.daySum += r.avg_days * r.count;
      acc.dayN += r.count;
    }
  }
  return finishAcc('total', acc, total);
}
