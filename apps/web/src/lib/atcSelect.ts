/** Pick the real monthly AT&C circulars from a mixed dump of workbooks. */

export type AtcSkip = { filename: string; reason: string };

export type AtcKeepSlot = {
  period: string;
  format: 'IA' | 'IB';
  filename: string;
  offices: number;
  divCount: number;
  muCount: number;
  warning: string;
};

export type ParsedAtcDumpFile = {
  filename: string;
  lastModified?: number;
  period_label?: string;
  rows?: Record<string, unknown>[];
  filtered_out?: number;
  error?: string;
  skipped?: string;
};

export type AtcSelection = {
  keep: AtcKeepSlot[];
  skip: AtcSkip[];
  achievementRows: Record<string, unknown>[];
  headerRows: Record<string, unknown>[];
  headerMonths: string[];
  periods: string[];
  counts: { IA: number; IB: number };
};

function atcFormat(row: Record<string, unknown>) {
  return String(row?.source_format || 'IA').toUpperCase() === 'IB' ? 'IB' : 'IA';
}

function isHeaderPoint(row: Record<string, unknown>) {
  return String(row?.point_source || '') === 'header_month';
}

export function formatAtcBasis(fmt: string) {
  return String(fmt || 'IA').toUpperCase() === 'IB' ? 'Incl. Bulk (Division)' : 'Excl. Bulk (CCC)';
}

export function periodFromName(name: string) {
  const m = String(name || '').match(
    /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s'’._-]*(\d{2,4})/i
  );
  if (!m) return '';
  const mon = m[1].charAt(0).toUpperCase() + m[1].slice(1, 3).toLowerCase();
  let y = m[2];
  if (y.length === 4) y = y.slice(2);
  return `${mon}'${y}`;
}

