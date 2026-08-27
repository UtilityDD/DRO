/**
 * Pick the real monthly AT&C circulars from a mixed dump of workbooks.
 * One winner per achievement month × basis (Excl. Bulk / Incl. Bulk).
 * Comparison (header) columns never beat a dedicated circular for that month.
 */

function atcFormat(row) {
  return String(row?.source_format || 'IA').toUpperCase() === 'IB' ? 'IB' : 'IA';
}

function isHeaderPoint(row) {
  return String(row?.point_source || '') === 'header_month';
}

function periodFromName(name) {
  const m = String(name || '').match(
    /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s'’._-]*(\d{2,4})/i
  );
  if (!m) return '';
  const mon = m[1].charAt(0).toUpperCase() + m[1].slice(1, 3).toLowerCase();
  let y = m[2];
  if (y.length === 4) y = y.slice(2);
  return `${mon}'${y}`;
}

function periodSortKey(periodLabel) {
  const months = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  const m = String(periodLabel || '').match(/^([A-Za-z]+)'(\d{2})$/);
  if (!m) return periodLabel || '';
  const mm = months[m[1].toLowerCase().slice(0, 3)];
  if (!mm) return periodLabel;
  return `20${m[2]}-${mm}`;
}

function slotKey(period, format) {
  return `${period}|${format}`;
}

function scoreSlice(rows, filename, lastModified, period, format) {
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

function betterScore(a, b, format) {
  if (a.muCount !== b.muCount) return a.muCount - b.muCount;
  if (format === 'IA' && a.divCount !== b.divCount) return a.divCount - b.divCount;
  if (a.offices !== b.offices) return a.offices - b.offices;
  if (a.n !== b.n) return a.n - b.n;
  if (a.nameFinal !== b.nameFinal) return a.nameFinal ? 1 : -1;
  if (a.nameHasPeriod !== b.nameHasPeriod) return a.nameHasPeriod ? 1 : -1;
  return a.lastModified - b.lastModified;
}

function formatBasis(fmt) {
  return fmt === 'IB' ? 'Incl. Bulk (Division)' : 'Excl. Bulk (CCC)';
}

/**
 * @param {Array<{
 *   filename: string,
 *   lastModified?: number,
 *   period_label?: string,
 *   rows?: object[],
 *   filtered_out?: number,
 *   error?: string,
 *   skipped?: string,
 * }>} files
 */
function selectAtcCirculars(files) {
  const skip = [];
  /** @type {Map<string, Array<{ filename: string, lastModified: number, period: string, format: string, rows: object[], score: object }>>} */
  const candidates = new Map();
  const headerBySlot = new Map();

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
    const groups = new Map();
    for (const r of achievement) {
      const period = String(r.period_label || '').trim();
      if (!period) continue;
      const format = atcFormat(r);
      const key = slotKey(period, format);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
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
      const rec = {
        filename,
        lastModified,
        period,
        format,
        rows: slice,
        score: scoreSlice(slice, filename, lastModified, period, format),
      };
      if (!candidates.has(key)) candidates.set(key, []);
      candidates.get(key).push(rec);
    }

    for (const r of headers) {
      const period = String(r.period_label || '').trim();
      if (!period) continue;
      const key = slotKey(period, atcFormat(r));
      if (!headerBySlot.has(key)) headerBySlot.set(key, []);
      headerBySlot.get(key).push({ filename, row: r });
    }
  }

  const keep = [];
  const achievementRows = [];
  const usedFiles = new Set();

  const keys = [...candidates.keys()].sort((a, b) => a.localeCompare(b));
  for (const key of keys) {
    const list = candidates.get(key) || [];
    const format = key.split('|')[1];
    list.sort((a, b) => betterScore(b.score, a.score, format));
    const winner = list[0];
    usedFiles.add(winner.filename);
    keep.push({
      period: winner.period,
      format: winner.format,
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
        reason: `Duplicate ${loser.period} ${formatBasis(loser.format)} — kept ${winner.filename}`,
      });
    }
  }

  keep.sort((a, b) => {
    const ps = periodSortKey(a.period).localeCompare(periodSortKey(b.period));
    if (ps) return ps;
    return String(a.format).localeCompare(String(b.format));
  });

  const headerRows = [];
  const headerMonths = new Set();
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

  const periods = [...new Set(keep.map((k) => k.period))];
  periods.sort((a, b) => periodSortKey(a).localeCompare(periodSortKey(b)));

  const skipByFile = new Map();
  for (const s of skip) {
    const prev = skipByFile.get(s.filename);
    if (!prev) skipByFile.set(s.filename, s.reason);
    else if (!prev.includes(s.reason)) skipByFile.set(s.filename, `${prev}; ${s.reason}`);
  }

  return {
    keep,
    skip: [...skipByFile.entries()].map(([filename, reason]) => ({ filename, reason })),
    achievementRows,
    headerRows,
    headerMonths: [...headerMonths].filter(Boolean).sort(),
    periods,
    counts: {
      IA: achievementRows.filter((r) => atcFormat(r) !== 'IB').length,
      IB: achievementRows.filter((r) => atcFormat(r) === 'IB').length,
    },
  };
}

module.exports = {
  selectAtcCirculars,
  scoreSlice,
  betterScore,
  periodFromName,
  atcFormat,
  formatBasis,
};
