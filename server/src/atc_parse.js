/**
 * Parse WBSEDCL Format-IA (CCC) and Format-IB (Division) ATC workbooks.
 * Column names shift by month; layout is detected from header markers.
 */

const MONTHS = {
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

function cellStr(v) {
  if (v == null) return '';
  return String(v).replace(/\s+/g, ' ').trim();
}

function num(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

/** Excel % cells arrive as fractions (0.0628); whole numbers are already percent points. */
function asPercent(v) {
  const n = num(v);
  if (n == null) return null;
  if (Math.abs(n) <= 1) return n * 100;
  return n;
}

/** Prior FY closing March for a given achievement month (WBSEDCL FY = Apr–Mar). */
function priorFyMarch(period) {
  const m = String(period || '').match(/^([A-Za-z]+)'(\d{2})$/);
  if (!m) return '';
  const mon = m[1].slice(0, 3).toLowerCase();
  let y = Number(m[2]);
  if (['jan', 'feb', 'mar'].includes(mon)) y -= 1;
  return `Mar'${String(y).padStart(2, '0')}`;
}

/** May'2026 / MAY'26 / May 2026 → May'26 */
function normalizePeriod(text) {
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

function periodSortKey(periodLabel) {
  const m = String(periodLabel || '').match(/^([A-Za-z]+)'(\d{2})$/);
  if (!m) return periodLabel || '';
  const mm = MONTHS[m[1].toLowerCase().slice(0, 3)];
  if (!mm) return periodLabel;
  return `20${m[2]}-${mm}`;
}

function extractTargetFy(text) {
  const m = cellStr(text).match(/20\d{2}\s*[-–]\s*\d{2,4}/);
  if (!m) return '';
  const parts = m[0].replace(/\s/g, '').split(/[-–]/);
  const a = parts[0];
  let b = parts[1] || '';
  if (b.length === 2) b = a.slice(0, 2) + b;
  return `${a}-${b.slice(2)}`;
}

function looksLikeHeaderIA(row) {
  const cells = (row || []).map((c) => cellStr(c).toUpperCase());
  const joined = cells.join('|');
  // Real column header has DIVISION + CCC label/code — not the sheet title row.
  const hasDiv = cells.some((c) => c === 'DIVISION' || c.startsWith('DIVISION'));
  const hasCccCol =
    cells.some((c) => c.includes('CCC CODE') || c === 'CCC') ||
    cells.some((c) => c === 'CUSTOMER CARE CENTRE' || c.startsWith('CUSTOMER CARE CENTRE'));
  const hasSl = cells.some((c) => c.includes('SL') && c.includes('NO'));
  return hasDiv && hasCccCol && (hasSl || joined.includes('CCC CODE'));
}

function isNumericOfficeCode(code) {
  // Zone=34, Region=341, Division=3412, CCC=3412502
  return /^\d{2,}$/.test(String(code || '').trim());
}

/**
 * Real office codes are 2/3/4/7 digits. Consumer counts (5–6+ digits that aren't
 * 7-digit CCC codes) must not be treated as codes — older sheets omit CCC Code.
 */
function isLikelyOfficeCode(code) {
  const c = String(code || '').trim().replace(/\.0$/, '');
  if (!/^\d+$/.test(c)) return false;
  const len = c.length;
  return len === 2 || len === 3 || len === 4 || len === 7;
}

/** DRO app scope: zone 34, region 341, divisions 3412–3415, their CCCs. */
function isDroScopedOffice(code) {
  const c = String(code || '').trim();
  if (c === '34' || c === '341') return true;
  if (/^341[2-5]$/.test(c)) return true;
  if (/^341[2-5]\d{3}$/.test(c)) return true;
  return false;
}

function normalizeOfficeKey(name) {
  return cellStr(name)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Name → code for sheets that omit the CCC Code column (e.g. Feb'25). */
const DRO_DIV_CODES = {
  'SILIGURI TOWN': '3412',
  'SILIGURI SUBARBAN': '3415',
  'SILIGURI SUB URBAN': '3415',
  'SILIGURI SUBURBAN': '3415',
  KURSEONG: '3413',
  DARJEELING: '3414',
};

const DRO_CCC_CODES = {
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

const DRO_ROLLUP_CODES = {
  'SILIGURI ZONE': '34',
  'DARJEELING REGION': '341',
};

function codeFromMap(map, ...names) {
  for (const name of names) {
    const key = normalizeOfficeKey(name);
    if (!key || key === 'TOTAL') continue;
    if (map[key]) return map[key];
  }
  return '';
}

function codeFromOfficeName(...names) {
  return (
    codeFromMap(DRO_ROLLUP_CODES, ...names) ||
    codeFromMap(DRO_DIV_CODES, ...names) ||
    codeFromMap(DRO_CCC_CODES, ...names)
  );
}

function findCccCodeColumn(header) {
  const cells = header || [];
  for (let i = 0; i < cells.length; i++) {
    const t = cellStr(cells[i]).toUpperCase();
    if (/CCC\s*CODE/.test(t) || t === 'CODE' || t === 'OFFICE CODE') return i;
  }
  return -1;
}

function isHeaderLabelName(name) {
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

function looksLikeHeaderIB(row) {
  const cells = (row || []).map((c) => cellStr(c).toUpperCase());
  const joined = cells.join('|');
  if (looksLikeHeaderIA(row)) return false;
  if (joined.includes('CUSTOMER CARE CENTRE') || joined.includes('CCC CODE')) return false;
  const hasDiv = cells.some((c) => c === 'DIVISION' || c === 'DIVISION NAME' || /^DIVISION$/.test(c));
  const hasSl = cells.some((c) => /SL/.test(c) && /NO/.test(c));
  if (!hasDiv || !hasSl) return false;
  const hasTarget = joined.includes('TARGET');
  const hasAtc = joined.includes('AT&C');
  const hasInput = /ENERGY INPUT|TOTAL ENERGY/.test(joined);
  return hasTarget || (hasAtc && hasInput) || (hasAtc && joined.includes('DISTRIBUTION'));
}

function isJunkSheetName(name) {
  const n = String(name || '').toUpperCase();
  if (/ALL\s*CCC\s*ONLY/.test(n)) return true;
  if (/IIA\s*\(|FORMAT[\s-]*II\s*A|FORMAT[\s-]*IIA/.test(n)) return true;
  return false;
}

function sheetBanner(aoa) {
  return (aoa || [])
    .slice(0, 16)
    .map((r) => (r || []).map(cellStr).join(' '))
    .join('\n')
    .toUpperCase();
}

function isSapSheet(name, aoa) {
  const n = String(name || '').toUpperCase();
  if (/^0ANALYSIS/.test(n) || /ZQ_REP/.test(n)) return true;
  const blob = sheetBanner(aoa);
  if (/PH-1|FORMAT-\s*I/.test(blob)) return false;
  if (blob.includes('REPORTING MONTH') && blob.includes('ZONE NAME')) return true;
  if (blob.includes('ZONE NAME') && blob.includes('REGION NAME') && blob.includes('CUSTOMER CARE CENTRE CODE')) {
    return true;
  }
  return false;
}

function findPeriodInSheet(rows) {
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

function findTargetFyInSheet(rows) {
  for (const row of rows.slice(0, 8)) {
    for (const c of row || []) {
      const fy = extractTargetFy(c);
      if (fy) return fy;
    }
  }
  return '2026-27';
}

function inferOfficeType(code, name, cccLabel) {
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

/**
 * Older Format-IA months leave CCC Code blank on TOTAL / REGION / ZONE rows.
 * Infer from the running division context or known DRO rollup labels.
 */
function inferMissingOfficeCode(code, { isTotal, rollupLabel, currentDivCode, cccName, divName }) {
  const raw = String(code || '').trim().replace(/\.0$/, '');
  if (isLikelyOfficeCode(raw)) return raw;
  if (isTotal) {
    const named = codeFromMap(DRO_DIV_CODES, divName, rollupLabel);
    if (named) return named;
    // Only reuse running div code while still inside a known DRO division
    if (currentDivCode && codeFromMap(DRO_DIV_CODES, divName)) return currentDivCode;
    return '';
  }
  const rollup = codeFromMap(DRO_ROLLUP_CODES, rollupLabel, divName, cccName);
  if (rollup) return rollup;
  // CCC rows: name map only — never inherit division code (avoids foreign CCCs → 3414)
  const fromCcc = codeFromMap(DRO_CCC_CODES, cccName);
  if (fromCcc) return fromCcc;
  const label = cellStr(rollupLabel).toUpperCase();
  if (/GRAND\s*TOTAL/i.test(label)) return '1';
  return '';
}

function cleanName(name) {
  return cellStr(name).replace(/\s+/g, ' ');
}

/**
 * Turn wide "UPTO Mar'26 / May'25 / May'26" columns into one row per month
 * so trend charts work from a single workbook (and grow as more files arrive).
 */
function expandMonthPoints(base, points) {
  const out = [];
  const seen = new Set();
  for (const p of points) {
    const period = p.period;
    if (!period || seen.has(period)) continue;
    if (p.atc == null && p.dist == null && p.ce == null && !p.full) continue;
    seen.add(period);
    out.push({
      ...base,
      period_label: period,
      period_sort: periodSortKey(period),
      atc_loss: p.atc != null ? p.atc : null,
      dist_loss: p.dist != null ? p.dist : null,
      coll_eff: p.ce != null ? p.ce : null,
      input_mu: p.full ? base.input_mu : null,
      demand_mu: p.full ? base.demand_mu : null,
      collection_mu: p.full ? base.collection_mu : null,
      consumer_count: p.full ? base.consumer_count : null,
      point_source: p.full ? 'achievement' : 'header_month',
      // keep wide refs for detail table on achievement row only
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

/**
 * Format-IA column map — March sheets omit YoY loss cols (Input starts earlier).
 * Detect by header text so Apr (with YoY) and Mar (without) both work.
 * Current AT&C often sits on the next row under "Achievement" (e.g. May'25).
 */
function mapFormatIAColumns(header, sub, preferredPeriod) {
  const cells = mergeHeaderRows(header, sub);

  let consumers = 4;
  let targetAtc = 5;
  let targetDist = 6;
  let input = -1;
  let demand = -1;
  let collection = -1;
  let collEff = -1;
  const codeCol = findCccCodeColumn(header);
  const atcUpto = [];
  const distUpto = [];

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
    atcUpto.find((x) => x.period === fyMar) ||
    (atcUpto.length > 1 ? atcUpto[0] : null);
  const curMon = periodMonthAbbr(curPeriod);
  const yoyAtc = atcUpto.find(
    (x) =>
      x.period !== curPeriod &&
      x.period !== (priorAtc && priorAtc.period) &&
      periodMonthAbbr(x.period) === curMon
  );

  const distFor = (period) => {
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

function periodMonthAbbr(period) {
  const m = String(period || '').match(/^([A-Za-z]{3})'/);
  return m ? m[1] : '';
}

function cellAt(row, idx) {
  if (idx == null || idx < 0) return null;
  return row[idx];
}

/**
 * Format-IA: CCC-wise sheet (includes division TOTAL + region rows).
 * @returns {{ period_label: string, target_fy: string, rows: object[] }}
 */
function parseFormatIA(aoa, opts = {}) {
  const period_label = opts.period_label || findPeriodInSheet(aoa) || opts.preferredPeriod || '';
  const target_fy = opts.target_fy || findTargetFyInSheet(aoa);
  let headerIdx = -1;
  for (let i = 0; i < Math.min(aoa.length, 12); i++) {
    if (looksLikeHeaderIA(aoa[i])) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return { period_label, target_fy, rows: [], source_format: 'IA' };

  const header = aoa[headerIdx] || [];
  let start = headerIdx + 1;
  let subRow = aoa[start] || [];
  const subJoined = (subRow || []).map(cellStr).join('|').toUpperCase();
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

  const out = [];
  let currentDiv = '';
  let currentDivCode = '';

  for (let i = start; i < aoa.length; i++) {
    const r = aoa[i] || [];
    if (looksLikeHeaderIA(r)) continue;
    const slCell = cellStr(r[0]);
    const divCell = cellStr(r[1]);
    const cccCell = cellStr(r[2]);
    const rawFromCol =
      col.codeCol >= 0 && r[col.codeCol] != null && r[col.codeCol] !== ''
        ? String(r[col.codeCol]).replace(/\.0$/, '')
        : '';
    if (!rawFromCol && !cccCell && !divCell && !slCell) continue;
    // Skip column-header leftovers only (not blank CCC on region total rows)
    if (cccCell && isHeaderLabelName(cccCell) && !/^TOTAL$/i.test(cccCell)) continue;

    const isTotal = /^TOTAL$/i.test(cccCell);
    // Update division context even when this row is later skipped (no code)
    if (divCell && !isHeaderLabelName(divCell)) {
      currentDiv = cleanName(divCell);
      currentDivCode = codeFromMap(DRO_DIV_CODES, divCell) || '';
    }
    // REGION / ZONE / GRAND TOTAL labels often sit in SL. NO. when code is blank
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
      office_type === 'ccc'
        ? code.slice(0, 4)
        : office_type === 'division'
          ? code
          : '';

    if (office_type === 'ccc' && code.length >= 4) currentDivCode = code.slice(0, 4);
    if (office_type === 'division') currentDivCode = code;

    const base = {
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
        { period: periodYoy, atc: base.atc_yoy, dist: base.dist_yoy, ce: null },
        { period: periodMar, atc: base.atc_mar, dist: base.dist_mar, ce: null },
        {
          period: periodCur || period_label,
          atc: base.atc_loss,
          dist: base.dist_loss,
          ce: base.coll_eff,
          full: true,
        },
      ])
    );
  }

  return { period_label: periodCur || period_label, target_fy, rows: out, source_format: 'IA' };
}

function mergeHeaderRows(top, sub) {
  const n = Math.max((top || []).length, (sub || []).length);
  let lastTop = '';
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = cellStr((top || [])[i]);
    const s = cellStr((sub || [])[i]);
    if (t) lastTop = t;
    out.push({
      i,
      top: t.toUpperCase(),
      sub: s.toUpperCase(),
      t: `${lastTop} ${s}`.replace(/\s+/g, ' ').trim().toUpperCase(),
      period: normalizePeriod(s) || normalizePeriod(t) || normalizePeriod(`${lastTop} ${s}`),
    });
  }
  return out;
}

function pickBestMuCol(candidates, preferTotal) {
  if (!candidates.length) return -1;
  const total = candidates.filter((c) => /TOTAL/.test(c.t) && !/MODIFIED/.test(c.t) && !/L&MV|L AND MV|\bBULK\b/.test(c.t));
  if (preferTotal && total.length) return total[0].i;
  const modified = candidates.filter((c) => /TOTAL/.test(c.t) && /MODIFIED/.test(c.t));
  if (modified.length) return modified[0].i;
  const plain = candidates.filter((c) => !/L&MV|L AND MV|\bBULK\b/.test(c.t));
  if (plain.length) return plain[0].i;
  return candidates[0].i;
}

function findIbCodeColumn(cells, dataRows) {
  for (const c of cells) {
    if (/\bCODE\b/.test(c.t) && !/CCC/.test(c.t) && !/CONSUMER/.test(c.t)) return c.i;
  }
  const width = Math.min(8, Math.max(0, ...dataRows.map((r) => (r || []).length)));
  let bestCol = -1;
  let bestScore = 0;
  for (let col = 0; col < width; col++) {
    const vals = dataRows.slice(0, 16).map((r) =>
      String((r || [])[col] ?? '')
        .replace(/\.0$/, '')
        .trim()
    );
    const seq = vals.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0 && n < 200);
    let sequential = 0;
    for (let i = 1; i < seq.length; i++) {
      if (seq[i] === seq[i - 1] + 1) sequential += 1;
    }
    if (sequential >= 8) continue;
    let score = 0;
    for (const v of vals) {
      if (!/^\d{2,4}$/.test(v) || !isLikelyOfficeCode(v)) continue;
      if (v.length === 4) score += 3;
      else if (v.length === 3) score += 2;
      else score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCol = col;
    }
  }
  return bestScore >= 6 ? bestCol : -1;
}

function mapFormatIBColumns(header, sub, dataRows, preferredPeriod) {
  const cells = mergeHeaderRows(header, sub);
  let nameCol = 1;
  const inputCands = [];
  const demandCands = [];
  const collCands = [];
  let targetAtc = -1;
  let targetDist = -1;
  const atcUpto = [];
  const distUpto = [];
  const ceUpto = [];

  for (const c of cells) {
    const t = c.t;
    if (c.top === 'DIVISION' || c.top === 'DIVISION NAME') nameCol = c.i;
    if (/TARGET/.test(t) && /AT&C/.test(t) && !/UPTO|CUM/.test(t)) targetAtc = c.i;
    if (/TARGET/.test(t) && /DIST/.test(t) && !/UPTO|CUM/.test(t)) targetDist = c.i;
    if ((/ENERGY INPUT/.test(t) || (/INPUT/.test(t) && /MU/.test(t))) && !/LOSS/.test(t) && !/DEMAND/.test(t)) {
      inputCands.push(c);
    }
    if (/DEMAND/.test(t) && /MU/.test(t) && !/LOSS/.test(t) && !/INPUT/.test(t)) demandCands.push(c);
    if ((/COLLEC/.test(t) || /COLLECTED/.test(t)) && /MU/.test(t) && !/EFF/.test(t) && !/LOSS/.test(t)) {
      collCands.push(c);
    }
    if (/AT&C/.test(t) && /LOSS/.test(t) && (/UPTO/.test(t) || /CUM/.test(t)) && c.period) {
      atcUpto.push({ i: c.i, period: c.period });
    }
    if (/DIST/.test(t) && /LOSS/.test(t) && (/UPTO/.test(t) || /CUM/.test(t)) && c.period) {
      distUpto.push({ i: c.i, period: c.period });
    }
    if (/COLL/.test(t) && /EFF/.test(t) && c.period) {
      ceUpto.push({ i: c.i, period: c.period });
    }
  }

  atcUpto.sort((a, b) => periodSortKey(a.period).localeCompare(periodSortKey(b.period)));
  const curAtc =
    (preferredPeriod && atcUpto.find((x) => x.period === preferredPeriod)) ||
    (atcUpto.length ? atcUpto[atcUpto.length - 1] : null);
  const curPeriod = curAtc ? curAtc.period : '';
  const fyMar = priorFyMarch(curPeriod);
  const priorAtc =
    atcUpto.find((x) => x.period === fyMar) || (atcUpto.length > 1 ? atcUpto[0] : null);
  const curMon = periodMonthAbbr(curPeriod);
  const yoyAtc = atcUpto.find(
    (x) =>
      x.period !== curPeriod &&
      x.period !== (priorAtc && priorAtc.period) &&
      periodMonthAbbr(x.period) === curMon
  );
  const byPeriod = (list, period) => {
    const hit = list.find((d) => d.period === period);
    return hit ? hit.i : -1;
  };

  return {
    nameCol,
    codeCol: findIbCodeColumn(cells, dataRows),
    targetAtc,
    targetDist,
    input: pickBestMuCol(inputCands, true),
    demand: pickBestMuCol(demandCands, true),
    collection: pickBestMuCol(collCands, true),
    curAtc: curAtc ? curAtc.i : -1,
    curDist: byPeriod(distUpto, curPeriod),
    curCe: byPeriod(ceUpto, curPeriod),
    curPeriod,
    priorAtc: priorAtc ? priorAtc.i : -1,
    priorDist: priorAtc ? byPeriod(distUpto, priorAtc.period) : -1,
    priorCe: priorAtc ? byPeriod(ceUpto, priorAtc.period) : -1,
    priorPeriod: priorAtc ? priorAtc.period : '',
    yoyAtc: yoyAtc ? yoyAtc.i : -1,
    yoyDist: yoyAtc ? byPeriod(distUpto, yoyAtc.period) : -1,
    yoyCe: yoyAtc ? byPeriod(ceUpto, yoyAtc.period) : -1,
    yoyPeriod: yoyAtc ? yoyAtc.period : '',
  };
}

/**
 * Format-IB: Division / Region losses (different basis — typically excl. bulk path).
 */
function parseFormatIB(aoa, opts = {}) {
  const period_label = opts.period_label || findPeriodInSheet(aoa) || opts.preferredPeriod || '';
  const target_fy = opts.target_fy || findTargetFyInSheet(aoa);
  let headerIdx = -1;
  for (let i = 0; i < Math.min(aoa.length, 12); i++) {
    if (looksLikeHeaderIB(aoa[i])) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return { period_label, target_fy, rows: [], source_format: 'IB' };

  let start = headerIdx + 1;
  let subRow = aoa[start] || [];
  const subJoined = subRow.map(cellStr).join('|').toUpperCase();
  if (subJoined.includes('AT&C') || subJoined.includes('DISTRIBUTION') || subJoined.includes('UPTO')) {
    start += 1;
  } else {
    subRow = [];
  }

  const dataPreview = aoa.slice(start, start + 20);
  const periodHint = findPeriodInSheet(aoa) || opts.preferredPeriod || period_label;
  const col = mapFormatIBColumns(aoa[headerIdx] || [], subRow, dataPreview, periodHint);
  const periodCur = col.curPeriod || period_label;
  const periodMar = col.priorPeriod || priorFyMarch(periodCur) || '';
  const periodYoy = col.yoyPeriod || '';

  const out = [];
  for (let i = start; i < aoa.length; i++) {
    const r = aoa[i] || [];
    if (looksLikeHeaderIB(r)) continue;
    let name = cleanName(cellAt(r, col.nameCol));
    if (!name && r[0] != null && !/^\d+$/.test(String(r[0]).trim())) {
      name = cleanName(r[0]);
    }
    let code =
      col.codeCol >= 0 && r[col.codeCol] != null && r[col.codeCol] !== ''
        ? String(r[col.codeCol]).replace(/\.0$/, '').trim()
        : '';
    if (!code) code = codeFromOfficeName(name) || '';
    if (!name && !code) continue;
    if (name && isHeaderLabelName(name)) continue;
    if (/ALL ZONE/i.test(name) && !code) {
      code = 'ALL';
    }
    if (!code && !name) continue;
    if (!isNumericOfficeCode(code)) continue;

    const office_type = inferOfficeType(code, name, '');
    if (office_type === 'utility') continue;

    const office_name =
      office_type === 'region'
        ? 'Darjeeling Region'
        : office_type === 'zone'
          ? 'Siliguri Zone'
          : name || code;

    const base = {
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
      target_atc: asPercent(cellAt(r, col.targetAtc)),
      target_dist: asPercent(cellAt(r, col.targetDist)),
      input_mu: num(cellAt(r, col.input)),
      demand_mu: num(cellAt(r, col.demand)),
      collection_mu: num(cellAt(r, col.collection)),
      atc_mar: asPercent(cellAt(r, col.priorAtc)),
      atc_yoy: asPercent(cellAt(r, col.yoyAtc)),
      atc_loss: asPercent(cellAt(r, col.curAtc)),
      dist_mar: asPercent(cellAt(r, col.priorDist)),
      dist_yoy: asPercent(cellAt(r, col.yoyDist)),
      dist_loss: asPercent(cellAt(r, col.curDist)),
      coll_eff_mar: asPercent(cellAt(r, col.priorCe)),
      coll_eff_yoy: asPercent(cellAt(r, col.yoyCe)),
      coll_eff: asPercent(cellAt(r, col.curCe)),
    };

    out.push(
      ...expandMonthPoints(base, [
        { period: periodYoy, atc: base.atc_yoy, dist: base.dist_yoy, ce: base.coll_eff_yoy },
        { period: periodMar, atc: base.atc_mar, dist: base.dist_mar, ce: base.coll_eff_mar },
        {
          period: periodCur || period_label,
          atc: base.atc_loss,
          dist: base.dist_loss,
          ce: base.coll_eff,
          full: true,
        },
      ])
    );
  }

  return { period_label: periodCur || period_label, target_fy, rows: out, source_format: 'IB' };
}

function detectSheetKind(name, aoa) {
  if (!aoa || !aoa.length) return 'skip';
  if (isJunkSheetName(name)) return 'skip';
  if (isSapSheet(name, aoa)) return 'sap';
  const n = String(name || '').toUpperCase();
  const banner = sheetBanner(aoa);
  if (/FORMAT[\s-]*II\s*A|FORMAT[\s-]*IIA/.test(banner) && !/FORMAT-\s*I\s*B|FORMAT-IB|FORMAT-IA/.test(banner)) {
    return 'skip';
  }
  if (/DIVISION|FORMAT[\s-]*I\s*B|FORMAT[\s-]*IB/i.test(n)) return 'IB';
  const title = cellStr((aoa[1] || [])[0] || (aoa[2] || [])[0] || '').toUpperCase();
  if (title.includes('FORMAT- I B') || title.includes('FORMAT-IB') || title.includes('DIVISIONWISE')) {
    return 'IB';
  }
  if (title.includes('FORMAT-IA') || title.includes('CUSTOMER CARE') || /CCC/i.test(n)) {
    return 'IA';
  }
  for (let i = 0; i < Math.min(8, aoa.length); i++) {
    if (looksLikeHeaderIA(aoa[i])) return 'IA';
    if (looksLikeHeaderIB(aoa[i]) && !looksLikeHeaderIA(aoa[i])) return 'IB';
  }
  return 'skip';
}

/**
 * Parse a full workbook (xlsx SheetNames + sheets as AOA).
 * @param {{ SheetNames: string[], Sheets: Record<string, any> }} wb
 * @param {(sheet: any) => any[][]} sheetToAoa
 */
function parseAtcWorkbook(wb, sheetToAoa, opts = {}) {
  const all = [];
  let period_label = opts.period_label || '';
  let target_fy = opts.target_fy || '';
  const skipped_sheets = [];
  let sawSap = false;
  let sawPh1 = false;
  const sheetOpts = {
    ...opts,
    preferredPeriod: opts.period_label || opts.preferredPeriod || normalizePeriod(opts.filename || ''),
  };

  for (const name of wb.SheetNames || []) {
    const aoa = sheetToAoa(wb.Sheets[name]);
    if (!aoa || !aoa.length) {
      skipped_sheets.push(name);
      continue;
    }
    const kind = detectSheetKind(name, aoa);
    if (kind === 'skip') {
      skipped_sheets.push(name);
      continue;
    }
    if (kind === 'sap') {
      sawSap = true;
      skipped_sheets.push(name);
      continue;
    }
    sawPh1 = true;
    const parsed = kind === 'IB' ? parseFormatIB(aoa, sheetOpts) : parseFormatIA(aoa, sheetOpts);
    if (!period_label && parsed.period_label) period_label = parsed.period_label;
    if (!target_fy && parsed.target_fy) target_fy = parsed.target_fy;
    if (!parsed.period_label && period_label) {
      parsed.rows.forEach((r) => {
        r.period_label = period_label;
        r.period_sort = periodSortKey(period_label);
      });
    } else if (!parsed.period_label) {
      const fromName = normalizePeriod(name);
      if (fromName) {
        parsed.rows.forEach((r) => {
          r.period_label = fromName;
          r.period_sort = periodSortKey(fromName);
        });
        if (!period_label) period_label = fromName;
      }
    }
    all.push(...parsed.rows);
  }

  if (opts.period_label) {
    all.forEach((r) => {
      if (!r.period_label) {
        r.period_label = opts.period_label;
        r.period_sort = periodSortKey(opts.period_label);
      }
    });
    if (!period_label) period_label = opts.period_label;
  }

  const scoped = all.filter((r) => isDroScopedOffice(r.office_code));
  const filtered_out = all.length - scoped.length;
  const counts = {
    IA: scoped.filter((r) => r.source_format === 'IA').length,
    IB: scoped.filter((r) => r.source_format === 'IB').length,
  };

  const achMonths = (fmt) =>
    [
      ...new Set(
        scoped
          .filter((r) => r.source_format === fmt && r.point_source === 'achievement')
          .map((r) => r.period_label)
          .filter(Boolean)
      ),
    ].sort((a, b) => periodSortKey(a).localeCompare(periodSortKey(b)));
  const extraMonths = (fmt) =>
    [
      ...new Set(
        scoped
          .filter((r) => r.source_format === fmt && r.point_source !== 'achievement')
          .map((r) => r.period_label)
          .filter(Boolean)
      ),
    ].sort((a, b) => periodSortKey(a).localeCompare(periodSortKey(b)));

  let error = '';
  if (!scoped.length) {
    if (sawSap && !sawPh1) {
      error = 'This looks like a SAP/BO export, not a Ph-1 Format-IA/IB workbook.';
    } else {
      error = 'No Format-IA or Format-IB sheet found in this workbook.';
    }
  }

  const iaPrimary = achMonths('IA');
  const ibPrimary = achMonths('IB');
  const formats = [];
  if (counts.IA) formats.push('IA');
  if (counts.IB) formats.push('IB');

  return {
    period_label: period_label || iaPrimary[0] || ibPrimary[0] || '',
    target_fy,
    rows: scoped,
    filtered_out,
    counts,
    skipped_sheets,
    formats,
    primary_months: { IA: iaPrimary, IB: ibPrimary },
    extra_months: { IA: extraMonths('IA'), IB: extraMonths('IB') },
    error,
  };
}

module.exports = {
  asPercent,
  priorFyMarch,
  isDroScopedOffice,
  normalizePeriod,
  periodSortKey,
  parseFormatIA,
  parseFormatIB,
  parseAtcWorkbook,
  detectSheetKind,
  expandMonthPoints,
  isSapSheet,
  isJunkSheetName,
};