function periodSortKey(periodLabel: string) {
  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  const m = String(periodLabel || '').match(/^([A-Za-z]+)'(\d{2})$/);
  if (!m) return periodLabel || '';
  const mm = months[m[1].toLowerCase().slice(0, 3)];
  if (!mm) return periodLabel;
  return `20${m[2]}-${mm}`;
}

function slotKey(period: string, format: string) {
  return `${period}|${format}`;
}

type SliceScore = {
  n: number;
  offices: number;
  divCount: number;
  muCount: number;
  nameFinal: boolean;
  nameHasPeriod: boolean;
  lastModified: number;
};

function scoreSlice(
  rows: Record<string, unknown>[],
  filename: string,
  lastModified: number,
  period: string,
  format: string
): SliceScore {
  const slice = (rows || []).filter(
    (r) => String(r.period_label || '') === period && atcFormat(r) === format && !isHeaderPoint(r)
  );
  const offices = new Set(slice.map((r) => String(r.office_code || '')).filter(Boolean));
  const divCount = slice.filter((r) => String(r.office_type || '').toLowerCase() === 'division').length;
  const muCount = slice.filter((r) => r.input_mu != null && r.input_mu !== '').length;
  const name = String(filename || '').toLowerCase();
  const fromName = periodFromName(filename);
  return {
    n: slice.length,
    offices: offices.size,
    divCount,
    muCount,
    nameFinal: /final|cccw|format[\s-]*i/.test(name),
    nameHasPeriod: fromName === period,
    lastModified: Number(lastModified) || 0,
  };
}

function betterScore(a: SliceScore, b: SliceScore, format: string) {
  if (a.muCount !== b.muCount) return a.muCount - b.muCount;
  if (format === 'IA' && a.divCount !== b.divCount) return a.divCount - b.divCount;
  if (a.offices !== b.offices) return a.offices - b.offices;
  if (a.n !== b.n) return a.n - b.n;
  if (a.nameFinal !== b.nameFinal) return a.nameFinal ? 1 : -1;
  if (a.nameHasPeriod !== b.nameHasPeriod) return a.nameHasPeriod ? 1 : -1;
  return a.lastModified - b.lastModified;
}

function collapseRows(rows: Record<string, unknown>[]) {
  const map = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const fmt = atcFormat(r);
    const key = `${r.period_label}|${fmt}|${r.office_code}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, r);
      continue;
    }
    const prevHeader = isHeaderPoint(prev);
    const nextHeader = isHeaderPoint(r);
    if (nextHeader && !prevHeader) continue;
    map.set(key, r);
  }
  return [...map.values()];
}

type Candidate = {
  filename: string;
  lastModified: number;
  period: string;
  format: string;
  rows: Record<string, unknown>[];
  score: SliceScore;
};

export function selectAtcCirculars(files: ParsedAtcDumpFile[]): AtcSelection {
  const skip: AtcSkip[] = [];
  const candidates = new Map<string, Candidate[]>();
  const headerBySlot = new Map<string, Array<{ filename: string; row: Record<string, unknown> }>>();

  for (const file of files || []) {
    const filename = String(file?.filename || 'file');
    if (file?.skipped) {
      skip.push({ filename, reason: file.skipped });
      continue;
    }
    if (file?.error) {
      skip.push({ filename, reason: file.error });
      continue;
    }
    const rows = Array.isArray(file.rows) ? file.rows : [];
    if (!rows.length) {
      skip.push({
        filename,
        reason:
          (file.filtered_out || 0) > 0
            ? `No Darjeeling Region offices (${file.filtered_out} rows outside zone 34 / 341*)`
            : 'Not an AT&C circular (no CCC / Division loss sheet found)',
      });
      continue;
    }

    const achievement = rows.filter((r) => !isHeaderPoint(r));
    const headers = rows.filter(isHeaderPoint);
    const groups = new Map<string, Record<string, unknown>[]>();
    for (const r of achievement) {
      const period = String(r.period_label || '').trim();
      if (!period) continue;
      const format = atcFormat(r);
      const key = slotKey(period, format);
      const list = groups.get(key) || [];
      list.push(r);
      groups.set(key, list);
    }

    if (!groups.size) {
      skip.push({
        filename,
        reason: 'Only comparison-month columns — waiting for a full circular for those months',
      });
    }

    for (const [key, slice] of groups) {
      const [period, format] = key.split('|');
      const lastModified = Number(file.lastModified) || 0;
      const rec: Candidate = {
        filename,
        lastModified,
        period,
        format,
        rows: slice,
        score: scoreSlice(slice, filename, lastModified, period, format),
      };
      const list = candidates.get(key) || [];
      list.push(rec);
      candidates.set(key, list);
    }

    for (const r of headers) {
      const period = String(r.period_label || '').trim();
      if (!period) continue;
      const key = slotKey(period, atcFormat(r));
      const list = headerBySlot.get(key) || [];
      list.push({ filename, row: r });
      headerBySlot.set(key, list);
    }
  }

  const keep: AtcKeepSlot[] = [];
  const achievementRows: Record<string, unknown>[] = [];
  const usedFiles = new Set<string>();

  const keys = [...candidates.keys()].sort((a, b) => a.localeCompare(b));
  for (const key of keys) {
    const list = candidates.get(key) || [];
    const format = key.split('|')[1];
    list.sort((a, b) => betterScore(b.score, a.score, format));
    const winner = list[0];
    usedFiles.add(winner.filename);
    keep.push({
      period: winner.period,
      format: winner.format === 'IB' ? 'IB' : 'IA',
      filename: winner.filename,
      offices: winner.score.offices,
      divCount: winner.score.divCount,
      muCount: winner.score.muCount,
      warning:
        winner.format === 'IA' && winner.score.divCount === 0
          ? 'No Division TOTAL rows in this circular'
          : '',
    });
    achievementRows.push(...winner.rows);
    for (const loser of list.slice(1)) {
      skip.push({
        filename: loser.filename,
        reason: `Duplicate ${loser.period} ${formatAtcBasis(loser.format)} — kept ${winner.filename}`,
      });
    }
  }

  keep.sort((a, b) => {
    const ps = periodSortKey(a.period).localeCompare(periodSortKey(b.period));
    if (ps) return ps;
    return a.format.localeCompare(b.format);
  });

  const headerRows: Record<string, unknown>[] = [];
  const headerMonths = new Set<string>();
  for (const [key, items] of headerBySlot) {
    if (candidates.has(key)) continue;
    for (const item of items) {
      headerRows.push(item.row);
      headerMonths.add(String(item.row.period_label || ''));
    }
  }

  for (const file of files || []) {
    const filename = String(file?.filename || 'file');
    if (file?.skipped || file?.error) continue;
    const rows = Array.isArray(file.rows) ? file.rows : [];
    if (!rows.length) continue;
    if (usedFiles.has(filename)) continue;
    if (skip.some((s) => s.filename === filename)) continue;
    skip.push({
      filename,
      reason: 'No unique monthly circular to keep (duplicates or comparison-only columns)',
    });
  }

  const periods = [...new Set(keep.map((k) => k.period))].sort((a, b) =>
    periodSortKey(a).localeCompare(periodSortKey(b))
  );

  const skipByFile = new Map<string, string>();
  for (const s of skip) {
    const prev = skipByFile.get(s.filename);
    if (!prev) skipByFile.set(s.filename, s.reason);
    else if (!prev.includes(s.reason)) skipByFile.set(s.filename, `${prev}; ${s.reason}`);
  }

  const uniqueAchievement = collapseRows(achievementRows);
  const uniqueHeaders = collapseRows(headerRows);

  return {
    keep,
    skip: [...skipByFile.entries()].map(([filename, reason]) => ({ filename, reason })),
    achievementRows: uniqueAchievement,
    headerRows: uniqueHeaders,
    headerMonths: [...headerMonths].filter(Boolean).sort(),
    periods,
    counts: {
      IA: uniqueAchievement.filter((r) => atcFormat(r) !== 'IB').length,
      IB: uniqueAchievement.filter((r) => atcFormat(r) === 'IB').length,
    },
  };
}
