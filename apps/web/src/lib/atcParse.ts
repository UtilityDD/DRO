/**
 * Client-side Format-IA / IB parser (mirrors server/src/atc_parse.js).
 * Kept in sync for Upload Center workbook ingestion.
 */

const MONTHS: Record<string, string> = {
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

function cellStr(v: unknown) {
  if (v == null) return '';
  return String(v).replace(/\s+/g, ' ').trim();
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

export function normalizePeriod(text: unknown): string {
  const s = cellStr(text);
  const m = s.match(
    /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s'’]*(\d{2,4})/i
  );
  if (!m) return '';
  const mon = m[1].charAt(0).toUpperCase() + m[1].slice(1, 3).toLowerCase();
  let y = m[2];
  if (y.length === 4) y = y.slice(2);
  return `${mon}'${y}`;
}

export function periodSortKey(periodLabel: string): string {
  const m = String(periodLabel || '').match(/^([A-Za-z]+)'(\d{2})$/);
  if (!m) return periodLabel || '';
  const mm = MONTHS[m[1].toLowerCase().slice(0, 3)];
  if (!mm) return periodLabel;
  return `20${m[2]}-${mm}`;
}

function extractTargetFy(text: unknown) {
  const m = cellStr(text).match(/20\d{2}\s*[-–]\s*\d{2,4}/);
  if (!m) return '';
  const parts = m[0].replace(/\s/g, '').split(/[-–]/);
  const a = parts[0];
  let b = parts[1] || '';
  if (b.length === 2) b = a.slice(0, 2) + b;
  return `${a}-${b.slice(2)}`;
}

function looksLikeHeaderIA(row: unknown[]) {
  const cells = (row || []).map((c) => cellStr(c).toUpperCase());
  const joined = cells.join('|');
  const hasDiv = cells.some((c) => c === 'DIVISION' || c.startsWith('DIVISION'));
  const hasCccCol =
    cells.some((c) => c.includes('CCC CODE') || c === 'CCC') ||
    cells.some((c) => c === 'CUSTOMER CARE CENTRE' || c.startsWith('CUSTOMER CARE CENTRE'));
  const hasSl = cells.some((c) => c.includes('SL') && c.includes('NO'));
  return hasDiv && hasCccCol && (hasSl || joined.includes('CCC CODE'));
}

function looksLikeHeaderIB(row: unknown[]) {
  const joined = (row || []).map(cellStr).join('|').toUpperCase();
  return joined.includes('DIVISION') && joined.includes('TARGET');
}

function isNumericOfficeCode(code: string) {
  // Zone=34, Region=341, Division=3412, CCC=3412502
  return /^\d{2,}$/.test(String(code || '').trim());
}

function isHeaderLabelName(name: string) {
  const n = cellStr(name).toUpperCase();
  return (
    !n ||
    n === 'CUSTOMER CARE CENTRE' ||
    n === 'CUSTOMER CARE CENTER' ||
    n === 'CCC' ||
    n === 'DIVISION' ||
    n === 'CCC CODE' ||
    n.startsWith('SL.')
  );
}

function findPeriodInSheet(rows: unknown[][]) {
  for (const row of rows.slice(0, 8)) {
    for (const c of row || []) {
      const t = cellStr(c);
      if (/UPTO/i.test(t) || /AT&C/i.test(t)) {
        const p = normalizePeriod(t);
        if (p) return p;
      }
    }
  }
  return '';
}

function findTargetFyInSheet(rows: unknown[][]) {
  for (const row of rows.slice(0, 8)) {
    for (const c of row || []) {
      const fy = extractTargetFy(c);
      if (fy) return fy;
    }
  }
  return '2026-27';
}

function inferOfficeType(code: string, name: string, cccLabel: string) {
  const c = String(code || '');
  const n = cellStr(name || cccLabel).toUpperCase();
  if (n.includes('ALL ZONE') || n === 'WBSEDCL') return 'utility';
  if (n.includes('ZONE') || c === '34') return 'zone';
  if (n.includes('REGION') || c === '341') return 'region';
  if (c.length === 4) return 'division';
  if (c.length >= 7) return 'ccc';
  if (/TOTAL/i.test(cccLabel || '')) return 'division';
  return 'ccc';
}

function cleanName(name: unknown) {
  return cellStr(name).replace(/\s+/g, ' ');
}

export type AtcRow = Record<string, unknown>;

function expandMonthPoints(
  base: AtcRow,
  points: { period: string; atc: number | null; dist: number | null; ce: number | null; full?: boolean }[]
) {
  const out: AtcRow[] = [];
  const seen = new Set<string>();
  for (const p of points) {
    const period = p.period;
    if (!period || seen.has(period)) continue;
    if (p.atc == null && p.dist == null && p.ce == null && !p.full) continue;
    seen.add(period);
    out.push({
      ...base,
      period_label: period,
      period_sort: periodSortKey(period),
      atc_loss: p.atc,
      dist_loss: p.dist,
      coll_eff: p.ce,
      input_mu: p.full ? base.input_mu : null,
      demand_mu: p.full ? base.demand_mu : null,
      collection_mu: p.full ? base.collection_mu : null,
      consumer_count: p.full ? base.consumer_count : null,
      point_source: p.full ? 'achievement' : 'header_month',
      atc_mar: p.full ? base.atc_mar : null,
      dist_mar: p.full ? base.dist_mar : null,
      atc_yoy: p.full ? base.atc_yoy : null,
      dist_yoy: p.full ? base.dist_yoy : null,
      coll_eff_mar: p.full ? base.coll_eff_mar : null,
      coll_eff_yoy: p.full ? base.coll_eff_yoy : null,
    });
  }
  return out;
}

function parseFormatIA(aoa: unknown[][], opts: { period_label?: string; target_fy?: string } = {}) {
  const period_label = opts.period_label || findPeriodInSheet(aoa) || '';
  const target_fy = opts.target_fy || findTargetFyInSheet(aoa);
  let headerIdx = -1;
  for (let i = 0; i < Math.min(aoa.length, 12); i++) {
    if (looksLikeHeaderIA(aoa[i] as unknown[])) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return { period_label, target_fy, rows: [] as AtcRow[], source_format: 'IA' };

  const header = (aoa[headerIdx] || []) as unknown[];
  const periodMar = normalizePeriod(header[7]) || "Mar'26";
  const periodYoy = normalizePeriod(header[9]) || '';
  const periodCur = normalizePeriod(header[14]) || period_label;

  const out: AtcRow[] = [];
  let currentDiv = '';
  let currentDivCode = '';

  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const r = (aoa[i] || []) as unknown[];
    if (looksLikeHeaderIA(r)) continue;
    const divCell = cellStr(r[1]);
    const cccCell = cellStr(r[2]);
    const code = r[3] != null && r[3] !== '' ? String(r[3]).replace(/\.0$/, '') : '';
    if (!isNumericOfficeCode(code)) continue;
    if (cccCell && isHeaderLabelName(cccCell) && !/^TOTAL$/i.test(cccCell)) continue;

    if (divCell && !isHeaderLabelName(divCell)) {
      currentDiv = cleanName(divCell);
      if (code.length === 4) currentDivCode = code;
    }

    const isTotal = /^TOTAL$/i.test(cccCell);
    const office_type = isTotal ? 'division' : inferOfficeType(code, divCell || cccCell, cccCell);
    let office_name = isTotal
      ? currentDiv || cleanName(divCell) || code
      : cleanName(cccCell) || cleanName(divCell) || code;
    if (office_type === 'region') office_name = 'Darjeeling Region';
    if (office_type === 'zone') office_name = cleanName(divCell || cccCell) || 'Siliguri Zone';
    if (!cleanName(cccCell) && !cleanName(divCell) && office_type === 'region') {
      office_name = 'Darjeeling Region';
    }

    const division_code =
      office_type === 'ccc' ? code.slice(0, 4) : office_type === 'division' ? code : '';
    if (office_type === 'division') currentDivCode = code;

    const base: AtcRow = {
      period_label: periodCur || period_label,
      period_sort: periodSortKey(periodCur || period_label),
      target_fy,
      source_format: 'IA',
      basis_label: 'Format-IA (CCC path)',
      office_type,
      office_code: code,
      office_name,
      division_code: division_code || currentDivCode || '',
      division_name: currentDiv || '',
      region_code: '341',
      ccc_code: office_type === 'ccc' ? code : '',
      consumer_count: num(r[4]),
      target_atc: num(r[5]),
      target_dist: num(r[6]),
      atc_mar: num(r[7]),
      dist_mar: num(r[8]),
      atc_yoy: num(r[9]),
      dist_yoy: num(r[10]),
      input_mu: num(r[11]),
      demand_mu: num(r[12]),
      collection_mu: num(r[13]),
      atc_loss: num(r[14]),
      dist_loss: num(r[15]),
      coll_eff: num(r[16]),
      coll_eff_mar: null,
      coll_eff_yoy: null,
    };

    out.push(
      ...expandMonthPoints(base, [
        { period: periodYoy, atc: base.atc_yoy as number | null, dist: base.dist_yoy as number | null, ce: null },
        { period: periodMar, atc: base.atc_mar as number | null, dist: base.dist_mar as number | null, ce: null },
        {
          period: periodCur || period_label,
          atc: base.atc_loss as number | null,
          dist: base.dist_loss as number | null,
          ce: base.coll_eff as number | null,
          full: true,
        },
      ])
    );
  }

  return { period_label: periodCur || period_label, target_fy, rows: out, source_format: 'IA' };
}

function parseFormatIB(aoa: unknown[][], opts: { period_label?: string; target_fy?: string } = {}) {
  const period_label = opts.period_label || findPeriodInSheet(aoa) || '';
  const target_fy = opts.target_fy || findTargetFyInSheet(aoa);
  let headerIdx = -1;
  for (let i = 0; i < Math.min(aoa.length, 12); i++) {
    if (looksLikeHeaderIB(aoa[i] as unknown[])) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return { period_label, target_fy, rows: [] as AtcRow[], source_format: 'IB' };

  let start = headerIdx + 1;
  let subRow = (aoa[start] || []) as unknown[];
  const sub = subRow.map(cellStr).join('|').toUpperCase();
  if (sub.includes('AT&C') || sub.includes('DISTRIBUTION') || sub.includes('UPTO')) start += 1;
  else subRow = [];

  const periodMar = normalizePeriod(subRow[8]) || "Mar'26";
  const periodYoy = normalizePeriod(subRow[9]) || '';
  const periodCur = normalizePeriod(subRow[10]) || period_label;

  const out: AtcRow[] = [];
  for (let i = start; i < aoa.length; i++) {
    const r = (aoa[i] || []) as unknown[];
    if (looksLikeHeaderIB(r)) continue;
    let name = cleanName(r[1]);
    if (!name && r[0] != null && !/^\d+$/.test(String(r[0]).trim())) {
      name = cleanName(r[0]);
    }
    let code = r[2] != null && r[2] !== '' ? String(r[2]).replace(/\.0$/, '') : '';
    if (!name && !code) continue;
    if (name && isHeaderLabelName(name)) continue;
    if (/ALL ZONE/i.test(name) && !code) code = 'ALL';
    if (!isNumericOfficeCode(code)) continue;

    const office_type = inferOfficeType(code, name, '');
    if (office_type === 'utility') continue;

    const office_name =
      office_type === 'region'
        ? 'Darjeeling Region'
        : office_type === 'zone'
          ? 'Siliguri Zone'
          : name || code;

    const base: AtcRow = {
      period_label: periodCur || period_label,
      period_sort: periodSortKey(periodCur || period_label),
      target_fy,
      source_format: 'IB',
      basis_label: 'Format-IB (Div/Reg excl. bulk path)',
      office_type,
      office_code: code,
      office_name,
      division_code: office_type === 'division' ? code : '',
      division_name: office_type === 'division' ? office_name : '',
      region_code: '341',
      ccc_code: '',
      consumer_count: null,
      target_atc: num(r[3]),
      target_dist: num(r[4]),
      input_mu: num(r[5]),
      demand_mu: num(r[6]),
      collection_mu: num(r[7]),
      atc_mar: num(r[8]),
      atc_yoy: num(r[9]),
      atc_loss: num(r[10]),
      dist_mar: num(r[11]),
      dist_yoy: num(r[12]),
      dist_loss: num(r[13]),
      coll_eff_mar: num(r[14]),
      coll_eff_yoy: num(r[15]),
      coll_eff: num(r[16]),
    };

    out.push(
      ...expandMonthPoints(base, [
        {
          period: periodYoy,
          atc: base.atc_yoy as number | null,
          dist: base.dist_yoy as number | null,
          ce: base.coll_eff_yoy as number | null,
        },
        {
          period: periodMar,
          atc: base.atc_mar as number | null,
          dist: base.dist_mar as number | null,
          ce: base.coll_eff_mar as number | null,
        },
        {
          period: periodCur || period_label,
          atc: base.atc_loss as number | null,
          dist: base.dist_loss as number | null,
          ce: base.coll_eff as number | null,
          full: true,
        },
      ])
    );
  }

  return { period_label: periodCur || period_label, target_fy, rows: out, source_format: 'IB' };
}

function detectSheetKind(name: string, aoa: unknown[][]) {
  const n = String(name || '').toUpperCase();
  if (/DIVISION|FORMAT[\s-]*I\s*B|FORMAT[\s-]*IB/i.test(n)) return 'IB';
  const title = cellStr(((aoa[1] || [])[0] || (aoa[2] || [])[0] || '') as unknown).toUpperCase();
  if (title.includes('FORMAT- I B') || title.includes('FORMAT-IB') || title.includes('DIVISIONWISE')) {
    return 'IB';
  }
  for (let i = 0; i < Math.min(8, aoa.length); i++) {
    if (looksLikeHeaderIA(aoa[i] as unknown[])) return 'IA';
    if (looksLikeHeaderIB(aoa[i] as unknown[]) && !looksLikeHeaderIA(aoa[i] as unknown[])) return 'IB';
  }
  return 'IA';
}

export function isAtcWorkbook(sheetNames: string[], firstSheetAoa?: unknown[][]) {
  const joined = sheetNames.join('|').toUpperCase();
  if (/ATC|AT&C|FORMAT|CCCWISE|DIVISION WISE/i.test(joined)) return true;
  if (firstSheetAoa && detectSheetKind(sheetNames[0] || '', firstSheetAoa) === 'IA') {
    return looksLikeHeaderIA(firstSheetAoa.find((r) => looksLikeHeaderIA(r as unknown[])) as unknown[] || []);
  }
  return false;
}

export function parseAtcWorkbookFromAoa(
  sheets: { name: string; aoa: unknown[][] }[],
  opts: { period_label?: string; target_fy?: string } = {}
) {
  const all: AtcRow[] = [];
  let period_label = opts.period_label || '';
  let target_fy = opts.target_fy || '';

  for (const { name, aoa } of sheets) {
    if (!aoa?.length) continue;
    const kind = detectSheetKind(name, aoa);
    const parsed = kind === 'IB' ? parseFormatIB(aoa, opts) : parseFormatIA(aoa, opts);
    if (!period_label && parsed.period_label) period_label = parsed.period_label;
    if (!target_fy && parsed.target_fy) target_fy = parsed.target_fy;
    if (!parsed.period_label) {
      const fromName = normalizePeriod(name);
      const pl = period_label || fromName;
      if (pl) {
        parsed.rows.forEach((r) => {
          if (!r.period_label) {
            r.period_label = pl;
            r.period_sort = periodSortKey(pl);
          }
        });
        if (!period_label) period_label = pl;
      }
    }
    all.push(...parsed.rows);
  }

  if (opts.period_label) {
    all.forEach((r) => {
      if (!r.period_label) {
        r.period_label = opts.period_label;
        r.period_sort = periodSortKey(opts.period_label!);
      }
    });
    if (!period_label) period_label = opts.period_label;
  }

  return {
    period_label,
    target_fy,
    rows: all,
    counts: {
      IA: all.filter((r) => r.source_format === 'IA').length,
      IB: all.filter((r) => r.source_format === 'IB').length,
    },
  };
}
