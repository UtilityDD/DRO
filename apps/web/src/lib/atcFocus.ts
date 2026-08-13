/**
 * AT&C Analytic — volume-first weakness ranking with explainable logic.
 *
 * Energy chain (YTD cumulative MU to reporting month):
 *   Input       = energy supplied into the area
 *   Demand      = energy billed
 *   Collection  = energy (MU equivalent) realized through billing
 *
 *   Unbilled MU     = Input − Demand      → not billed (most serious volume loss)
 *   Outstanding MU  = Demand − Collection → billed but not realized
 *   ATC gap MU      = Input − Collection  → combined AT&C volume
 *   T&D %           = Unbilled / Input
 *   ATC %           = ATC gap / Input
 *   Coll.eff %      = Collection / Demand
 *
 * Rule: rank DRO action by absolute MU first; use % for intensity; use MoM for early warning.
 */

export type FocusRow = {
  office_code: string;
  office_name: string;
  office_type: string;
  division_code: string;
  period_label: string;
  input: number;
  demand: number | null;
  collection: number | null;
  unbilled: number | null;
  outstanding: number | null;
  atcGap: number | null;
  tdPct: number | null;
  atcPct: number | null;
  collEff: number | null;
  dUnbilled: number | null;
  dOutstanding: number | null;
  dCollEff: number | null;
  dAtcPct: number | null;
  focusScore: number;
};

export type AnalyticTone = 'critical' | 'warn' | 'watch' | 'info' | 'ok';

export type FocusLens =
  | 'composite'
  | 'unbilled'
  | 'outstanding'
  | 'atc_gap'
  | 'atc_pct'
  | 'widen_unbilled'
  | 'coll_eff_drop';

export type AnalyticTopic = {
  id: FocusLens;
  label: string;
  short: string;
  formula: string;
  logic: string;
  action: string;
  tone: AnalyticTone;
};

/** Topic buttons shown in Analytic tab — each has explicit logic + field action. */
export const ANALYTIC_TOPICS: AnalyticTopic[] = [
  {
    id: 'composite',
    label: 'Priority score',
    short: 'Overall',
    formula: '0.45·Unbilled + 0.35·Outstanding + 0.1·ATC gap + 0.8·ΔUnbilled↑ + 0.6·|ΔColl.eff↓|',
    logic:
      'Single action list. Weights absolute MU gaps higher than percentages, and adds MoM deterioration so a slipping office rises even if its % is mid-pack.',
    action: 'Start weekly review from the top 3–5 offices on this list.',
    tone: 'critical',
  },
  {
    id: 'unbilled',
    label: 'Unbilled energy',
    short: 'Unbilled',
    formula: 'Unbilled MU = Input − Demand · T&D% = Unbilled / Input',
    logic:
      'Energy put into the area that was never billed. Covers theft, defective meters, unmetered / unbilled consumers, and feeder–billing mismatch. This is the most serious technical–commercial volume loss.',
    action: 'Metering audit, DT/feeder loss, defective & unbilled consumer drive.',
    tone: 'critical',
  },
  {
    id: 'outstanding',
    label: 'Outstanding dues',
    short: 'Outstanding',
    formula: 'Outstanding MU = Demand − Collection · Coll.eff = Collection / Demand',
    logic:
      'Energy that was billed but not realized. Collection / arrears problem — T&D works will not close this gap.',
    action: 'Collection camps, disconnection for default, arrears recovery.',
    tone: 'warn',
  },
  {
    id: 'atc_gap',
    label: 'ATC gap (MU)',
    short: 'ATC gap',
    formula: 'ATC gap MU = Input − Collection · ATC% = ATC gap / Input',
    logic:
      'Combined volume impact on AT&C. Always split into Unbilled + Outstanding before choosing the field job.',
    action: 'Open the office, then pick Unbilled vs Outstanding lens for the right team.',
    tone: 'warn',
  },
  {
    id: 'atc_pct',
    label: 'High ATC %',
    short: 'ATC %',
    formula: 'ATC% = (Input − Collection) / Input',
    logic:
      'Shows intensity, not regional impact. A small CCC can look “worst” on % while losing little MU. Always read Input and ATC gap MU beside the %.',
    action: 'Use for intensity watch-list; confirm with Unbilled / ATC gap MU before deploying crews.',
    tone: 'watch',
  },
  {
    id: 'widen_unbilled',
    label: 'Widening unbilled',
    short: 'Δ Unbilled',
    formula: 'Δ Unbilled = Unbilled(this month) − Unbilled(previous month)',
    logic:
      'On cumulative YTD figures, a rising unbilled stock means the month’s billing lagged input — early warning of metering / billing slip.',
    action: 'Immediate billing & meter check; do not wait for year-end %.',
    tone: 'watch',
  },
  {
    id: 'coll_eff_drop',
    label: 'Collection slip',
    short: 'Δ Coll.eff',
    formula: 'Δ Coll.eff = Coll.eff(this month) − Coll.eff(previous month)',
    logic:
      'Falling collection efficiency vs prior month signals realization weakening even if cumulative collection still rises.',
    action: 'Collection reinforcement; cross-check Outstanding MU rank.',
    tone: 'watch',
  },
];

