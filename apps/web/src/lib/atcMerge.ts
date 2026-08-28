/**
 * Client-side ATC merge — mirrors server/src/atc_merge.js.
 * Used to collapse a multi-file drop before confirm/upload.
 */

export function atcRowKey(r: Record<string, unknown>) {
  const fmt = String(r.source_format || 'IA').toUpperCase() === 'IB' ? 'IB' : 'IA';
  return `${r.period_label}|${fmt}|${r.office_code}`;
}

export function pointSource(r: Record<string, unknown>): 'achievement' | 'header_month' {
  return String(r.point_source || '').toLowerCase() === 'achievement' ? 'achievement' : 'header_month';
}

export function periodSortKey(periodLabel: string) {
  const m = String(periodLabel || '').match(/^([A-Za-z]+)'(\d{2})$/);
  if (!m) return periodLabel || '';
  const months: Record<string, string> = {
    jan: '01',
    feb: '02',
    mar: '03',
    apr: '04',
    may: '05',
    jun: '06',
    jul: '07',
    aug: '08',
    sep: '09',
    oct: '10',
    nov: '11',
    dec: '12',
  };
  const mm = months[m[1].toLowerCase().slice(0, 3)];
  if (!mm) return periodLabel;
  return `20${m[2]}-${mm}`;
}

function fileQualityScore(filename: string) {
  const n = String(filename || '').toUpperCase();
  let s = 20;
  if (/_FINAL/.test(n) || /(^|[^A-Z])FINAL([^A-Z]|$)/.test(n)) s += 50;
  if (/_REVISED/.test(n) || /REVISED/.test(n) || /_COMP/.test(n)) s += 40;
  if (/_RAW/.test(n) || /(^|[^A-Z])RAW([^A-Z]|$)/.test(n)) s -= 20;
  if (/\(\d+\)/.test(n)) s -= 25;
  return s;
}

export function isDedicatedIbFilename(filename: string) {
  const n = String(filename || '').toUpperCase();
  if (/CCC/.test(n) && /WISE/.test(n)) return false;
  return /1\.1\s*B/.test(n) || /FORMAT[\s-]*I\s*B/.test(n) || /DIVISIONWISE/.test(n) || /DIVISION WISE/.test(n);
}

function betterOrigin(a: Record<string, unknown>, b: Record<string, unknown>) {
  const qa = fileQualityScore(String(a._filename || ''));
  const qb = fileQualityScore(String(b._filename || ''));
  if (qa !== qb) return qa > qb;
  return (Number(a._mtime) || 0) >= (Number(b._mtime) || 0);
}

const FILL_KEYS = [
  'atc_loss',
  'dist_loss',
  'coll_eff',
  'target_atc',
  'target_dist',
  'input_mu',
  'demand_mu',
  'collection_mu',
  'consumer_count',
  'atc_mar',
  'dist_mar',
  'atc_yoy',
  'dist_yoy',
  'coll_eff_mar',
  'coll_eff_yoy',
];

function fillNulls(target: Record<string, unknown>, src: Record<string, unknown>) {
  for (const k of FILL_KEYS) {
    if ((target[k] == null || target[k] === '') && src[k] != null && src[k] !== '') {
      target[k] = src[k];
    }
  }
}

export type AtcSkip = { filename: string; period: string; format: string; reason: 'embedded' | 'duplicate' };

function uniqueSkips(list: AtcSkip[]) {
  const seen = new Set<string>();
  const out: AtcSkip[] = [];
  for (const s of list) {
    const k = `${s.filename}|${s.period}|${s.format}|${s.reason}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

export function collapseIncoming(taggedRows: Record<string, unknown>[]) {
  const skipped: AtcSkip[] = [];
  const dedicatedIbPeriods = new Set<string>();
  for (const r of taggedRows) {
    if (String(r.source_format || 'IA').toUpperCase() !== 'IB') continue;
    if (pointSource(r) !== 'achievement') continue;
    if (r._embedded) continue;
    if (isDedicatedIbFilename(String(r._filename || ''))) {
      dedicatedIbPeriods.add(String(r.period_label || ''));
    }
  }

  const kept: Record<string, unknown>[] = [];
  for (const r of taggedRows) {
    const fmt = String(r.source_format || 'IA').toUpperCase() === 'IB' ? 'IB' : 'IA';
    if (fmt === 'IB' && r._embedded && dedicatedIbPeriods.has(String(r.period_label || ''))) {
      skipped.push({
        filename: String(r._filename || ''),
        period: String(r.period_label || ''),
        format: 'IB',
        reason: 'embedded',
      });
      continue;
    }
    kept.push(r);
  }

  const achByKey = new Map<string, Record<string, unknown>>();
  for (const r of kept) {
    if (pointSource(r) !== 'achievement') continue;
    const k = atcRowKey(r);
    const prev = achByKey.get(k);
    if (!prev || betterOrigin(r, prev)) achByKey.set(k, r);
  }
  for (const r of kept) {
    if (pointSource(r) !== 'achievement') continue;
    const winner = achByKey.get(atcRowKey(r));
    if (winner && String(winner._filename || '') !== String(r._filename || '')) {
      skipped.push({
        filename: String(r._filename || ''),
        period: String(r.period_label || ''),
        format: String(r.source_format || 'IA').toUpperCase() === 'IB' ? 'IB' : 'IA',
        reason: 'duplicate',
      });
    }
  }

  const out = [...achByKey.values()].map((r) => ({ ...r }));
  const headerByKey = new Map<string, Record<string, unknown>>();
  for (const r of kept) {
    if (pointSource(r) === 'achievement') continue;
    const k = atcRowKey(r);
    if (achByKey.has(k)) continue;
    const prev = headerByKey.get(k);
    if (!prev) headerByKey.set(k, { ...r });
    else fillNulls(headerByKey.get(k)!, r);
  }
  out.push(...headerByKey.values());
  return { rows: out, skipped: uniqueSkips(skipped) };
}

export function filterAgainstStored(incoming: Record<string, unknown>[], existing: Record<string, unknown>[]) {
  const stored = new Map((existing || []).map((r) => [atcRowKey(r), r]));
  const kept: Record<string, unknown>[] = [];
  let skippedHeader = 0;
  for (const r of incoming) {
    if (pointSource(r) === 'achievement') {
      kept.push(r);
      continue;
    }
    const prev = stored.get(atcRowKey(r));
    if (prev && pointSource(prev) === 'achievement') {
      skippedHeader += 1;
      continue;
    }
    kept.push(r);
  }
  return { rows: kept, skippedHeader };
}

export function stripOrigin(row: Record<string, unknown>) {
  const out = { ...row };
  delete out._filename;
  delete out._mtime;
  delete out._embedded;
  return out;
}

export type CoverageAction = 'replace' | 'new' | 'fill' | 'skip' | 'untouched';

export type CoverageCell = {
  period: string;
  format: 'IA' | 'IB';
  stored: 'full' | 'sparse' | 'none';
  incoming: 'full' | 'sparse' | 'none';
  action: CoverageAction;
};

function richness(rows: Record<string, unknown>[]): 'full' | 'sparse' | 'none' {
  if (!rows.length) return 'none';
  return rows.some((r) => pointSource(r) === 'achievement') ? 'full' : 'sparse';
}

export function buildCoverage(
  incoming: Record<string, unknown>[],
  existing: Record<string, unknown>[],
  skippedHeaderCount: number
): CoverageCell[] {
  void skippedHeaderCount;
  const group = (list: Record<string, unknown>[]) => {
    const m = new Map<string, Record<string, unknown>[]>();
    for (const r of list) {
      const fmt = String(r.source_format || 'IA').toUpperCase() === 'IB' ? 'IB' : 'IA';
      const p = String(r.period_label || '');
      if (!p) continue;
      const k = `${p}|${fmt}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return m;
  };
  const inc = group(incoming);
  const sto = group(existing);
  const keys = new Set([...inc.keys(), ...sto.keys()]);
  const cells: CoverageCell[] = [];
  for (const k of keys) {
    const [period, format] = k.split('|') as [string, 'IA' | 'IB'];
    const stored = richness(sto.get(k) || []);
    const incomingR = richness(inc.get(k) || []);
    let action: CoverageAction = 'untouched';
    if (incomingR === 'full' && stored === 'none') action = 'new';
    else if (incomingR === 'full') action = 'replace';
    else if (incomingR === 'sparse' && stored === 'full') action = 'skip';
    else if (incomingR === 'sparse') action = 'fill';
    if (incomingR === 'none' && stored === 'none') continue;
    if (incomingR === 'none') {
      // stored-only months are not shown on the incoming calendar
      continue;
    }
    cells.push({ period, format, stored, incoming: incomingR, action });
  }
  cells.sort((a, b) => {
    const ps = periodSortKey(a.period).localeCompare(periodSortKey(b.period));
    if (ps) return ps;
    return a.format.localeCompare(b.format);
  });
  return cells;
}

export function coverageCaption(cells: CoverageCell[], skippedDupes: number, fileErrors: number) {
  const fullWrite = cells.filter((c) => c.action === 'new' || c.action === 'replace');
  const fills = cells.filter((c) => c.action === 'fill');
  const skips = cells.filter((c) => c.action === 'skip');
  const iaFull = fullWrite.filter((c) => c.format === 'IA').length;
  const ibFull = fullWrite.filter((c) => c.format === 'IB').length;
  const parts = [
    `${iaFull} IA + ${ibFull} IB full months will write`,
    fills.length ? `${fills.length} comparison fills` : null,
    skips.length ? `${skips.length} comparison months will not overwrite stored full data` : null,
    skippedDupes ? `${skippedDupes} duplicate files skipped` : null,
    fileErrors ? `${fileErrors} file${fileErrors === 1 ? '' : 's'} failed` : null,
  ].filter(Boolean);
  return parts.join('. ') + '.';
}

export function summarizeMonths(rows: Record<string, unknown>[], format: 'IA' | 'IB', kind: 'achievement' | 'header_month') {
  return [
    ...new Set(
      rows
        .filter(
          (r) =>
            (String(r.source_format || 'IA').toUpperCase() === 'IB' ? 'IB' : 'IA') === format &&
            pointSource(r) === kind
        )
        .map((r) => String(r.period_label || ''))
        .filter(Boolean)
    ),
  ].sort((a, b) => periodSortKey(a).localeCompare(periodSortKey(b)));
}
