/**
 * FY-end AT&C target cascade.
 *
 * Input is forecast to March of the current FY from YTD trend (same-month YoY
 * remaining energy, blended with recent monthly run-rate). Demand / Collection
 * at the horizon follow current T&D and AT&C rates, then extra Collection MU
 * needed for the new AT&C % is allocated to child offices by
 * Input × headroom^α — low-loss offices barely move.
 *
 * Identities (YTD or FY-end MU):
 *   T&D %    = (Input − Demand) / Input
 *   Coll.eff = Collection / Demand
 *   AT&C %   = (Input − Collection) / Input
 */

const FY_MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'] as const;
const STRUCTURAL_ATC = 0.5;
const STRUCTURAL_TD = 0.5;
const CE_MAX = 99.5;
const REMAINING_YOY_CAP = 0.3;

export type TargetEffort = 'easy' | 'fair' | 'hard' | 'stretch';

export type TargetOffice = {
  office_code: string;
  office_name: string;
  office_type: string;
  division_code: string;
  inputNow: number;
  demandNow: number | null;
  collectionNow: number | null;
  atcNow: number;
  tdNow: number;
  ceNow: number | null;
  inputFy: number;
  demandSq: number;
  collectionSq: number;
  demandNew: number;
  collectionNew: number;
  atcNew: number;
  tdNew: number;
  ceNew: number;
  dDemand: number;
  dCollection: number;
  dDemandGrowth: number;
  dDemandTighten: number;
  dCollectionGrowth: number;
  dCollectionTighten: number;
  dAtcPp: number;
  dTdPp: number;
  atcMar: number | null;
  tdMar: number | null;
  dAtcVsMar: number | null;
  dTdVsMar: number | null;
  atcPrev: number | null;
  tdPrev: number | null;
  inputPrev: number | null;
  demandPrev: number | null;
  collectionPrev: number | null;
  inputMar: number | null;
  demandMar: number | null;
  collectionMar: number | null;
  dAtcVsPrev: number | null;
  dTdVsPrev: number | null;
  floorAtc: number;
  floorTd: number;
  effort: TargetEffort;
  stretch: boolean;
};

export type InputIncrement = { period: string; mu: number };

export type TargetScenario = {
  asOf: string;
  horizon: string;
  fyLabel: string;
  elapsedMonths: number;
  remainingMonths: number;
  yoyInputPct: number | null;
  inputMethod: 'closed' | 'seasonal' | 'runrate' | 'blend' | 'prorate';
  parent: TargetOffice;
  children: TargetOffice[];
  nested: Record<string, TargetOffice[]>;
  feasible: boolean;
  feasibleAtc: number;
  targetAtc: number;
  currentAtc: number;
  workbookTarget: number | null;
  lastMarch: string;
  lastMonth: string;
  predictedAtc: number;
  increments: InputIncrement[];
};

type Snap = {
  office_code: string;
  office_name: string;
  office_type: string;
  division_code: string;
  period: string;
  input: number;
  demand: number | null;
  collection: number | null;
  atc: number;
  td: number;
  ce: number | null;
  targetAtc: number | null;
  atcMar: number | null;
  tdMar: number | null;
  inputMar: number | null;
  demandMar: number | null;
  collectionMar: number | null;
  atcPrev: number | null;
  tdPrev: number | null;
  inputPrev: number | null;
  demandPrev: number | null;
  collectionPrev: number | null;
};

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function asPct(v: unknown): number | null {
  const n = num(v);
  if (n == null) return null;
  return Math.abs(n) <= 1.5 ? n * 100 : n;
}

