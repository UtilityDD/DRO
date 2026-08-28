/**
 * Client-side Format-IA / IB parser (mirrors server/src/atc_parse.js).
 * Upload Center uses the server parser exclusively — do not use this for ingest.
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

/** Excel % cells arrive as fractions (0.0628); whole numbers are already percent points. */
function asPercent(v: unknown): number | null {
  const n = num(v);
  if (n == null) return null;
  if (Math.abs(n) <= 1) return n * 100;
  return n;
}

/** Prior FY closing March for a given achievement month (WBSEDCL FY = Apr–Mar). */
function priorFyMarch(period: string): string {
  const m = String(period || '').match(/^([A-Za-z]+)'(\d{2})$/);
  if (!m) return '';
  const mon = m[1].slice(0, 3).toLowerCase();
  let y = Number(m[2]);
  if (['jan', 'feb', 'mar'].includes(mon)) y -= 1;
  return `Mar'${String(y).padStart(2, '0')}`;
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

/** Real office codes are 2/3/4/7 digits — not consumer counts. */
function isLikelyOfficeCode(code: string) {
  const c = String(code || '')
    .trim()
    .replace(/\.0$/, '');
  if (!/^\d+$/.test(c)) return false;
  const len = c.length;
  return len === 2 || len === 3 || len === 4 || len === 7;
}

/** DRO app scope: zone 34, region 341, divisions 3412–3415, their CCCs. */
export function isDroScopedOffice(code: unknown) {
  const c = String(code || '').trim();
  if (c === '34' || c === '341') return true;
  if (/^341[2-5]$/.test(c)) return true;
  if (/^341[2-5]\d{3}$/.test(c)) return true;
  return false;
}

function normalizeOfficeKey(name: unknown) {
  return cellStr(name)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const DRO_DIV_CODES: Record<string, string> = {
  'SILIGURI TOWN': '3412',
  'SILIGURI SUBARBAN': '3415',
  'SILIGURI SUB URBAN': '3415',
  'SILIGURI SUBURBAN': '3415',
  KURSEONG: '3413',
  DARJEELING: '3414',
};

const DRO_CCC_CODES: Record<string, string> = {
  HAKIMPARA: '3412502',
  'POWER HOUSE': '3412503',
  'PRADHAN NAGAR': '3412504',
  SUBHASPALLI: '3412501',
  SUBHASPALLY: '3412501',
  'NJP GATE BAZAR': '3412401',
  MILANPALLI: '3412400',
  MILANPALLY: '3412400',
  'SILIGURI TOWN': '3412505',
  BAGDOGRA: '3415200',
  MATIGARA: '3415400',
  SHIBMANDIR: '3415600',
  SHIVMANDIR: '3415600',
  NAXALBARI: '3415101',
  PHANSIDEWA: '3415102',
  KHARIBARI: '3415103',
  BIDHANNAGAR: '3415201',
  SONADA: '3413101',
  MIRIK: '3413201',
  KURSEONG: '3413202',
  BIJONBARI: '3414201',
  BIJANBARI: '3414201',
  LODHAMA: '3414204',
  TAKDA: '3414102',
  TAKDAH: '3414102',
  SUKHIAPOKRI: '3414101',
  SUKHIAPOKHRI: '3414101',
  DARJEELING: '3414300',
};

const DRO_ROLLUP_CODES: Record<string, string> = {
  'SILIGURI ZONE': '34',
  'DARJEELING REGION': '341',
};

function codeFromMap(map: Record<string, string>, ...names: unknown[]) {
  for (const name of names) {
    const key = normalizeOfficeKey(name);
    if (!key || key === 'TOTAL') continue;
    if (map[key]) return map[key];
  }
  return '';
}

function findCccCodeColumn(header: unknown[]) {
  const cells = header || [];
  for (let i = 0; i < cells.length; i++) {
    const t = cellStr(cells[i]).toUpperCase();
    if (/CCC\s*CODE/.test(t) || t === 'CODE' || t === 'OFFICE CODE') return i;
  }
  return -1;
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
  let fromTitle = '';
  let fromAny = '';
  for (const row of (rows || []).slice(0, 8)) {
    for (const c of row || []) {
      const t = cellStr(c);
      if (!/UPTO/i.test(t) && !/AT&C/i.test(t)) continue;
      const p = normalizePeriod(t);
      if (!p) continue;
      if (!fromAny) fromAny = p;
      const looksTitle =
        /WISE|FORMAT|DIVISIONWISE/i.test(t) ||
        (/AT&C LOSS UPTO/i.test(t) && !/CUM\./i.test(t));
      if (looksTitle && !fromTitle) fromTitle = p;
    }
  }
  return fromTitle || fromAny;
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
  if (/GRAND\s*TOTAL/i.test(n) || n.includes('ALL ZONE') || n === 'WBSEDCL') return 'utility';
  if (n.includes('ZONE') || c === '34') return 'zone';
  if (n.includes('REGION') || c === '341') return 'region';
  if (c.length === 4) return 'division';
  if (c.length >= 7) return 'ccc';
  if (/TOTAL/i.test(cccLabel || '')) return 'division';
  return 'ccc';
}

/** Older Format-IA months leave CCC Code blank on TOTAL / REGION / ZONE rows. */
function inferMissingOfficeCode(
  code: string,
  opts: {
    isTotal: boolean;
    rollupLabel: string;
    currentDivCode: string;
    cccName: string;
    divName: string;
  }
) {
  const raw = String(code || '')
    .trim()
    .replace(/\.0$/, '');
  if (isLikelyOfficeCode(raw)) return raw;
  if (opts.isTotal) {
    const named = codeFromMap(DRO_DIV_CODES, opts.divName, opts.rollupLabel);
    if (named) return named;
    if (opts.currentDivCode && codeFromMap(DRO_DIV_CODES, opts.divName)) return opts.currentDivCode;
    return '';
  }
  const rollup = codeFromMap(DRO_ROLLUP_CODES, opts.rollupLabel, opts.divName, opts.cccName);
  if (rollup) return rollup;
  // CCC rows: name map only — never inherit division code (avoids foreign CCCs → 3414)
  const fromCcc = codeFromMap(DRO_CCC_CODES, opts.cccName);
  if (fromCcc) return fromCcc;
  const label = cellStr(opts.rollupLabel).toUpperCase();
  if (/GRAND\s*TOTAL/i.test(label)) return '1';
  return '';
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

function mergeHeaderRows(top: unknown[], sub: unknown[]) {
  const n = Math.max((top || []).length, (sub || []).length);
  let lastTop = '';
  const out: { i: number; t: string; period: string }[] = [];
  for (let i = 0; i < n; i++) {
    const t = cellStr((top || [])[i]);
    const s = cellStr((sub || [])[i]);
    if (t) lastTop = t;
    out.push({
      i,
      t: `${lastTop} ${s}`.replace(/\s+/g, ' ').trim().toUpperCase(),
      period: normalizePeriod(s) || normalizePeriod(t) || normalizePeriod(`${lastTop} ${s}`),
    });
  }
  return out;
}

/**
 * Format-IA column map — March sheets omit YoY loss cols (Input starts earlier).
 * Current AT&C often sits on the next row under "Achievement" (e.g. May'25).
 */
function mapFormatIAColumns(header: unknown[], sub: unknown[], preferredPeriod: string) {
  const cells = mergeHeaderRows(header, sub);

  let consumers = 4;
  let targetAtc = 5;
  let targetDist = 6;
  let input = -1;
  let demand = -1;
  let collection = -1;
  let collEff = -1;
  const codeCol = findCccCodeColumn(header);
  const atcUpto: { i: number; period: string }[] = [];
  const distUpto: { i: number; period: string }[] = [];

  for (const c of cells) {
    const t = c.t;
    if (/CONSUMER/.test(t)) consumers = c.i;
    if (/INPUT/.test(t) && !/LOSS/.test(t)) input = c.i;
    if (/DEMAND/.test(t) && !/LOSS/.test(t)) demand = c.i;
    if (/COLLEC/.test(t) && !/EFF/.test(t)) collection = c.i;
    if (/COLL/.test(t) && /EFF/.test(t)) collEff = c.i;
    if (/AT&C/.test(t) && /LOSS/.test(t) && !/UPTO|CUM/.test(t)) targetAtc = c.i;
    if (/DIST/.test(t) && /LOSS/.test(t) && !/UPTO|CUM/.test(t)) targetDist = c.i;
    if (/AT&C/.test(t) && /LOSS/.test(t) && /UPTO|CUM/.test(t) && c.period) {
      atcUpto.push({ i: c.i, period: c.period });
    }
    if (/DIST/.test(t) && /LOSS/.test(t) && /UPTO|CUM/.test(t) && c.period) {
      distUpto.push({ i: c.i, period: c.period });
    }
  }

  atcUpto.sort((a, b) => periodSortKey(a.period).localeCompare(periodSortKey(b.period)));
  const curAtc =
    (preferredPeriod && atcUpto.find((x) => x.period === preferredPeriod)) ||
    (atcUpto.length ? atcUpto[atcUpto.length - 1] : null);
  const curPeriod = curAtc ? curAtc.period : preferredPeriod || '';
  const fyMar = priorFyMarch(curPeriod);
  const priorAtc =
    atcUpto.find((x) => x.period === fyMar) || (atcUpto.length > 1 ? atcUpto[0] : null);
  const curMon = headerMonthAbbr(curPeriod);
  const yoyAtc = atcUpto.find(
    (x) =>
      x.period !== curPeriod &&
      x.period !== (priorAtc && priorAtc.period) &&
      headerMonthAbbr(x.period) === curMon
  );

  const distFor = (period: string) => {
    const hit = distUpto.find((d) => d.period === period);
    return hit ? hit.i : -1;
  };

  return {
    codeCol,
    consumers,
    targetAtc,
    targetDist,
    input,
    demand,
    collection,
    collEff,
    curAtc: curAtc ? curAtc.i : -1,
    curDist: distFor(curPeriod),
    curPeriod,
    priorAtc: priorAtc ? priorAtc.i : -1,
    priorDist: priorAtc ? distFor(priorAtc.period) : -1,
    priorPeriod: priorAtc ? priorAtc.period : '',
    yoyAtc: yoyAtc ? yoyAtc.i : -1,
    yoyDist: yoyAtc ? distFor(yoyAtc.period) : -1,
    yoyPeriod: yoyAtc ? yoyAtc.period : '',
  };
}

function headerMonthAbbr(period: string) {
  const m = String(period || '').match(/^([A-Za-z]{3})'/);
  return m ? m[1] : '';
}

function cellAt(row: unknown[], idx: number) {
  if (idx == null || idx < 0) return null;
  return row[idx];
}

function parseFormatIA(
  aoa: unknown[][],
  opts: { period_label?: string; target_fy?: string; preferredPeriod?: string } = {}
) {
  const period_label = opts.period_label || findPeriodInSheet(aoa) || opts.preferredPeriod || '';
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
  let start = headerIdx + 1;
  let subRow = (aoa[start] || []) as unknown[];
  const subJoined = subRow.map(cellStr).join('|').toUpperCase();
  if (subJoined.includes('AT&C') || subJoined.includes('DIST. LOSS') || subJoined.includes('UPTO')) {
    start += 1;
  } else {
    subRow = [];
  }

  const periodHint = findPeriodInSheet(aoa) || opts.preferredPeriod || period_label;
  const col = mapFormatIAColumns(header, subRow, periodHint);
  const periodCur = col.curPeriod || period_label;
  const periodMar = col.priorPeriod || priorFyMarch(periodCur) || '';
  const periodYoy = col.yoyPeriod || '';

  const out: AtcRow[] = [];
  let currentDiv = '';
  let currentDivCode = '';

  for (let i = start; i < aoa.length; i++) {
    const r = (aoa[i] || []) as unknown[];
    if (looksLikeHeaderIA(r)) continue;
    const slCell = cellStr(r[0]);
    const divCell = cellStr(r[1]);
    const cccCell = cellStr(r[2]);
    const rawFromCol =
      col.codeCol >= 0 && r[col.codeCol] != null && r[col.codeCol] !== ''
        ? String(r[col.codeCol]).replace(/\.0$/, '')
        : '';
    if (!rawFromCol && !cccCell && !divCell && !slCell) continue;
    if (cccCell && isHeaderLabelName(cccCell) && !/^TOTAL$/i.test(cccCell)) continue;

    const isTotal = /^TOTAL$/i.test(cccCell);
    // Update division context even when this row is later skipped (no code)
    if (divCell && !isHeaderLabelName(divCell)) {
      currentDiv = cleanName(divCell);
      currentDivCode = codeFromMap(DRO_DIV_CODES, divCell) || '';
    }
    const rollupLabel = slCell || divCell || cccCell;
    const code = inferMissingOfficeCode(rawFromCol, {
      isTotal,
      rollupLabel,
      currentDivCode,
      cccName: cccCell,
      divName: divCell || currentDiv,
    });
    if (!isLikelyOfficeCode(code) && code !== '1') continue;

    const office_type = isTotal
      ? 'division'
      : inferOfficeType(code, rollupLabel || divCell || cccCell, cccCell);
    if (office_type === 'utility') continue;

    let office_name = isTotal
      ? currentDiv || cleanName(divCell) || code
      : cleanName(cccCell) || cleanName(divCell) || cleanName(slCell) || code;
    if (office_type === 'region') office_name = 'Darjeeling Region';
    if (office_type === 'zone') {
      office_name = cleanName(divCell || slCell || cccCell) || 'Siliguri Zone';
    }

    const division_code =
      office_type === 'ccc' ? code.slice(0, 4) : office_type === 'division' ? code : '';
    if (office_type === 'ccc' && code.length >= 4) currentDivCode = code.slice(0, 4);
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
      consumer_count: num(cellAt(r, col.consumers)),
      target_atc: asPercent(cellAt(r, col.targetAtc)),
      target_dist: asPercent(cellAt(r, col.targetDist)),
      atc_mar: asPercent(cellAt(r, col.priorAtc)),
      dist_mar: asPercent(cellAt(r, col.priorDist)),
      atc_yoy: asPercent(cellAt(r, col.yoyAtc)),
      dist_yoy: asPercent(cellAt(r, col.yoyDist)),
      input_mu: num(cellAt(r, col.input)),
      demand_mu: num(cellAt(r, col.demand)),
      collection_mu: num(cellAt(r, col.collection)),
      atc_loss: asPercent(cellAt(r, col.curAtc)),
      dist_loss: asPercent(cellAt(r, col.curDist)),
      coll_eff: asPercent(cellAt(r, col.collEff)),
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

  const periodCur = normalizePeriod(subRow[10]) || period_label;
  const periodMar = normalizePeriod(subRow[8]) || priorFyMarch(periodCur) || '';
  const periodYoy = normalizePeriod(subRow[9]) || '';

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
      target_atc: asPercent(r[3]),
      target_dist: asPercent(r[4]),
      input_mu: num(r[5]),
      demand_mu: num(r[6]),
      collection_mu: num(r[7]),
      atc_mar: asPercent(r[8]),
      atc_yoy: asPercent(r[9]),
      atc_loss: asPercent(r[10]),
      dist_mar: asPercent(r[11]),
      dist_yoy: asPercent(r[12]),
      dist_loss: asPercent(r[13]),
      coll_eff_mar: asPercent(r[14]),
      coll_eff_yoy: asPercent(r[15]),
      coll_eff: asPercent(r[16]),
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

  const scoped = all.filter((r) => isDroScopedOffice(r.office_code));
  const filtered_out = all.length - scoped.length;

  return {
    period_label,
    target_fy,
    rows: scoped,
    filtered_out,
    counts: {
      IA: scoped.filter((r) => r.source_format === 'IA').length,
      IB: scoped.filter((r) => r.source_format === 'IB').length,
    },
  };
}