/** @deprecated use ANALYTIC_TOPICS */
export const FOCUS_LENSES = ANALYTIC_TOPICS.map((t) => ({
  id: t.id,
  label: t.label,
  blurb: t.logic,
}));

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function asPct(v: number | null): number | null {
  if (v == null) return null;
  return Math.abs(v) <= 1.5 ? v * 100 : v;
}

export function focusScore(r: {
  unbilled: number | null;
  outstanding: number | null;
  atcGap: number | null;
  dUnbilled: number | null;
  dCollEff: number | null;
}): number {
  const u = Math.max(0, r.unbilled || 0);
  const o = Math.max(0, r.outstanding || 0);
  const g = Math.max(0, r.atcGap || 0);
  const du = Math.max(0, r.dUnbilled || 0);
  const dce = Math.max(0, -(r.dCollEff || 0));
  return u * 0.45 + o * 0.35 + g * 0.1 + du * 0.8 + dce * 0.6;
}

export function buildFocusRows(
  rows: Record<string, unknown>[],
  opts: {
    period: string;
    prevPeriod?: string;
    level: string;
    format: string;
  }
): FocusRow[] {
  const fmt = opts.format.toUpperCase();
  const periodRows = rows.filter(
    (r) =>
      String(r.period_label) === opts.period &&
      String(r.office_type) === opts.level &&
      String(r.source_format || 'IA').toUpperCase() === fmt
  );
  const prevByCode = new Map<string, Record<string, unknown>>();
  if (opts.prevPeriod) {
    for (const r of rows) {
      if (
        String(r.period_label) === opts.prevPeriod &&
        String(r.office_type) === opts.level &&
        String(r.source_format || 'IA').toUpperCase() === fmt
      ) {
        prevByCode.set(String(r.office_code), r);
      }
    }
  }

  const out: FocusRow[] = [];
  for (const r of periodRows) {
    const input = num(r.input_mu);
    if (input == null || input <= 0) continue;
    const demand = num(r.demand_mu);
    const collection = num(r.collection_mu);
    const unbilled = demand == null ? null : input - demand;
    const outstanding = demand != null && collection != null ? demand - collection : null;
    const atcGap = collection == null ? null : input - collection;
    const tdPct = unbilled != null ? (unbilled / input) * 100 : asPct(num(r.dist_loss));
    const atcPct = atcGap != null ? (atcGap / input) * 100 : asPct(num(r.atc_loss));
    const collEff =
      demand != null && demand > 0 && collection != null
        ? (collection / demand) * 100
        : asPct(num(r.coll_eff));

    const prev = prevByCode.get(String(r.office_code));
    let dUnbilled: number | null = null;
    let dOutstanding: number | null = null;
    let dCollEff: number | null = null;
    let dAtcPct: number | null = null;
    if (prev) {
      const pIn = num(prev.input_mu);
      const pDem = num(prev.demand_mu);
      const pCol = num(prev.collection_mu);
      if (pIn != null && pIn > 0) {
        const pUnb = pDem == null ? null : pIn - pDem;
        const pOut = pDem != null && pCol != null ? pDem - pCol : null;
        const pAtc = pCol == null ? null : ((pIn - pCol) / pIn) * 100;
        const pCe =
          pDem != null && pDem > 0 && pCol != null ? (pCol / pDem) * 100 : asPct(num(prev.coll_eff));
        if (unbilled != null && pUnb != null) dUnbilled = unbilled - pUnb;
        if (outstanding != null && pOut != null) dOutstanding = outstanding - pOut;
        if (collEff != null && pCe != null) dCollEff = collEff - pCe;
        if (atcPct != null && pAtc != null) dAtcPct = atcPct - pAtc;
      }
    }

    const row: FocusRow = {
      office_code: String(r.office_code),
      office_name: String(r.office_name || r.office_code),
      office_type: String(r.office_type),
      division_code: String(
        r.division_code ||
          (String(r.office_code).length >= 4 ? String(r.office_code).slice(0, 4) : r.office_code)
      ),
      period_label: opts.period,
      input,
      demand,
      collection,
      unbilled,
      outstanding,
      atcGap,
      tdPct,
      atcPct,
      collEff,
      dUnbilled,
      dOutstanding,
      dCollEff,
      dAtcPct,
      focusScore: 0,
    };
    row.focusScore = focusScore(row);
    out.push(row);
  }
  return out;
}