export function periodSortKey(periodLabel: string): string {
  const m = String(periodLabel || '').match(/^([A-Za-z]+)'(\d{2})$/);
  if (!m) return periodLabel || '';
  const mm: Record<string, string> = {
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
  const key = mm[m[1].toLowerCase().slice(0, 3)];
  if (!key) return periodLabel;
  return `20${m[2]}-${key}`;
}

function parsePeriod(period: string): { mon: string; yy: number } | null {
  const m = String(period || '').match(/^([A-Za-z]{3})'(\d{2})$/);
  if (!m) return null;
  const mon = m[1].charAt(0).toUpperCase() + m[1].slice(1, 3).toLowerCase();
  const yy = Number(m[2]);
  if (!Number.isFinite(yy) || !FY_MONTHS.includes(mon as (typeof FY_MONTHS)[number])) return null;
  return { mon, yy };
}

function fyMonthIndex(period: string): number {
  const p = parsePeriod(period);
  if (!p) return -1;
  return FY_MONTHS.indexOf(p.mon as (typeof FY_MONTHS)[number]);
}

/** March YY of the FY that contains this period (Apr n → Mar n+1). */
export function fyEndYy(period: string): number | null {
  const p = parsePeriod(period);
  if (!p) return null;
  const idx = FY_MONTHS.indexOf(p.mon as (typeof FY_MONTHS)[number]);
  if (idx < 0) return null;
  return idx >= 9 ? p.yy : p.yy + 1;
}

export function fyHorizon(period: string): string {
  const y = fyEndYy(period);
  if (y == null) return '';
  return `Mar'${String(y).padStart(2, '0')}`;
}

export function fyLabel(period: string): string {
  const y = fyEndYy(period);
  if (y == null) return '';
  const start = y - 1;
  return `FY${String(start).padStart(2, '0')}-${String(y).padStart(2, '0')}`;
}

/** Last closed FY March for an as-of month (Jul'26 → Mar'26, Feb'26 → Mar'25). */
export function lastMarchPeriod(asOf: string): string {
  const p = parsePeriod(asOf);
  if (!p) return '';
  const mon = p.mon.toLowerCase();
  let y = p.yy;
  if (mon === 'jan' || mon === 'feb' || mon === 'mar') y -= 1;
  return `Mar'${String(y).padStart(2, '0')}`;
}

/** Calendar month before as-of (Jul'26 → Jun'26, Apr'26 → Mar'26). */
export function prevMonthPeriod(asOf: string): string {
  const p = parsePeriod(asOf);
  if (!p) return '';
  const idx = FY_MONTHS.indexOf(p.mon as (typeof FY_MONTHS)[number]);
  if (idx < 0) return '';
  if (idx === 0) return `Mar'${String(p.yy).padStart(2, '0')}`;
  const prevMon = FY_MONTHS[idx - 1];
  const yy = idx === 9 ? p.yy - 1 : p.yy;
  return `${prevMon}'${String(yy).padStart(2, '0')}`;
}

function monthIndex(period: string): number | null {
  const k = periodSortKey(period);
  const m = k.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 12 + Number(m[2]);
}

/** AT&C at FY-end March if the last-March → as-of path continues. */
export function forecastAtcAtHorizon(
  lastMarAtc: number | null,
  currentAtc: number,
  asOf: string,
  horizon: string,
  lastMarch: string
): number {
  const cur = Math.round(currentAtc * 100) / 100;
  if (lastMarAtc == null || !Number.isFinite(lastMarAtc)) return cur;
  const t0 = monthIndex(lastMarch);
  const t1 = monthIndex(asOf);
  const t2 = monthIndex(horizon);
  if (t0 == null || t1 == null || t2 == null || t1 <= t0) return cur;
  const remain = t2 - t1;
  if (remain <= 0) return cur;
  const predicted = currentAtc + ((currentAtc - lastMarAtc) / (t1 - t0)) * remain;
  const hi = Math.max(lastMarAtc, currentAtc) + 3;
  return Math.round(Math.max(0.5, Math.min(hi, predicted)) * 100) / 100;
}

function sameMonthPriorYear(period: string): string {
  const p = parsePeriod(period);
  if (!p) return '';
  return `${p.mon}'${String(p.yy - 1).padStart(2, '0')}`;
}

function energyAtc(input: number, collection: number | null, fallbackPct: number | null): number {
  if (collection != null && input > 0) return ((input - collection) / input) * 100;
  return fallbackPct ?? 0;
}

function energyTd(input: number, demand: number | null, fallbackPct: number | null): number {
  if (demand != null && input > 0) return ((input - demand) / input) * 100;
  return fallbackPct ?? 0;
}

function energyCe(demand: number | null, collection: number | null, fallbackPct: number | null): number | null {
  if (demand != null && demand > 0 && collection != null) return (collection / demand) * 100;
  return fallbackPct;
}

function snapFromRow(r: Record<string, unknown>): Snap | null {
  const input = num(r.input_mu);
  if (input == null || input <= 0) return null;
  const demand = num(r.demand_mu);
  const collection = num(r.collection_mu);
  const atc = energyAtc(input, collection, asPct(r.atc_loss));
  const td = energyTd(input, demand, asPct(r.dist_loss));
  const ce = energyCe(demand, collection, asPct(r.coll_eff));
  const code = String(r.office_code || '').trim();
  if (!code) return null;
  return {
    office_code: code,
    office_name: String(r.office_name || code),
    office_type: String(r.office_type || ''),
    division_code: String(
      r.division_code || (code.length >= 4 ? code.slice(0, 4) : code)
    ),
    period: String(r.period_label || ''),
    input,
    demand,
    collection,
    atc,
    td,
    ce,
    targetAtc: asPct(r.target_atc),
    atcMar: asPct(r.atc_mar),
    tdMar: asPct(r.dist_mar),
    inputMar: null,
    demandMar: null,
    collectionMar: null,
    atcPrev: null,
    tdPrev: null,
    inputPrev: null,
    demandPrev: null,
    collectionPrev: null,
  };
}

function isAchievement(r: Record<string, unknown>): boolean {
  if (String(r.point_source || '').toLowerCase() === 'achievement') return true;
  return num(r.input_mu) != null && num(r.input_mu)! > 0;
}

function officeSeries(
  rows: Record<string, unknown>[],
  code: string,
  format: string
): Snap[] {
  const fmt = format.toUpperCase();
  const out: Snap[] = [];
  for (const r of rows) {
    if (String(r.office_code) !== code) continue;
    if (String(r.source_format || 'IA').toUpperCase() !== fmt) continue;
    if (!isAchievement(r)) continue;
    const s = snapFromRow(r);
    if (s) out.push(s);
  }
  out.sort((a, b) => periodSortKey(a.period).localeCompare(periodSortKey(b.period)));
  return out;
}

function findSnap(series: Snap[], period: string): Snap | null {
  return series.find((s) => s.period === period) || null;
}

function lookupMarch(
  series: Snap[],
  rows: Record<string, unknown>[],
  code: string,
  format: string,
  marPeriod: string,
  headerAtc: number | null,
  headerTd: number | null
): { atc: number | null; td: number | null } {
  const snap = findSnap(series, marPeriod);
  if (snap) return { atc: snap.atc, td: snap.td };
  const fmt = format.toUpperCase();
  let atc: number | null = null;
  let td: number | null = null;
  for (const r of rows) {
    if (String(r.office_code) !== code) continue;
    if (String(r.period_label) !== marPeriod) continue;
    if (String(r.source_format || 'IA').toUpperCase() !== fmt) continue;
    if (atc == null) atc = asPct(r.atc_loss);
    if (td == null) td = asPct(r.dist_loss);
  }
  return { atc: atc ?? headerAtc, td: td ?? headerTd };
}

function withLastMarch(
  snap: Snap,
  series: Snap[],
  rows: Record<string, unknown>[],
  format: string,
  marPeriod: string
): Snap {
  if (!marPeriod) return snap;
  const marchSnap = findSnap(series, marPeriod);
  const m = lookupMarch(series, rows, snap.office_code, format, marPeriod, snap.atcMar, snap.tdMar);
  return {
    ...snap,
    atcMar: m.atc,
    tdMar: m.td,
    inputMar: marchSnap?.input ?? null,
    demandMar: marchSnap?.demand ?? null,
    collectionMar: marchSnap?.collection ?? null,
  };
}

function withPrevMonth(snap: Snap, series: Snap[], prevPeriod: string): Snap {
  if (!prevPeriod) return snap;
  const prev = findSnap(series, prevPeriod);
  if (!prev) return snap;
  return {
    ...snap,
    atcPrev: prev.atc,
    tdPrev: prev.td,
    inputPrev: prev.input,
    demandPrev: prev.demand,
    collectionPrev: prev.collection,
  };
}

function withHistory(
  snap: Snap,
  series: Snap[],
  rows: Record<string, unknown>[],
  format: string,
  marPeriod: string,
  prevPeriod: string
): Snap {
  return withPrevMonth(withLastMarch(snap, series, rows, format, marPeriod), series, prevPeriod);
}

function latestAtOrBefore(series: Snap[], period: string): Snap | null {
  const key = periodSortKey(period);
  let best: Snap | null = null;
  for (const s of series) {
    if (periodSortKey(s.period) <= key) best = s;
  }
  return best;
}

function monthlyIncrements(series: Snap[], fyEnd: number): InputIncrement[] {
  const pts = series.filter((s) => fyEndYy(s.period) === fyEnd);
  const out: InputIncrement[] = [];
  for (let i = 0; i < pts.length; i++) {
    const idx = fyMonthIndex(pts[i].period);
    const prev = pts[i - 1];
    if (!prev) {
      const elapsed = Math.max(1, idx + 1);
      out.push({ period: pts[i].period, mu: pts[i].input / elapsed });
      continue;
    }
    const skipped = Math.max(1, fyMonthIndex(pts[i].period) - fyMonthIndex(prev.period));
    out.push({ period: pts[i].period, mu: (pts[i].input - prev.input) / skipped });
  }
  return out;
}

function forecastInputFy(
  series: Snap[],
  asOf: string,
  inputNow: number
): { inputFy: number; method: TargetScenario['inputMethod']; yoy: number | null; increments: InputIncrement[] } {
  const elapsed = fyMonthIndex(asOf) + 1;
  const remaining = Math.max(0, 12 - elapsed);
  const fyEnd = fyEndYy(asOf);
  const incs = fyEnd != null ? monthlyIncrements(series, fyEnd) : [];
  if (!remaining || fyEnd == null) {
    return { inputFy: inputNow, method: 'closed', yoy: null, increments: incs };
  }

  const sameLy = sameMonthPriorYear(asOf);
  const lyNow = findSnap(series, sameLy);
  const lyHorizon = `Mar'${String(fyEnd - 1).padStart(2, '0')}`;
  const lyMar = findSnap(series, lyHorizon) || latestAtOrBefore(series, lyHorizon);
  const yoy = lyNow && lyNow.input > 0 ? inputNow / lyNow.input - 1 : null;

  const prorateRemaining = inputNow * (remaining / elapsed);

  let seasonalRemaining: number | null = null;
  if (lyNow && lyMar && lyMar.input > lyNow.input) {
    let g = yoy == null ? 0 : Math.max(-REMAINING_YOY_CAP, Math.min(REMAINING_YOY_CAP, yoy));
    seasonalRemaining = (lyMar.input - lyNow.input) * (1 + g);
  }

  const recent = incs.slice(-3).map((x) => x.mu).filter((x) => Number.isFinite(x));
  const runrateRemaining =
    recent.length > 0 ? (recent.reduce((s, x) => s + x, 0) / recent.length) * remaining : null;

  let remainingMu: number;
  let method: TargetScenario['inputMethod'];
  if (seasonalRemaining != null && runrateRemaining != null) {
    remainingMu = seasonalRemaining * 0.6 + runrateRemaining * 0.4;
    method = 'blend';
  } else if (seasonalRemaining != null) {
    remainingMu = seasonalRemaining;
    method = 'seasonal';
  } else if (runrateRemaining != null) {
    remainingMu = runrateRemaining;
    method = 'runrate';
  } else {
    remainingMu = prorateRemaining;
    method = 'prorate';
  }

  remainingMu = Math.max(0, remainingMu);
  const cap = prorateRemaining * 1.45;
  if (prorateRemaining > 0) remainingMu = Math.min(remainingMu, Math.max(cap, prorateRemaining * 0.4));

  return { inputFy: inputNow + remainingMu, method, yoy, increments: incs };
}

function provenFloor(series: Snap[], field: 'atc' | 'td'): number {
  const vals = series.map((s) => s[field]).filter((v) => Number.isFinite(v) && v > 0);
  if (!vals.length) return field === 'atc' ? STRUCTURAL_ATC : STRUCTURAL_TD;
  return Math.min(...vals);
}

function officeFloor(series: Snap[], currentAtc: number, currentTd: number) {
  const bestAtc = provenFloor(series, 'atc');
  const bestTd = provenFloor(series, 'td');
  const floorAtc = Math.max(
    STRUCTURAL_ATC,
    Math.min(currentAtc, bestAtc * 0.62, Math.max(STRUCTURAL_ATC, currentAtc - 5))
  );
  const floorTd = Math.max(
    STRUCTURAL_TD,
    Math.min(currentTd, bestTd * 0.62, Math.max(STRUCTURAL_TD, currentTd - 5))
  );
  return { floorAtc, floorTd };
}

function effortFrom(current: number, next: number, floor: number): TargetEffort {
  const room = current - floor;
  const cut = current - next;
  if (next <= floor + 0.08 && cut > 0.05) return 'stretch';
  if (room <= 0.6) return 'hard';
  if (cut / Math.max(room, 0.15) > 0.55) return 'hard';
  if (cut < 0.15 || room > 4) return 'easy';
  return 'fair';
}

function packOffice(
  snap: Snap,
  inputFy: number,
  demandNew: number,
  collectionNew: number,
  floorAtc: number,
  floorTd: number
): TargetOffice {
  const tdNow = snap.td;
  const atcNow = snap.atc;
  const demandSq = inputFy * (1 - tdNow / 100);
  const collectionSq = inputFy * (1 - atcNow / 100);
  const tdNew = inputFy > 0 ? ((inputFy - demandNew) / inputFy) * 100 : tdNow;
  const atcNew = inputFy > 0 ? ((inputFy - collectionNew) / inputFy) * 100 : atcNow;
  const ceNew = demandNew > 0 ? (collectionNew / demandNew) * 100 : snap.ce || 0;
  const dDemandGrowth = demandSq - (snap.demand ?? demandSq * (snap.input / inputFy));
  const dCollectionGrowth = collectionSq - (snap.collection ?? collectionSq * (snap.input / inputFy));
  const demandToday = snap.demand ?? snap.input * (1 - tdNow / 100);
  const collectionToday = snap.collection ?? snap.input * (1 - atcNow / 100);
  const stretch = atcNew <= floorAtc + 0.05 && atcNow - atcNew > 0.04;
  return {
    office_code: snap.office_code,
    office_name: snap.office_name,
    office_type: snap.office_type,
    division_code: snap.division_code,
    inputNow: snap.input,
    demandNow: snap.demand,
    collectionNow: snap.collection,
    atcNow,
    tdNow,
    ceNow: snap.ce,
    inputFy,
    demandSq,
    collectionSq,
    demandNew,
    collectionNew,
    atcNew,
    tdNew,
    ceNew,
    dDemand: demandNew - demandToday,
    dCollection: collectionNew - collectionToday,
    dDemandGrowth,
    dDemandTighten: demandNew - demandSq,
    dCollectionGrowth,
    dCollectionTighten: collectionNew - collectionSq,
    dAtcPp: atcNew - atcNow,
    dTdPp: tdNew - tdNow,
    atcMar: snap.atcMar,
    tdMar: snap.tdMar,
    dAtcVsMar: snap.atcMar != null ? atcNew - snap.atcMar : null,
    dTdVsMar: snap.tdMar != null ? tdNew - snap.tdMar : null,
    atcPrev: snap.atcPrev,
    tdPrev: snap.tdPrev,
    inputPrev: snap.inputPrev,
    demandPrev: snap.demandPrev,
    collectionPrev: snap.collectionPrev,
    inputMar: snap.inputMar,
    demandMar: snap.demandMar,
    collectionMar: snap.collectionMar,
    dAtcVsPrev: snap.atcPrev != null ? atcNew - snap.atcPrev : null,
    dTdVsPrev: snap.tdPrev != null ? tdNew - snap.tdPrev : null,
    floorAtc,
    floorTd,
    effort: effortFrom(atcNow, atcNew, floorAtc),
    stretch,
  };
}

function mixUnbilled(tdNow: number, floorTd: number, ceNow: number | null): number {
  const ce = ceNow ?? 95;
  let mix = 0.65;
  if (tdNow - floorTd < 0.35) mix = 0.12;
  else if (ce > 98.8) mix = 0.88;
  else if (tdNow > 12 && ce > 97) mix = 0.8;
  else if (tdNow < 4 && ce < 96) mix = 0.25;
  return Math.max(0.08, Math.min(0.92, mix));
}

function applyTargetToChildren(
  parentSnap: Snap,
  parentInputFy: number,
  childSnaps: { snap: Snap; inputFy: number; series: Snap[] }[],
  targetAtc: number
): { parent: TargetOffice; children: TargetOffice[]; feasibleAtc: number; feasible: boolean } {
  const parentNow = parentSnap.input;
  const parentRemain = Math.max(0, parentInputFy - parentNow);
  const remainders = childSnaps.map((c) => Math.max(0, c.inputFy - c.snap.input));
  const sumRemain = remainders.reduce((s, x) => s + x, 0);
  const kRemain = sumRemain > 0 ? parentRemain / sumRemain : 0;
  const scaled = childSnaps.map((c, i) => ({
    ...c,
    inputFy: c.snap.input + remainders[i] * kRemain,
  }));
  const scaledIn = scaled.reduce((s, c) => s + c.inputFy, 0);
  const parentI = scaledIn > 0 ? scaledIn : parentInputFy;

  const floors = scaled.map((c) => officeFloor(c.series, c.snap.atc, c.snap.td));
  const collectionCap = scaled.reduce((s, c, i) => s + c.inputFy * (1 - floors[i].floorAtc / 100), 0);
  const feasibleAtc = parentI > 0 ? ((parentI - collectionCap) / parentI) * 100 : STRUCTURAL_ATC;
  const t = Math.max(targetAtc, feasibleAtc);
  const feasible = targetAtc >= feasibleAtc - 0.04;
  const tightening = t <= parentSnap.atc + 0.02;
  const onTrend = Math.abs(t - parentSnap.atc) < 0.04;

  const parentFloors = officeFloor([parentSnap], parentSnap.atc, parentSnap.td);
  const parentCollection = parentI * (1 - t / 100);
  const parentDemandSq = parentI * (1 - parentSnap.td / 100);

  if (onTrend) {
    const children = scaled.map((c, i) => {
      const I = c.inputFy;
      const dem = I * (1 - c.snap.td / 100);
      const col = I * (1 - c.snap.atc / 100);
      return packOffice(c.snap, I, dem, col, floors[i].floorAtc, floors[i].floorTd);
    });
    const parentDem = children.reduce((s, c) => s + c.demandNew, 0) || parentDemandSq;
    const parentCol = children.reduce((s, c) => s + c.collectionNew, 0) || parentCollection;
    const parent = packOffice(
      parentSnap,
      parentI,
      parentDem,
      parentCol,
      parentFloors.floorAtc,
      parentFloors.floorTd
    );
    parent.atcNew = parentSnap.atc;
    parent.tdNew = parentSnap.td;
    parent.ceNew = parentSnap.ce ?? parent.ceNew;
    parent.dAtcPp = 0;
    parent.dTdPp = 0;
    parent.dAtcVsMar = parent.atcMar != null ? parent.atcNew - parent.atcMar : null;
    parent.dTdVsMar = parent.tdMar != null ? parent.tdNew - parent.tdMar : null;
    parent.dAtcVsPrev = parent.atcPrev != null ? parent.atcNew - parent.atcPrev : null;
    parent.dTdVsPrev = parent.tdPrev != null ? parent.tdNew - parent.tdPrev : null;
    parent.effort = 'easy';
    parent.stretch = false;
    return { parent, children, feasibleAtc, feasible };
  }

  const heads = scaled.map((c, i) => Math.max(0, c.snap.atc - floors[i].floorAtc));
  const colSqSum = scaled.reduce((s, c) => s + c.inputFy * (1 - c.snap.atc / 100), 0);
  const headMu = scaled.reduce((s, c, i) => s + c.inputFy * (heads[i] / 100), 0);
  let f = headMu > 1e-9 ? (parentCollection - colSqSum) / headMu : 0;
  if (tightening) f = Math.max(0, Math.min(1, f));
  else f = Math.max(-1, Math.min(0, f));

  const intended = scaled.map((c, i) => {
    const I = c.inputFy;
    const cap = I * (1 - floors[i].floorAtc / 100);
    const colSq = I * (1 - c.snap.atc / 100);
    const atcNew = c.snap.atc - f * heads[i];
    let col = I * (1 - atcNew / 100);
    if (tightening) col = Math.max(colSq, Math.min(cap, col));
    else col = Math.max(0, Math.min(colSq, col));
    return { colSq, cap, col };
  });

  let colSum = intended.reduce((s, x) => s + x.col, 0);
  let residual = parentCollection - colSum;
  if (Math.abs(residual) > 0.02) {
    const room = intended
      .map((x, i) => {
        const slack = residual > 0 ? x.cap - x.col : tightening ? x.col - x.colSq : x.col;
        return { i, slack };
      })
      .filter((x) => x.slack > 0.01);
    const slackSum = room.reduce((s, x) => s + x.slack, 0);
    if (slackSum > 0) {
      for (const x of room) {
        intended[x.i].col += residual * (x.slack / slackSum);
      }
    }
  }

  const children = scaled.map((c, i) => {
    const I = c.inputFy;
    const col = Math.max(0, Math.min(I, intended[i].col));
    const extra = col - intended[i].colSq;
    const unbSq = I * (c.snap.td / 100);
    const mix = mixUnbilled(c.snap.td, floors[i].floorTd, c.snap.ce);
    const dU = extra * mix;
    let unb = Math.max(I * (floors[i].floorTd / 100), unbSq - dU);
    let dem = I - unb;
    let out = dem - col;
    const outFloor = dem * (1 - CE_MAX / 100);
    if (out < outFloor) {
      unb = Math.min(I - col, Math.max(I * (floors[i].floorTd / 100), I - (col / (CE_MAX / 100))));
      dem = I - unb;
      out = dem - col;
    }
    if (out < 0) {
      dem = col;
      unb = I - dem;
      out = 0;
    }
    return packOffice(c.snap, I, dem, col, floors[i].floorAtc, floors[i].floorTd);
  });

  const parentTdNew =
    parentI > 0 ? ((parentI - children.reduce((s, c) => s + c.demandNew, 0)) / parentI) * 100 : parentSnap.td;
  const parentDem = children.reduce((s, c) => s + c.demandNew, 0) || parentDemandSq;
  const parentCol = children.reduce((s, c) => s + c.collectionNew, 0) || parentCollection;
  const parent = packOffice(parentSnap, parentI, parentDem, parentCol, parentFloors.floorAtc, parentFloors.floorTd);
  parent.atcNew = parentI > 0 ? ((parentI - parentCol) / parentI) * 100 : t;
  parent.tdNew = parentTdNew;
  parent.ceNew = parentDem > 0 ? (parentCol / parentDem) * 100 : parentSnap.ce || 0;
  parent.dAtcPp = parent.atcNew - parent.atcNow;
  parent.dTdPp = parent.tdNew - parent.tdNow;
  parent.dAtcVsMar = parent.atcMar != null ? parent.atcNew - parent.atcMar : null;
  parent.dTdVsMar = parent.tdMar != null ? parent.tdNew - parent.tdMar : null;
  parent.dAtcVsPrev = parent.atcPrev != null ? parent.atcNew - parent.atcPrev : null;
  parent.dTdVsPrev = parent.tdPrev != null ? parent.tdNew - parent.tdPrev : null;
  parent.effort = effortFrom(parent.atcNow, parent.atcNew, parent.floorAtc);

  return { parent, children, feasibleAtc, feasible };
}

function listChildCodes(
  rows: Record<string, unknown>[],
  format: string,
  asOf: string,
  parentType: 'region' | 'division',
  parentCode: string
): string[] {
  const fmt = format.toUpperCase();
  const want = parentType === 'region' ? 'division' : 'ccc';
  const codes = new Set<string>();
  for (const r of rows) {
    if (String(r.source_format || 'IA').toUpperCase() !== fmt) continue;
    if (String(r.period_label) !== asOf) continue;
    if (String(r.office_type) !== want) continue;
    const code = String(r.office_code || '');
    if (want === 'division' && !/^341[2-5]$/.test(code)) continue;
    if (want === 'ccc' && !/^341[2-5]\d{3}$/.test(code)) continue;
    if (want === 'ccc' && !code.startsWith(parentCode) && String(r.division_code || '') !== parentCode) continue;
    if (num(r.input_mu) == null) continue;
    codes.add(code);
  }
  return [...codes].sort();
}

export function defaultTargetAtc(current: number, workbook: number | null, feasible: number): number {
  void workbook;
  void feasible;
  return Math.round(current * 100) / 100;
}

export function buildTargetScenario(
  rows: Record<string, unknown>[],
  opts: {
    asOf: string;
    format: string;
    scope: 'region' | 'division';
    parentCode: string;
    targetAtc?: number | null;
  }
): TargetScenario | null {
  const asOf = opts.asOf;
  const format = opts.format;
  const parentCode = opts.parentCode;
  if (!asOf || !parentCode) return null;

  const parentSeries = officeSeries(rows, parentCode, format);
  let parentSnap = findSnap(parentSeries, asOf) || latestAtOrBefore(parentSeries, asOf);
  if (!parentSnap) return null;
  const marPeriod = lastMarchPeriod(parentSnap.period);
  const prevPeriod = prevMonthPeriod(parentSnap.period);
  parentSnap = withHistory(parentSnap, parentSeries, rows, format, marPeriod, prevPeriod);

  const fy = forecastInputFy(parentSeries, asOf, parentSnap.input);
  const childCodes = listChildCodes(rows, format, parentSnap.period, opts.scope, parentCode);
  const childPacks = childCodes
    .map((code) => {
      const series = officeSeries(rows, code, format);
      let snap = findSnap(series, parentSnap.period) || latestAtOrBefore(series, parentSnap.period);
      if (!snap) return null;
      snap = withHistory(snap, series, rows, format, marPeriod, prevPeriod);
      const f = forecastInputFy(series, asOf, snap.input);
      return { snap, inputFy: f.inputFy, series };
    })
    .filter((x): x is { snap: Snap; inputFy: number; series: Snap[] } => x != null);

  const packsForAlloc = childPacks.length
    ? childPacks
    : [{ snap: parentSnap, inputFy: fy.inputFy, series: parentSeries }];

  const floorsProbe = packsForAlloc.map((c) => officeFloor(c.series, c.snap.atc, c.snap.td));
  const cap = packsForAlloc.reduce((s, c, i) => s + c.inputFy * (1 - floorsProbe[i].floorAtc / 100), 0);
  const feasibleAtc =
    fy.inputFy > 0 ? Math.max(STRUCTURAL_ATC, ((fy.inputFy - cap) / fy.inputFy) * 100) : STRUCTURAL_ATC;
  const workbook = parentSnap.targetAtc;
  const horizon = fyHorizon(asOf);
  const predictedAtc = forecastAtcAtHorizon(
    parentSnap.atcMar,
    parentSnap.atc,
    parentSnap.period,
    horizon,
    marPeriod
  );
  const target =
    opts.targetAtc != null && Number.isFinite(opts.targetAtc)
      ? opts.targetAtc
      : predictedAtc;

  const built = applyTargetToChildren(parentSnap, fy.inputFy, packsForAlloc, target);
  const children = childPacks.length ? built.children : [];

  const nested: Record<string, TargetOffice[]> = {};
  if (opts.scope === 'region') {
    for (const pack of childPacks) {
      const divRow = built.children.find((c) => c.office_code === pack.snap.office_code);
      if (!divRow) continue;
      const cccCodes = listChildCodes(rows, format, parentSnap.period, 'division', pack.snap.office_code);
      const cccPacks = cccCodes
        .map((code) => {
          const series = officeSeries(rows, code, format);
          let snap = findSnap(series, parentSnap.period) || latestAtOrBefore(series, parentSnap.period);
          if (!snap) return null;
          snap = withHistory(snap, series, rows, format, marPeriod, prevPeriod);
          const f = forecastInputFy(series, asOf, snap.input);
          return { snap, inputFy: f.inputFy, series };
        })
        .filter((x): x is { snap: Snap; inputFy: number; series: Snap[] } => x != null);
      if (!cccPacks.length) continue;
      const sub = applyTargetToChildren(pack.snap, divRow.inputFy, cccPacks, divRow.atcNew);
      nested[pack.snap.office_code] = sub.children;
    }
  }

  return {
    asOf: parentSnap.period,
    horizon,
    fyLabel: fyLabel(asOf),
    elapsedMonths: fyMonthIndex(asOf) + 1,
    remainingMonths: Math.max(0, 12 - (fyMonthIndex(asOf) + 1)),
    yoyInputPct: fy.yoy,
    inputMethod: fy.method,
    parent: built.parent,
    children,
    nested,
    feasible: built.feasible,
    feasibleAtc: built.feasibleAtc,
    targetAtc: target,
    currentAtc: parentSnap.atc,
    workbookTarget: workbook,
    lastMarch: marPeriod,
    lastMonth: prevPeriod,
    predictedAtc,
    increments: fy.increments,
  };
}