export function metricForLens(r: FocusRow, lens: FocusLens): number | null {
  switch (lens) {
    case 'composite':
      return r.focusScore;
    case 'unbilled':
      return r.unbilled;
    case 'outstanding':
      return r.outstanding;
    case 'atc_gap':
      return r.atcGap;
    case 'atc_pct':
      return r.atcPct;
    case 'widen_unbilled':
      return r.dUnbilled;
    case 'coll_eff_drop':
      return r.dCollEff;
    default:
      return r.focusScore;
  }
}

export function formatMetric(lens: FocusLens, v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  if (lens === 'atc_pct' || lens === 'coll_eff_drop') {
    const sign = lens === 'coll_eff_drop' && v > 0 ? '+' : '';
    return `${sign}${v.toFixed(2)}%`;
  }
  if (lens === 'composite') return v.toFixed(2);
  const sign = lens === 'widen_unbilled' && v > 0 ? '+' : '';
  return `${sign}${v.toFixed(2)} MU`;
}

export function rankFocus(rows: FocusRow[], lens: FocusLens, limit = 12): FocusRow[] {
  const asc = lens === 'coll_eff_drop';
  return [...rows]
    .filter((r) => metricForLens(r, lens) != null)
    .filter((r) => {
      if (lens === 'widen_unbilled') return (r.dUnbilled || 0) > 0.01;
      if (lens === 'coll_eff_drop') return (r.dCollEff || 0) < -0.01;
      if (lens === 'outstanding') return (r.outstanding || 0) > 0.01;
      return true;
    })
    .sort((a, b) => {
      const av = metricForLens(a, lens) ?? 0;
      const bv = metricForLens(b, lens) ?? 0;
      return asc ? av - bv : bv - av;
    })
    .slice(0, limit);
}

/** Row severity for colour coding within the active topic. */
export function rowTone(rank: number, lens: FocusLens, r: FocusRow): AnalyticTone {
  if (lens === 'atc_pct') {
    const input = r.input || 0;
    const gap = r.atcGap || 0;
    if (input < 15 && (r.atcPct || 0) > 12) return 'watch'; // % trap — small office
    if (gap >= 5 || (r.atcPct || 0) >= 12) return 'warn';
    return 'info';
  }
  if (lens === 'widen_unbilled' || lens === 'coll_eff_drop') {
    if (rank <= 2) return 'critical';
    if (rank <= 5) return 'warn';
    return 'watch';
  }
  if (rank === 1) return 'critical';
  if (rank <= 3) return 'warn';
  if (rank <= 6) return 'watch';
  return 'info';
}

/** Plain-language reason for why this office appears on the topic list. */
export function explainReason(lens: FocusLens, r: FocusRow, rank: number): string {
  const unb = formatMu(r.unbilled);
  const out = formatMu(r.outstanding);
  const gap = formatMu(r.atcGap);
  const inp = formatMu(r.input);
  const atc = formatPct(r.atcPct);
  const td = formatPct(r.tdPct);
  const ce = formatPct(r.collEff);

  switch (lens) {
    case 'composite':
      return `Rank #${rank} on priority score ${r.focusScore.toFixed(2)} — unbilled ${unb} MU, outstanding ${out} MU, ATC gap ${gap} MU (Input ${inp}).`;
    case 'unbilled':
      return `${unb} MU not billed (T&D ${td}). Input ${inp} MU vs Demand ${formatMu(r.demand)} MU — technical / billing leakage volume.`;
    case 'outstanding':
      return `${out} MU billed but unrealized (Coll.eff ${ce}). Demand ${formatMu(r.demand)} vs Collection ${formatMu(r.collection)} — collection drive.`;
    case 'atc_gap':
      return `ATC gap ${gap} MU = unbilled ${unb} + outstanding ${out} (ATC ${atc}). Split teams: metering vs collection.`;
    case 'atc_pct': {
      const trap = r.input < 15 ? ' Small Input — % can overstate regional impact.' : '';
      return `ATC ${atc} on Input ${inp} MU (gap only ${gap} MU).${trap}`;
    }
    case 'widen_unbilled':
      return `Unbilled rose ${formatMu(r.dUnbilled)} MU vs prior month (now ${unb} MU). Billing lagged input this period.`;
    case 'coll_eff_drop':
      return `Coll.eff moved ${formatMetric('coll_eff_drop', r.dCollEff)} to ${ce}. Outstanding now ${out} MU — realization softening.`;
    default:
      return '';
  }
}

export function formatMu(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}

export function formatPct(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v.toFixed(digits)}%`;
}
