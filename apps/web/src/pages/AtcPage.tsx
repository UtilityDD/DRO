import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, canEdit } from '../api';
import {
  ANALYTIC_TOPICS,
  buildFocusRows,
  explainReason,
  formatMetric,
  formatMu,
  formatPct,
  metricForLens,
  rankFocus,
  rowTone,
  type FocusLens,
} from '../lib/atcFocus';
import { useAuth } from '../auth';

/** Shared plot area height inside the equal workspace panels */
const CHART_HEIGHT = '100%';

/** Max series with on-chart pills before also showing a latest-value strip */
const LABEL_SERIES_CAP = 5;
/** Max compare bars that get value labels on top */
const LABEL_BAR_CAP = 8;

type LabelProps = {
  x?: number | string;
  y?: number | string;
  value?: number | string | null;
  index?: number;
};

function formatLabel(v: unknown, kind: 'pct' | 'mu' | 'count') {
  const n = toNum(v);
  if (n == null) return '';
  if (kind === 'pct') return `${n.toFixed(2)}%`;
  if (kind === 'mu') return n.toFixed(2);
  return String(Math.round(n));
}

function periodMonthAbbr(period: string): string {
  const m = String(period || '').match(/^([A-Za-z]{3})'/);
  if (!m) return '';
  return m[1].charAt(0).toUpperCase() + m[1].slice(1, 3).toLowerCase();
}

/** Compact chip text: May'26 → May26 */
function shortPeriodLabel(period: string): string {
  return String(period || '').replace("'", '');
}

const MONTH_FY_ORDER: Record<string, number> = {
  Apr: 1,
  May: 2,
  Jun: 3,
  Jul: 4,
  Aug: 5,
  Sep: 6,
  Oct: 7,
  Nov: 8,
  Dec: 9,
  Jan: 10,
  Feb: 11,
  Mar: 12,
};

/** Indian FY Apr–Mar label for a period like May'26 → FY26 */
function fiscalYearKey(period: string): string {
  const m = String(period || '').match(/^([A-Za-z]{3})'(\d{2})$/);
  if (!m) return 'Other';
  const mon = m[1].charAt(0).toUpperCase() + m[1].slice(1, 3).toLowerCase();
  const yy = Number(m[2]);
  if (!Number.isFinite(yy)) return 'Other';
  // Jan–Mar belong to FY ending that year; Apr–Dec to FY ending next year
  const endYy = MONTH_FY_ORDER[mon] >= 10 ? yy : yy + 1;
  const startYy = endYy - 1;
  return `FY${String(startYy).padStart(2, '0')}-${String(endYy).padStart(2, '0')}`;
}

function groupPeriodsByFy(periods: string[]): Array<{ fy: string; months: string[] }> {
  const map = new Map<string, string[]>();
  for (const p of periods) {
    const fy = fiscalYearKey(p);
    if (!map.has(fy)) map.set(fy, []);
    map.get(fy)!.push(p);
  }
  return [...map.entries()].map(([fy, months]) => ({ fy, months }));
}

/** March FY points + latest month + same calendar month in prior years */
function buildMilestonePeriods(periods: string[]): Set<string> {
  const set = new Set<string>();
  if (!periods.length) return set;
  const latest = periods[periods.length - 1];
  const latestMon = periodMonthAbbr(latest);
  for (const p of periods) {
    const mon = periodMonthAbbr(p);
    if (mon === 'Mar') set.add(p);
    if (latestMon && mon === latestMon) set.add(p);
  }
  set.add(latest);
  return set;
}

/** Pill labels on milestone months (Mar, latest, YoY same month) and series endpoint */
function MilestoneLabel({
  x,
  y,
  value,
  index,
  periods,
  milestones,
  lastIndex,
  color,
  kind,
  stagger = 0,
}: LabelProps & {
  periods: string[];
  milestones: Set<string>;
  lastIndex: number;
  color: string;
  kind: 'pct' | 'mu' | 'count';
  stagger?: number;
}) {
  const period = periods[index ?? -1] || '';
  const isMilestone = Boolean(period && milestones.has(period)) || index === lastIndex;
  if (!isMilestone || value == null || value === '') return null;
  const cx = Number(x);
  const cy = Number(y);
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  const text = formatLabel(value, kind);
  if (!text) return null;
  const w = Math.max(36, text.length * 7 + 14);
  const h = 18;
  const ox = cx - w / 2;
  const oy = cy - 28 - stagger * 14;
  return (
    <g className="atc-datalabel">
      <rect x={ox} y={oy} width={w} height={h} rx={9} fill="var(--chart-tooltip-bg)" stroke={color} strokeWidth={1.25} />
      <text
        x={cx}
        y={oy + h / 2 + 0.5}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="var(--chart-tooltip-text)"
        fontSize={10}
        fontWeight={650}
      >
        {text}
      </text>
    </g>
  );
}

/** Target stroke — distinct from teal/blue/violet series colors */
const TARGET_COLOR = '#ff8fab';

function useDesktopChart() {
  return useSyncExternalStore(
    (onStoreChange) => {
      const mq = window.matchMedia('(min-width: 961px)');
      mq.addEventListener('change', onStoreChange);
      return () => mq.removeEventListener('change', onStoreChange);
    },
    () => window.matchMedia('(min-width: 961px)').matches,
    () => true
  );
}

function formatDelta(delta: number, kind: 'pct' | 'mu' | 'count') {
  const sign = delta > 0 ? '+' : '';
  if (kind === 'pct') return `${sign}${delta.toFixed(2)} pp`;
  if (kind === 'mu') return `${sign}${delta.toFixed(2)}`;
  return `${sign}${Math.round(delta)}`;
}

function BarValueLabel(props: {
  x?: number | string;
  y?: number | string;
  width?: number | string;
  height?: number | string;
  value?: number | string | null;
  index?: number;
  kind: 'pct' | 'mu' | 'count';
  show: boolean;
  inside: boolean;
  deltas?: Array<number | null | undefined>;
  showDelta: boolean;
}) {
  const { x, y, width, height, value, index, kind, show, inside, deltas, showDelta } = props;
  if (!show || value == null || value === '') return null;
  const text = formatLabel(value, kind);
  if (!text) return null;
  const w = Number(width || 0);
  const h = Number(height || 0);
  const cx = Number(x) + w / 2;
  const top = Number(y);
  if (!Number.isFinite(cx) || !Number.isFinite(top)) return null;

  const deltaRaw = showDelta && index != null && deltas ? deltas[index] : null;
  const deltaText =
    deltaRaw != null && Number.isFinite(deltaRaw) ? formatDelta(deltaRaw, kind) : '';

  const canFitInside = inside && h >= (deltaText ? 44 : 28) && w >= 28;
  const fontSize = canFitInside ? (w < 48 ? 12 : 15) : 10;
  const deltaSize = canFitInside ? (w < 48 ? 10 : 12) : 9;
  const fill = canFitInside ? '#ffffff' : '#334155';
  const deltaFill =
    deltaRaw == null
      ? fill
      : canFitInside
        ? deltaRaw > 0
          ? '#7f1d1d'
          : deltaRaw < 0
            ? '#14532d'
            : fill
        : deltaRaw > 0
          ? '#dc2626'
          : deltaRaw < 0
            ? '#059669'
            : fill;

  const cy = canFitInside
    ? top + h / 2 - (deltaText ? 7 : 0)
    : top - (deltaText ? 18 : 8);
  const dy = canFitInside ? cy + 14 : top - 4;

  return (
    <g className="atc-bar-label">
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={fill}
        fontSize={fontSize}
        fontWeight={750}
      >
        {text}
      </text>
      {deltaText ? (
        <text
          x={cx}
          y={dy}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={deltaFill}
          fontSize={deltaSize}
          fontWeight={650}
        >
          {deltaText}
        </text>
      ) : null}
    </g>
  );
}

/** Target value pill on compare bar charts */
function TargetPointLabel(props: {
  x?: number | string;
  y?: number | string;
  value?: number | string | null;
  kind: 'pct' | 'mu' | 'count';
  show: boolean;
}) {
  const { x, y, value, kind, show } = props;
  if (!show || value == null || value === '') return null;
  const text = formatLabel(value, kind);
  if (!text) return null;
  const cx = Number(x);
  const cy = Number(y);
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  const w = Math.max(34, text.length * 6.6 + 12);
  const h = 17;
  const ox = cx - w / 2;
  const oy = cy - 22;
  return (
    <g className="atc-target-label">
      <rect
        x={ox}
        y={oy}
        width={w}
        height={h}
        rx={8}
        fill="#ffffff"
        stroke={TARGET_COLOR}
        strokeWidth={1.25}
      />
      <text
        x={cx}
        y={oy + h / 2 + 0.5}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={TARGET_COLOR}
        fontSize={10}
        fontWeight={750}
      >
        {text}
      </text>
    </g>
  );
}

const MU_BAR_COLORS = {
  input: '#1a73e8',
  demand: '#00bcd4',
  collection: '#7c4dff',
};

/** Value labels on I·D·C grouped bars */
function MuGroupBarLabel(props: {
  x?: number | string;
  y?: number | string;
  width?: number | string;
  value?: number | string | null;
  show: boolean;
  inside?: boolean;
}) {
  const { x, y, width, value, show, inside } = props;
  if (!show || value == null || value === '') return null;
  const text = formatLabel(value, 'mu');
  if (!text) return null;
  const w = Number(width || 0);
  const cx = Number(x) + w / 2;
  const top = Number(y);
  if (!Number.isFinite(cx) || !Number.isFinite(top)) return null;
  const canInside = Boolean(inside) && w >= 22;
  return (
    <text
      x={cx}
      y={canInside ? top + 14 : top - 6}
      textAnchor="middle"
      dominantBaseline="middle"
      fill={canInside ? '#ffffff' : '#334155'}
      fontSize={canInside && w >= 36 ? 12 : 10}
      fontWeight={750}
    >
      {text}
    </text>
  );
}

type AtcRow = Record<string, unknown>;
type Level = 'ccc' | 'division' | 'region';

type ParamDef = {
  id: string;
  label: string;
  short: string;
  field: string;
  kind: 'pct' | 'mu' | 'count';
  targetField?: string;
  color?: string;
};

const PARAMS: ParamDef[] = [
  { id: 'atc', label: 'AT&C loss', short: 'AT&C', field: 'atc_loss', kind: 'pct', targetField: 'target_atc' },
  { id: 'td', label: 'T&D / Distribution loss', short: 'T&D', field: 'dist_loss', kind: 'pct', targetField: 'target_dist' },
  { id: 'ce', label: 'Collection efficiency', short: 'Coll.eff', field: 'coll_eff', kind: 'pct' },
  // MU fields exist only on the workbook "achievement" month (not May'25 / Mar'26 header cols)
  { id: 'input', label: 'Input (MU)', short: 'Input', field: 'input_mu', kind: 'mu' },
  { id: 'demand', label: 'Demand (MU)', short: 'Demand', field: 'demand_mu', kind: 'mu' },
  { id: 'coll', label: 'Collection (MU)', short: 'Coll.', field: 'collection_mu', kind: 'mu' },
];

/** One-office compare: AT&C vs T&D */
const LOSS_METRICS: ParamDef[] = [
  { id: 'atc', label: 'AT&C loss', short: 'AT&C', field: 'atc_loss', kind: 'pct', targetField: 'target_atc', color: '#1a73e8' },
  { id: 'td', label: 'T&D loss', short: 'T&D', field: 'dist_loss', kind: 'pct', targetField: 'target_dist', color: '#60a5fa' },
];

type CompareBy = 'units' | 'losses' | 'energy';

const LINE_COLORS = [
  '#1a73e8',
  '#00bcd4',
  '#7c4dff',
  '#ef5350',
  '#26a69a',
  '#fb8c00',
  '#ec407a',
  '#42a5f5',
  '#ab47bc',
  '#26c6da',
];

const CHART_TOOLTIP = {
  contentStyle: {
    background: 'var(--chart-tooltip-bg)',
    border: '1px solid var(--chart-tooltip-border)',
    borderRadius: 12,
    color: 'var(--chart-tooltip-text)',
    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.18)',
  },
  labelStyle: { color: 'var(--chart-tooltip-text)', fontWeight: 600, marginBottom: 4 },
  itemStyle: { color: 'var(--chart-tooltip-text)', padding: '2px 0' },
  wrapperStyle: { outline: 'none' },
};

const TIP_WORSE = '#dc2626';
const TIP_BETTER = '#059669';
const TIP_FLAT = '#64748b';

/** Loss tooltip: value vs target with coloured above/below + delta */
function LossTargetTooltip(props: {
  active?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any[];
  label?: string | number;
  kind: 'pct' | 'mu' | 'count';
}) {
  const { active, payload, label, kind } = props;
  if (!active || !payload?.length) return null;
  const row = (payload.find((p) => p?.dataKey === 'value') || payload[0])?.payload as
    | {
        name?: string;
        value?: number | null;
        target?: number | null;
        delta?: number | null;
      }
    | undefined;
  if (!row) return null;

  const value = row.value != null ? Number(row.value) : null;
  const target = row.target != null ? Number(row.target) : null;
  const delta =
    row.delta != null && Number.isFinite(row.delta)
      ? Number(row.delta)
      : value != null && target != null
        ? value - target
        : null;

  const title = String(label || row.name || '');
  const valueText = value != null ? formatLabel(value, kind) : '—';
  const targetText = target != null ? formatLabel(target, kind) : '—';

  let status = '';
  let statusColor = TIP_FLAT;
  let deltaColor = TIP_FLAT;
  if (delta != null) {
    if (delta > 0.0005) {
      status = 'Higher than target';
      statusColor = TIP_WORSE;
      deltaColor = TIP_WORSE;
    } else if (delta < -0.0005) {
      status = 'Lower than target';
      statusColor = TIP_BETTER;
      deltaColor = TIP_BETTER;
    } else {
      status = 'On target';
      statusColor = TIP_FLAT;
      deltaColor = TIP_FLAT;
    }
  }

  return (
    <div className="atc-tip">
      <div className="atc-tip-title">{title}</div>
      <div className="atc-tip-row">
        <span>Actual</span>
        <strong>{valueText}</strong>
      </div>
      <div className="atc-tip-row">
        <span>FY target</span>
        <strong style={{ color: TARGET_COLOR }}>{targetText}</strong>
      </div>
      {delta != null && (
        <>
          <div className="atc-tip-row">
            <span>Delta</span>
            <strong style={{ color: deltaColor }}>{formatDelta(delta, kind)}</strong>
          </div>
          <div className="atc-tip-status" style={{ color: statusColor, borderColor: statusColor }}>
            {status}
          </div>
        </>
      )}
    </div>
  );
}

/** Avoid Number(null) === 0 — missing sheet cells must stay blank. */
function toNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function asPct(v: unknown) {
  const n = toNum(v);
  if (n == null) return null;
  return n <= 1.5 ? n * 100 : n;
}

function formatValue(v: unknown, kind: 'pct' | 'mu' | 'count') {
  const n = toNum(v);
  if (n == null) return '—';
  if (kind === 'pct') {
    const p = asPct(n);
    return p == null ? '—' : `${p.toFixed(2)}%`;
  }
  if (kind === 'mu') return n.toFixed(2);
  return Math.round(n).toLocaleString();
}

function chartValue(v: unknown, kind: 'pct' | 'mu' | 'count') {
  const n = toNum(v);
  if (n == null) return null;
  if (kind === 'pct') return asPct(n);
  return n;
}

/**
 * Zoom Y so small up/down moves are visible — do not pin the floor at 0.
 * Ticks snap to clean steps (0.25 / 0.50 / 1 … for %).
 */
function niceStep(span: number, kind: 'pct' | 'mu' | 'count'): number {
  const s = Math.max(Math.abs(span), kind === 'pct' ? 0.5 : 1);
  if (kind === 'pct') {
    if (s <= 2) return 0.25;
    if (s <= 5) return 0.5;
    if (s <= 10) return 1;
    if (s <= 20) return 2;
    if (s <= 50) return 5;
    return 10;
  }
  if (kind === 'count') return Math.max(1, Math.round(s / 5));
  const rough = s / 5;
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(rough, 1e-6))));
  const n = rough / pow;
  const f = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return f * pow;
}

function niceYAxis(
  values: Array<number | null | undefined>,
  kind: 'pct' | 'mu' | 'count' = 'pct'
): { domain: [number, number]; ticks: number[] } | undefined {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!nums.length) return undefined;
  const dataLo = Math.min(...nums);
  const dataHi = Math.max(...nums);
  let lo = dataLo;
  let hi = dataHi;
  if (lo === hi) {
    const pad = Math.max(Math.abs(lo) * 0.08, kind === 'pct' ? 0.5 : 1);
    lo -= pad;
    hi += pad;
  } else {
    const pad = (hi - lo) * 0.12;
    lo -= pad;
    hi += pad;
  }
  if (dataLo >= 0) lo = Math.max(0, lo);

  const step = niceStep(hi - lo, kind);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  if (dataLo >= 0) lo = Math.max(0, lo);
  if (hi <= lo) hi = lo + step;

  const ticks: number[] = [];
  for (let v = lo; v <= hi + step * 1e-6; v += step) {
    ticks.push(Number(v.toFixed(2)));
  }
  return {
    domain: [Number(lo.toFixed(2)), Number(hi.toFixed(2))],
    ticks,
  };
}

/** Y-axis tick labels always show exactly two decimal places. */
function yTick2(v: number | string) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : '';
}

function YAxisTick2({
  x,
  y,
  payload,
  unit = '',
}: {
  x?: number;
  y?: number;
  payload?: { value?: number | string };
  unit?: string;
}) {
  const n = Number(payload?.value);
  if (!Number.isFinite(n) || x == null || y == null) return null;
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fill="var(--chart-tick)" fontSize={12}>
      {n.toFixed(2)}
      {unit}
    </text>
  );
}

function shortLabel(name: string, max = 16) {
  const n = name.trim();
  return n.length <= max ? n : `${n.slice(0, Math.max(0, max - 1))}…`;
}

const MONTH_ORDER = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Next calendar month label after e.g. May'26 → Jun'26 */
function nextPeriodLabel(period: string): string {
  const m = String(period || '').match(/^([A-Za-z]+)'(\d{2})$/);
  if (!m) return '';
  const mon = m[1].charAt(0).toUpperCase() + m[1].slice(1, 3).toLowerCase();
  let y = Number(m[2]);
  const idx = MONTH_ORDER.findIndex((x) => x.toLowerCase() === mon.toLowerCase());
  if (idx < 0) return '';
  if (idx === 11) {
    y += 1;
    return `Jan'${String(y).padStart(2, '0')}`;
  }
  return `${MONTH_ORDER[idx + 1]}'${String(y).padStart(2, '0')}`;
}

/** Prefer full office names when few bars — especially 4 divisions on desktop */
function compareAxisLabel(name: string, barCount: number, desktop: boolean) {
  if (desktop && barCount > 0 && barCount <= 4) return name.trim();
  if (desktop && barCount <= 6) return shortLabel(name, 22);
  return shortLabel(name, 16);
}

function Seg<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; disabled?: boolean }[];
}) {
  return (
    <div className="seg" role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={o.disabled}
          className={`seg-item ${value === o.value ? 'on' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function AtcPage() {
  const { user } = useAuth();
  const desktopChart = useDesktopChart();
  const adminDefaultsApplied = useRef(false);
  const [rows, setRows] = useState<AtcRow[]>([]);
  const [periods, setPeriods] = useState<string[]>([]);
  const [format, setFormat] = useState<'IA' | 'IB'>('IA');
  const [mode, setMode] = useState<'trend' | 'compare'>('compare');
  const [compareBy, setCompareBy] = useState<CompareBy>('units');
  const [level, setLevel] = useState<Level>('division');
  const [division, setDivision] = useState('');
  const [asOf, setAsOf] = useState('');
  const [paramId, setParamId] = useState('atc');
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const [showTarget, setShowTarget] = useState(true);
  const [unitQuery, setUnitQuery] = useState('');
  const [unitsOpen, setUnitsOpen] = useState(true);
  const [panelTab, setPanelTab] = useState<'chart' | 'table' | 'analytic'>('chart');
  const [analyticTopic, setAnalyticTopic] = useState<FocusLens | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState('');
  const [editRow, setEditRow] = useState<AtcRow | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});

  const canEditAtc = canEdit(user, 'atc');

  // Admin landing view: Division · Compare · AT&C (all divisions selected via office effect)
  useEffect(() => {
    if (!user || adminDefaultsApplied.current) return;
    adminDefaultsApplied.current = true;
    if (user.role === 'admin') {
      setMode('compare');
      setCompareBy('units');
      setLevel('division');
      setDivision('');
      setParamId('atc');
      setShowTarget(true);
      setPanelTab('chart');
    } else if (user.role === 'ccc') {
      setMode('trend');
      setLevel('ccc');
      if (user.division_code) setDivision(String(user.division_code));
    } else if (user.role === 'division') {
      setMode('compare');
      setLevel('ccc');
      if (user.division_code) setDivision(String(user.division_code));
    } else {
      setMode('compare');
      setLevel('division');
    }
  }, [user]);

  // Keep division / CCC users locked to their office scope in the explorer
  const scopedDivision = user?.role === 'division' || user?.role === 'ccc' ? String(user.division_code || '') : '';
  const isDivisionScoped = Boolean(scopedDivision);
  const canPickRegion = user?.role === 'admin' || user?.role === 'region';
  const canPickAllDivisions = user?.role === 'admin' || user?.role === 'region';

  useEffect(() => {
    if (!isDivisionScoped) return;
    if (division !== scopedDivision) setDivision(scopedDivision);
    if (level === 'region') setLevel('ccc');
  }, [isDivisionScoped, scopedDivision, division, level]);

  const param = PARAMS.find((p) => p.id === paramId) || PARAMS[0];
  const isMetricCompare = mode === 'compare' && compareBy === 'losses';
  const isIdcCompare = mode === 'compare' && compareBy === 'energy';
  const metricGroup = compareBy === 'losses' ? LOSS_METRICS : null;
  const compareKind: 'pct' | 'mu' | 'count' = isMetricCompare ? 'pct' : isIdcCompare ? 'mu' : param.kind;

  useEffect(() => {
    setLoading(true);
    setError('');
    const q = new URLSearchParams();
    q.set('format', format);
    api
      .atcQuery(q.toString())
      .then((r) => {
        const list = (r.rows || []).filter(
          (row) => !format || String(row.source_format || 'IA').toUpperCase() === format
        );
        setRows(list);
        // Derive months from rows if API omits periods (stale server)
        const fromApi = r.periods || [];
        const fromRows = [
          ...new Set(list.map((row) => String(row.period_label || '')).filter(Boolean)),
        ];
        const ps = (fromApi.length ? fromApi : fromRows).sort((a, b) => {
          const ra = list.find((row) => row.period_label === a);
          const rb = list.find((row) => row.period_label === b);
          return String(ra?.period_sort || a).localeCompare(String(rb?.period_sort || b));
        });
        setPeriods(ps);
        setAsOf((prev) => {
          if (prev && ps.includes(prev)) return prev;
          return ps.length ? ps[ps.length - 1] : '';
        });
      })
      .catch((e) => {
        setRows([]);
        setPeriods([]);
        setError(e.message || 'Failed to load AT&C from Supabase');
      })
      .finally(() => setLoading(false));
  }, [format]);

  const openEditFor = (officeCode: string, periodLabel?: string) => {
    if (!canEditAtc || !officeCode) return;
    const period = periodLabel || asOf || periods[periods.length - 1] || '';
    const sameKey = (r: AtcRow) =>
      String(r.office_code) === officeCode &&
      String(r.period_label) === period &&
      String(r.source_format || 'IA').toUpperCase() === format;
    const row =
      rows.find((r) => sameKey(r) && r.office_type === level) ||
      rows.find((r) => sameKey(r));
    if (!row) {
      setError(`No ${format} row for ${officeCode} · ${period}`);
      return;
    }
    const fields = [
      'atc_loss',
      'dist_loss',
      'coll_eff',
      'target_atc',
      'target_dist',
      'input_mu',
      'demand_mu',
      'collection_mu',
    ];
    const form: Record<string, string> = {};
    for (const f of fields) {
      const v = toNum(row[f]);
      form[f] = v == null ? '' : String(v);
    }
    setEditRow(row);
    setEditForm(form);
    setEditError('');
    setError('');
    setEditOpen(true);
  };

  const officeCodeFromChartClick = (data: unknown): string => {
    if (!data || typeof data !== 'object') return '';
    const d = data as Record<string, unknown>;
    const payload = (d.payload && typeof d.payload === 'object' ? d.payload : d) as Record<
      string,
      unknown
    >;
    return String(payload.code || d.code || '');
  };

  const periodFromChartClick = (data: unknown): string => {
    if (!data || typeof data !== 'object') return '';
    const d = data as Record<string, unknown>;
    const payload = (d.payload && typeof d.payload === 'object' ? d.payload : d) as Record<
      string,
      unknown
    >;
    return String(payload.period || d.period || '');
  };

  const saveEdit = async () => {
    if (!editRow) return;
    setEditBusy(true);
    setEditError('');
    try {
      const patch: Record<string, number | null> = {};
      for (const [k, raw] of Object.entries(editForm)) {
        const t = raw.trim();
        patch[k] = t === '' ? null : Number(t);
        if (t !== '' && !Number.isFinite(patch[k] as number)) {
          throw new Error(`Invalid number for ${k}`);
        }
      }
      const res = await api.patchAtc({
        period_label: String(editRow.period_label),
        source_format: format,
        office_code: String(editRow.office_code),
        patch,
      });
      const updated = res.row || { ...editRow, ...patch };
      setRows((prev) =>
        prev.map((r) =>
          String(r.period_label) === String(editRow.period_label) &&
          String(r.office_code) === String(editRow.office_code) &&
          String(r.source_format || 'IA').toUpperCase() === format
            ? { ...r, ...updated }
            : r
        )
      );
      setEditOpen(false);
      setEditRow(null);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setEditBusy(false);
    }
  };

  useEffect(() => {
    if (format === 'IB' && level === 'ccc') setLevel('division');
  }, [format, level]);

  useEffect(() => {
    if (!rows.length) return;
    const hasLevel = rows.some((r) => r.office_type === level);
    if (hasLevel) return;
    if (rows.some((r) => r.office_type === 'division')) setLevel('division');
    else if (rows.some((r) => r.office_type === 'ccc')) setLevel('ccc');
    else if (rows.some((r) => r.office_type === 'region')) setLevel('region');
  }, [rows, level]);

  const sortedPeriods = useMemo(() => {
    return [...periods].sort((a, b) => {
      const ra = rows.find((r) => r.period_label === a);
      const rb = rows.find((r) => r.period_label === b);
      return String(ra?.period_sort || a).localeCompare(String(rb?.period_sort || b));
    });
  }, [periods, rows]);

  // MU metrics only exist on achievement months — jump Compare as-of to a month that has values
  useEffect(() => {
    if (mode !== 'compare' || !rows.length) return;
    const fields = isIdcCompare
      ? ['input_mu', 'demand_mu', 'collection_mu']
      : param.kind === 'mu'
        ? [param.field]
        : null;
    if (!fields) return;
    const hasMu = (p: string) =>
      rows.some((r) => r.period_label === p && fields.some((f) => toNum(r[f]) != null));
    if (asOf && hasMu(asOf)) return;
    const withData = [...sortedPeriods].reverse().find(hasMu);
    if (withData) setAsOf(withData);
  }, [paramId, param.kind, param.field, mode, isIdcCompare, rows, asOf, sortedPeriods]);

  const divisions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) {
      if (r.office_type === 'division') {
        map.set(String(r.office_code), String(r.office_name || r.office_code));
      } else if (r.division_code) {
        map.set(String(r.division_code), String(r.division_name || r.division_code));
      }
    }
    let list = [...map.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    if (isDivisionScoped) {
      list = list.filter(([code]) => code === scopedDivision);
    }
    return list;
  }, [rows, isDivisionScoped, scopedDivision]);

  const officeOptions = useMemo(() => {
    let list = rows.filter((r) => r.office_type === level);
    // Guard against bad parses (short codes / non-DRO) showing up in Units
    if (level === 'ccc') {
      list = list.filter((r) => /^341[2-5]\d{3}$/.test(String(r.office_code || '')));
    } else if (level === 'division') {
      list = list.filter((r) => /^341[2-5]$/.test(String(r.office_code || '')));
    } else if (level === 'region') {
      list = list.filter((r) => String(r.office_code) === '341');
    } else if (level === 'zone') {
      list = list.filter((r) => String(r.office_code) === '34');
    }
    const divFilter = isDivisionScoped ? scopedDivision : division;
    if (divFilter) {
      if (level === 'ccc') {
        list = list.filter(
          (r) =>
            String(r.division_code || '') === divFilter ||
            String(r.office_code || '').startsWith(divFilter)
        );
      } else if (level === 'division') {
        list = list.filter((r) => String(r.office_code) === divFilter);
      }
    }
    if (user?.role === 'ccc' && user.ccc_code && level === 'ccc') {
      list = list.filter((r) => String(r.office_code) === String(user.ccc_code));
    }
    if (level === 'region') {
      list = list.filter((r) => String(r.office_code) === '341' || /region/i.test(String(r.office_name)));
    }
    const map = new Map<string, string>();
    for (const r of list) map.set(String(r.office_code), String(r.office_name || r.office_code));
    return [...map.entries()]
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, level, division, isDivisionScoped, scopedDivision, user]);

  // Reset unit selection when hierarchy / basis changes (not on every officeOptions identity change)
  const officeKey = `${format}|${level}|${division}|${officeOptions.map((o) => o.code).join(',')}`;
  useEffect(() => {
    if (!officeOptions.length) {
      setSelectedCodes([]);
      return;
    }
    if (isMetricCompare) {
      setSelectedCodes((prev) => {
        const keep = prev.find((c) => officeOptions.some((o) => o.code === c));
        return [keep || officeOptions[0].code];
      });
    } else if (isIdcCompare || level === 'region' || level === 'division') {
      setSelectedCodes(officeOptions.map((o) => o.code));
    } else {
      setSelectedCodes(officeOptions.slice(0, Math.min(4, officeOptions.length)).map((o) => o.code));
    }
    setUnitQuery('');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- officeKey captures option codes
  }, [officeKey, isMetricCompare, isIdcCompare]);

  // Clamp to one office when switching into metric compare
  useEffect(() => {
    if (!isMetricCompare || !officeOptions.length) return;
    setSelectedCodes((prev) => {
      if (prev.length === 1 && officeOptions.some((o) => o.code === prev[0])) return prev;
      const keep = prev.find((c) => officeOptions.some((o) => o.code === c));
      return [keep || officeOptions[0].code];
    });
  }, [isMetricCompare]);

  const filteredOffices = useMemo(() => {
    const q = unitQuery.trim().toLowerCase();
    if (!q) return officeOptions;
    return officeOptions.filter(
      (o) => o.name.toLowerCase().includes(q) || o.code.includes(q)
    );
  }, [officeOptions, unitQuery]);

  const activeCodes = selectedCodes;
  const nameByCode = useMemo(() => {
    const m = new Map<string, string>();
    officeOptions.forEach((o) => m.set(o.code, o.name));
    return m;
  }, [officeOptions]);

  const colorByCode = useMemo(() => {
    const m = new Map<string, string>();
    activeCodes.forEach((c, i) => m.set(c, LINE_COLORS[i % LINE_COLORS.length]));
    return m;
  }, [activeCodes]);

  const trendData = useMemo(() => {
    if (!activeCodes.length) return [];

    const valueAt = (period: string, code: string) => {
      const row = rows.find(
        (r) =>
          String(r.office_code) === code &&
          r.period_label === period &&
          r.office_type === level
      );
      return row ? chartValue(row[param.field], param.kind) : null;
    };

    const periodHasPlot = (period: string) =>
      activeCodes.some((code) => {
        const v = valueAt(period, code);
        return typeof v === 'number' && Number.isFinite(v);
      });

    // Only months that actually have a plotted value — no leading/gap blanks
    const dataPeriods = sortedPeriods.filter(periodHasPlot);
    if (!dataPeriods.length) return [];

    const points = dataPeriods.map((p) => {
      const point: Record<string, string | number | null> = { period: p };
      for (const code of activeCodes) {
        point[`u_${code}`] = valueAt(p, code);
        if (showTarget && param.targetField) {
          const row = rows.find(
            (r) =>
              String(r.office_code) === code &&
              r.period_label === p &&
              r.office_type === level
          );
          point[`t_${code}`] = row ? chartValue(row[param.targetField], param.kind) : null;
        }
      }
      return point;
    });

    // Exactly one blank month after the last data month
    const next = nextPeriodLabel(String(points[points.length - 1].period || ''));
    if (next && next !== points[points.length - 1].period) {
      const blank: Record<string, string | number | null> = { period: next };
      for (const code of activeCodes) {
        blank[`u_${code}`] = null;
        if (showTarget && param.targetField) blank[`t_${code}`] = null;
      }
      points.push(blank);
    }
    return points;
  }, [rows, sortedPeriods, activeCodes, param, level, showTarget]);

  const compareData = useMemo(() => {
    const period = asOf || sortedPeriods[sortedPeriods.length - 1] || '';
    if (isMetricCompare && metricGroup) {
      const code = activeCodes[0];
      if (!code) return [];
      const row = rows.find(
        (r) => String(r.office_code) === code && r.period_label === period && r.office_type === level
      );
      return metricGroup.map((m) => {
        const value = row ? chartValue(row[m.field], m.kind) : null;
        const target =
          showTarget && m.targetField && row ? chartValue(row[m.targetField], m.kind) : null;
        let delta: number | null = null;
        if (value != null && target != null) delta = value - target;
        return {
          name: m.short,
          code: m.id,
          value,
          target,
          delta,
          fill: m.color || '#1a73e8',
        };
      });
    }
    return activeCodes.map((code) => {
      const row = rows.find(
        (r) => String(r.office_code) === code && r.period_label === period && r.office_type === level
      );
      const value = row ? chartValue(row[param.field], param.kind) : null;
      const target =
        showTarget && param.targetField && row
          ? chartValue(row[param.targetField], param.kind)
          : null;
      return {
        name: compareAxisLabel(nameByCode.get(code) || code, activeCodes.length, desktopChart),
        code,
        value,
        target,
        delta: value != null && target != null ? value - target : null,
        fill: colorByCode.get(code) || '#1a73e8',
      };
    });
  }, [
    rows,
    asOf,
    sortedPeriods,
    activeCodes,
    param,
    level,
    nameByCode,
    showTarget,
    isMetricCompare,
    metricGroup,
    colorByCode,
    desktopChart,
  ]);

  const muGroupedData = useMemo(() => {
    if (!isIdcCompare) return [];
    const period = asOf || sortedPeriods[sortedPeriods.length - 1] || '';
    return activeCodes.map((code) => {
      const row = rows.find(
        (r) => String(r.office_code) === code && r.period_label === period && r.office_type === level
      );
      return {
        name: compareAxisLabel(nameByCode.get(code) || code, activeCodes.length, desktopChart),
        code,
        input: row ? chartValue(row.input_mu, 'mu') : null,
        demand: row ? chartValue(row.demand_mu, 'mu') : null,
        collection: row ? chartValue(row.collection_mu, 'mu') : null,
      };
    });
  }, [
    isIdcCompare,
    asOf,
    sortedPeriods,
    activeCodes,
    rows,
    level,
    nameByCode,
    desktopChart,
  ]);

  const trendYAxis = useMemo(() => {
    const vals: Array<number | null> = [];
    for (const row of trendData) {
      for (const code of activeCodes) {
        vals.push(toNum(row[`u_${code}`]));
        if (showTarget) vals.push(toNum(row[`t_${code}`]));
      }
    }
    return niceYAxis(vals, param.kind);
  }, [trendData, activeCodes, showTarget, param.kind]);

  const compareYAxis = useMemo(() => {
    const vals: Array<number | null> = [];
    for (const d of compareData) {
      vals.push(toNum(d.value));
      vals.push(toNum(d.target));
    }
    return niceYAxis(vals, compareKind);
  }, [compareData, compareKind]);

  const muYAxis = useMemo(() => {
    const vals: Array<number | null> = [];
    for (const d of muGroupedData) {
      vals.push(toNum(d.input), toNum(d.demand), toNum(d.collection));
    }
    return niceYAxis(vals, 'mu');
  }, [muGroupedData]);

  const compareBarDeltas = useMemo(
    () => compareData.map((d) => d.delta),
    [compareData]
  );

  const compareDeltaStrip = useMemo(() => {
    if (mode !== 'compare') return [] as { label: string; text: string; tone: 'up' | 'down' | 'flat' }[];
    const period = asOf || sortedPeriods[sortedPeriods.length - 1] || '';

    if (compareBy === 'losses' && activeCodes[0]) {
      const row = rows.find(
        (r) =>
          String(r.office_code) === activeCodes[0] &&
          r.period_label === period &&
          r.office_type === level
      );
      if (!row) return [];
      const atc = chartValue(row.atc_loss, 'pct');
      const td = chartValue(row.dist_loss, 'pct');
      const items: { label: string; text: string; tone: 'up' | 'down' | 'flat' }[] = [];
      if (atc != null && td != null) {
        const d = atc - td;
        items.push({
          label: 'AT&C − T&D',
          text: formatDelta(d, 'pct'),
          tone: d > 0 ? 'up' : d < 0 ? 'down' : 'flat',
        });
      }
      if (showTarget) {
        const atcT = chartValue(row.target_atc, 'pct');
        const tdT = chartValue(row.target_dist, 'pct');
        if (atc != null && atcT != null) {
          const d = atc - atcT;
          items.push({
            label: 'AT&C vs tgt',
            text: formatDelta(d, 'pct'),
            tone: d > 0 ? 'up' : d < 0 ? 'down' : 'flat',
          });
        }
        if (td != null && tdT != null) {
          const d = td - tdT;
          items.push({
            label: 'T&D vs tgt',
            text: formatDelta(d, 'pct'),
            tone: d > 0 ? 'up' : d < 0 ? 'down' : 'flat',
          });
        }
      }
      return items;
    }

    if (compareBy === 'units' && showTarget && param.targetField) {
      const withDelta = compareData.filter((d) => d.delta != null) as Array<{
        name: string;
        delta: number;
      }>;
      if (!withDelta.length) return [];
      const worse = withDelta.filter((d) => d.delta > 0).length;
      const better = withDelta.filter((d) => d.delta < 0).length;
      return [
        {
          label: 'vs own tgt',
          text: `${better} below · ${worse} above`,
          tone: worse > better ? 'up' : better > worse ? 'down' : 'flat',
        },
      ];
    }

    return [];
  }, [
    mode,
    compareBy,
    activeCodes,
    rows,
    asOf,
    sortedPeriods,
    level,
    showTarget,
    param.targetField,
    compareData,
  ]);

  const tableRows = useMemo(() => {
    if (mode === 'compare') {
      const period = asOf || sortedPeriods[sortedPeriods.length - 1] || '';
      return rows
        .filter(
          (r) =>
            r.period_label === period &&
            r.office_type === level &&
            activeCodes.includes(String(r.office_code))
        )
        .sort((a, b) => String(a.office_name).localeCompare(String(b.office_name)));
    }
    return rows
      .filter((r) => r.office_type === level && activeCodes.includes(String(r.office_code)))
      .sort((a, b) => {
        const ps = String(a.period_sort || '').localeCompare(String(b.period_sort || ''));
        if (ps) return ps;
        return String(a.office_name).localeCompare(String(b.office_name));
      });
  }, [mode, rows, asOf, sortedPeriods, level, activeCodes]);

  const periodFyGroups = useMemo(() => groupPeriodsByFy(sortedPeriods), [sortedPeriods]);

  const focusPeriod = asOf || sortedPeriods[sortedPeriods.length - 1] || '';
  const focusPrevPeriod = useMemo(() => {
    const idx = sortedPeriods.indexOf(focusPeriod);
    return idx > 0 ? sortedPeriods[idx - 1] : '';
  }, [sortedPeriods, focusPeriod]);

  const focusRows = useMemo(() => {
    const allowed = new Set(officeOptions.map((o) => o.code));
    return buildFocusRows(rows, {
      period: focusPeriod,
      prevPeriod: focusPrevPeriod || undefined,
      level,
      format,
    }).filter((r) => allowed.has(r.office_code));
  }, [rows, focusPeriod, focusPrevPeriod, level, format, officeOptions]);

  const rankedFocus = useMemo(
    () => (analyticTopic ? rankFocus(focusRows, analyticTopic, 20) : []),
    [focusRows, analyticTopic]
  );
  const analyticMeta = ANALYTIC_TOPICS.find((t) => t.id === analyticTopic) || null;

  const selectFocusOffice = (code: string) => {
    setSelectedCodes([code]);
    setPanelTab('chart');
  };

  const toggleCode = (code: string) => {
    if (isMetricCompare) {
      setSelectedCodes([code]);
      return;
    }
    setSelectedCodes((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  };

  const selectAll = () => setSelectedCodes(officeOptions.map((o) => o.code));
  const selectNone = () => setSelectedCodes([]);

  const fmtTip = (v: number) =>
    compareKind === 'pct' ? `${Number(v).toFixed(2)}%` : Number(v).toFixed(2);

  const showLineLabels = mode === 'trend' && activeCodes.length > 0;
  const showBarLabels =
    mode === 'compare' &&
    !isIdcCompare &&
    (isMetricCompare || (activeCodes.length > 0 && activeCodes.length <= LABEL_BAR_CAP));
  const showBarDeltas =
    mode === 'compare' &&
    !isIdcCompare &&
    (compareBy === 'losses' ||
      (compareBy === 'units' && showTarget && Boolean(param.targetField)));

  const compareTitle = isIdcCompare
    ? 'Input, Demand & Collection'
    : isMetricCompare
      ? 'AT&C vs T&D'
      : param.label;

  const selectionLabel = useMemo(() => {
    if (!activeCodes.length) return level === 'ccc' ? 'CCC' : level === 'division' ? 'Division' : 'Region';
    if (activeCodes.length === 1) {
      return nameByCode.get(activeCodes[0]) || activeCodes[0];
    }
    if (activeCodes.length <= 3) {
      return activeCodes.map((c) => nameByCode.get(c) || c).join(', ');
    }
    const noun =
      level === 'ccc' ? 'CCCs' : level === 'division' ? 'divisions' : level === 'region' ? 'region' : 'units';
    return `${activeCodes.length} ${noun}`;
  }, [activeCodes, nameByCode, level]);

  const basisLabel = format === 'IA' ? 'Excl. Bulk' : 'Incl. Bulk';
  const periodSpan =
    sortedPeriods.length > 1
      ? `${sortedPeriods[0]}–${sortedPeriods[sortedPeriods.length - 1]}`
      : sortedPeriods[0] || '';

  const chartHeadline = useMemo(() => {
    if (mode === 'trend') {
      return [param.label, selectionLabel, periodSpan, basisLabel].filter(Boolean).join(' · ');
    }
    const asOfLabel = asOf || sortedPeriods[sortedPeriods.length - 1] || '';
    return [compareTitle, selectionLabel, asOfLabel, basisLabel].filter(Boolean).join(' · ');
  }, [
    mode,
    param.label,
    selectionLabel,
    periodSpan,
    basisLabel,
    compareTitle,
    asOf,
    sortedPeriods,
  ]);

  const wideCompareAxis =
    mode === 'compare' &&
    desktopChart &&
    activeCodes.length > 0 &&
    activeCodes.length <= 4;

  const lossTooltipActive =
    mode === 'compare' &&
    showTarget &&
    (compareBy === 'losses' ||
      (compareBy === 'units' && (param.id === 'atc' || param.id === 'td')));

  const showTargetControl =
    !isIdcCompare &&
    ((!isMetricCompare && Boolean(param.targetField)) ||
      (isMetricCompare && compareBy === 'losses'));

  const trendPeriods = useMemo(
    () => trendData.map((row) => String(row.period || '')),
    [trendData]
  );

  const milestonePeriods = useMemo(() => {
    // Ignore trailing blank pad month when choosing "latest" milestones
    const withData = trendData
      .filter((row) => activeCodes.some((code) => toNum(row[`u_${code}`]) != null))
      .map((row) => String(row.period || ''))
      .filter(Boolean);
    return buildMilestonePeriods(withData.length ? withData : trendPeriods.filter(Boolean));
  }, [trendData, activeCodes, trendPeriods]);

  /** Per-series last point with a value — always labeled even if before global latest */
  const lastIndexByCode = useMemo(() => {
    const map = new Map<string, number>();
    for (const code of activeCodes) {
      let last = -1;
      trendData.forEach((row, i) => {
        if (row[`u_${code}`] != null) last = i;
      });
      map.set(code, last);
    }
    return map;
  }, [activeCodes, trendData]);

  const latestStrip = useMemo(() => {
    if (mode !== 'trend' || !activeCodes.length || activeCodes.length <= LABEL_SERIES_CAP) return [];
    const lastPeriod = sortedPeriods[sortedPeriods.length - 1];
    return activeCodes.map((code) => {
      let value: number | null = null;
      let period = lastPeriod || '';
      for (let i = trendData.length - 1; i >= 0; i--) {
        const v = trendData[i][`u_${code}`];
        if (v != null) {
          value = Number(v);
          period = String(trendData[i].period || '');
          break;
        }
      }
      return {
        code,
        name: nameByCode.get(code) || code,
        color: colorByCode.get(code) || '#1a73e8',
        period,
        text: formatLabel(value, param.kind),
      };
    });
  }, [mode, activeCodes, sortedPeriods, trendData, nameByCode, colorByCode, param.kind]);

  const hasChart =
    (mode === 'trend' && trendData.length > 0 && activeCodes.length > 0) ||
    (mode === 'compare' &&
      activeCodes.length > 0 &&
      (isIdcCompare ? muGroupedData.length > 0 : compareData.length > 0));

  const startEditFlow = () => {
    if (!canEditAtc) return;
    if (activeCodes.length === 1) {
      openEditFor(activeCodes[0]);
      return;
    }
    setPanelTab('table');
  };

  return (
    <div className={`atc-page${canEditAtc ? ' atc-can-edit' : ''}`}>
      {error && <p className="error">{error}</p>}
      {canEditAtc && (
        <div className="atc-edit-bar">
          <span>Admin edit available — click a chart bar, or open Table → Edit.</span>
          <button type="button" className="btn atc-edit-toggle" onClick={startEditFlow}>
            Edit values
          </button>
        </div>
      )}

      <div className="atc-layout">
        <aside className="atc-controls panel">
          {canEditAtc && (
            <section className="atc-block">
              <button type="button" className="btn atc-edit-toggle atc-edit-sidebar" onClick={startEditFlow}>
                Edit AT&amp;C values
              </button>
            </section>
          )}
          <section className="atc-block">
            <div className="atc-label">View</div>
            <Seg
              value={mode}
              onChange={setMode}
              options={[
                { value: 'trend', label: 'Trend' },
                { value: 'compare', label: 'Compare' },
              ]}
            />
          </section>

          <section className="atc-block">
            <div className="atc-label">Basis</div>
            <Seg
              value={format}
              onChange={setFormat}
              options={[
                { value: 'IA', label: 'Excl. Bulk' },
                { value: 'IB', label: 'Incl. Bulk' },
              ]}
            />
          </section>

          <section className="atc-block">
            <div className="atc-label">Level</div>
            <Seg
              value={level}
              onChange={(v) => {
                setLevel(v);
                if (v === 'region') setDivision('');
              }}
              options={[
                { value: 'region', label: 'Region', disabled: !canPickRegion },
                { value: 'division', label: 'Div' },
                { value: 'ccc', label: 'CCC', disabled: format === 'IB' },
              ]}
            />
            {level !== 'region' && (
              <label className="atc-field">
                <select
                  value={isDivisionScoped ? scopedDivision : division}
                  onChange={(e) => {
                    if (isDivisionScoped) return;
                    setDivision(e.target.value);
                  }}
                  disabled={isDivisionScoped || !canPickAllDivisions}
                  aria-label="Division filter"
                >
                  {canPickAllDivisions && <option value="">All divisions</option>}
                  {divisions.map(([code, name]) => (
                    <option key={code} value={code}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </section>

          {mode === 'compare' && (
            <section className="atc-block">
              <div className="atc-label">Compare</div>
              <Seg
                value={compareBy}
                onChange={setCompareBy}
                options={[
                  { value: 'units', label: 'Offices' },
                  { value: 'losses', label: 'AT&C·T&D' },
                  { value: 'energy', label: 'I·D·C' },
                ]}
              />
            </section>
          )}

          {(mode === 'trend' || compareBy === 'units') && (
            <section className="atc-block">
              <div className="atc-label">Parameter</div>
              <div className="atc-param-grid">
                {PARAMS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`atc-param ${paramId === p.id ? 'on' : ''}`}
                    onClick={() => setParamId(p.id)}
                    title={p.label}
                  >
                    {p.short}
                  </button>
                ))}
              </div>
            </section>
          )}

          {mode === 'compare' && (
            <section className="atc-block">
              <div className="atc-label">
                Month
                {asOf ? <span className="atc-label-current">{asOf}</span> : null}
              </div>
              <div className="atc-month-panel">
                {periodFyGroups.map(({ fy, months }) => (
                  <div key={fy} className="atc-month-fy">
                    <div className="atc-month-fy-label">{fy}</div>
                    <div className="atc-month-grid">
                      {months.map((p) => (
                        <button
                          key={p}
                          type="button"
                          className={`atc-month ${asOf === p ? 'on' : ''}`}
                          onClick={() => setAsOf(p)}
                          title={p}
                          aria-label={p}
                          aria-pressed={asOf === p}
                        >
                          {shortPeriodLabel(p)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {!periodFyGroups.length && <p className="muted tight">No months</p>}
              </div>
            </section>
          )}

          {showTargetControl && (
            <section className="atc-block">
              <button
                type="button"
                className={`atc-switch ${showTarget ? 'on' : ''}`}
                onClick={() => setShowTarget((v) => !v)}
                aria-pressed={showTarget}
              >
                <span className="atc-switch-knob" />
                <span>FY target</span>
              </button>
            </section>
          )}

          <section className="atc-block atc-units">
            <div className="atc-units-head">
              <div className="atc-label" style={{ margin: 0 }}>
                {isMetricCompare ? 'Office' : 'Units'}{' '}
                <span className="atc-count">
                  {isMetricCompare
                    ? selectedCodes[0] || '—'
                    : `${selectedCodes.length}/${officeOptions.length}`}
                </span>
              </div>
              <button type="button" className="linkish" onClick={() => setUnitsOpen((v) => !v)}>
                {unitsOpen ? 'Hide' : 'Show'}
              </button>
            </div>

            {unitsOpen && (
              <div className="atc-units-body">
                <div className="atc-units-tools">
                  <input
                    type="search"
                    placeholder="Search unit…"
                    value={unitQuery}
                    onChange={(e) => setUnitQuery(e.target.value)}
                    aria-label="Search units"
                  />
                  {!isMetricCompare && (
                    <div className="atc-units-links">
                      <button type="button" className="linkish" onClick={selectAll}>
                        All
                      </button>
                      <button type="button" className="linkish" onClick={selectNone}>
                        None
                      </button>
                    </div>
                  )}
                </div>
                <div
                  className="atc-unit-list"
                  role="listbox"
                  aria-multiselectable={!isMetricCompare}
                >
                  {filteredOffices.map((o) => {
                    const on = selectedCodes.includes(o.code);
                    const color = isMetricCompare
                      ? on
                        ? '#1a73e8'
                        : undefined
                      : colorByCode.get(o.code);
                    return (
                      <label key={o.code} className={`atc-unit ${on ? 'on' : ''}`}>
                        <input
                          type={isMetricCompare ? 'radio' : 'checkbox'}
                          name={isMetricCompare ? 'atc-focus-office' : undefined}
                          checked={on}
                          onChange={() => toggleCode(o.code)}
                        />
                        <span
                          className="atc-unit-dot"
                          style={{ background: on && color ? color : 'transparent' }}
                        />
                        <span className="atc-unit-name">{o.name}</span>
                        <span className="atc-unit-code">{o.code}</span>
                      </label>
                    );
                  })}
                  {!filteredOffices.length && (
                    <p className="muted" style={{ padding: '0.5rem', margin: 0 }}>
                      No match
                    </p>
                  )}
                </div>
              </div>
            )}
          </section>
        </aside>

        <div className="atc-main">
          <div className="panel atc-result-panel">
            <div className="atc-result-head">
              <div className="atc-result-title">
                <h2>{panelTab === 'analytic' ? 'Weakness analytic' : chartHeadline}</h2>
              </div>
              <div className="atc-result-tools">
                {canEditAtc && panelTab !== 'analytic' && (
                  <button
                    type="button"
                    className="btn atc-edit-toggle"
                    disabled={!activeCodes.length}
                    onClick={startEditFlow}
                    title="Click a chart bar/point or a table Edit link to change values for the selected month"
                  >
                    Edit values
                  </button>
                )}
                <div className="atc-tabs" role="tablist" aria-label="Chart, table or analytic">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={panelTab === 'chart'}
                    className={`atc-tab ${panelTab === 'chart' ? 'on' : ''}`}
                    onClick={() => setPanelTab('chart')}
                  >
                    Chart
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={panelTab === 'table'}
                    className={`atc-tab ${panelTab === 'table' ? 'on' : ''}`}
                    onClick={() => setPanelTab('table')}
                  >
                    Table
                    <span className="atc-tab-count">{tableRows.length}</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={panelTab === 'analytic'}
                    className={`atc-tab ${panelTab === 'analytic' ? 'on' : ''}`}
                    onClick={() => setPanelTab('analytic')}
                  >
                    Analytic
                  </button>
                </div>
              </div>
            </div>

            {panelTab === 'chart' && (
              <div className="atc-tab-panel atc-tab-panel-chart" role="tabpanel">
                {loading && <p className="muted">Loading…</p>}

                {!loading && !rows.length && (
                  <p className="atc-empty">
                    No AT&C snapshots in the database yet. Open{' '}
                    <a href="/upload">Upload Center</a> and publish Format IA / IB.
                  </p>
                )}

                {!loading && rows.length > 0 && !activeCodes.length && (
                  <p className="atc-empty">
                    {isMetricCompare
                      ? 'Select one office on the left.'
                      : 'Select at least one unit on the left.'}
                  </p>
                )}

                {!loading && hasChart && mode === 'trend' && (
                  <div className="atc-chart-wrap">
                    <div className="atc-chart">
                      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                        <LineChart
                          data={trendData}
                          margin={{ top: 28, right: 16, left: 4, bottom: 8 }}
                        >
                          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                          <XAxis
                            dataKey="period"
                            type="category"
                            allowDuplicatedCategory={false}
                            padding={{ left: 0, right: 8 }}
                            interval={0}
                            tick={{ fill: 'var(--chart-tick)', fontSize: 12 }}
                            minTickGap={0}
                          />
                          <YAxis
                            tick={(props) => (
                              <YAxisTick2
                                {...props}
                                unit={param.kind === 'pct' ? '%' : ''}
                              />
                            )}
                            ticks={trendYAxis?.ticks}
                            tickFormatter={yTick2}
                            width={56}
                            domain={trendYAxis?.domain || ['auto', 'auto']}
                            allowDataOverflow={false}
                            allowDecimals
                          />
                          <Tooltip
                            {...CHART_TOOLTIP}
                            formatter={(v: number, name: string) => [fmtTip(v), name]}
                          />
                          <Legend wrapperStyle={{ fontSize: 11, color: 'var(--chart-label)', paddingTop: 4 }} />
                          {activeCodes.map((code, si) => (
                            <Line
                              key={code}
                              type="monotone"
                              dataKey={`u_${code}`}
                              name={nameByCode.get(code) || code}
                              stroke={colorByCode.get(code)}
                              strokeWidth={2.4}
                              dot={{ r: 3.5, strokeWidth: 0 }}
                              activeDot={{
                                r: 6,
                                strokeWidth: 2,
                                stroke: '#ffffff',
                                cursor: canEditAtc ? 'pointer' : undefined,
                                onClick: (_evt: unknown, payload: unknown) => {
                                  if (!canEditAtc) return;
                                  openEditFor(code, periodFromChartClick(payload));
                                },
                              }}
                              connectNulls
                              onClick={(data) => {
                                if (!canEditAtc) return;
                                openEditFor(code, periodFromChartClick(data));
                              }}
                              label={
                                showLineLabels
                                  ? (props: LabelProps) => (
                                      <MilestoneLabel
                                        {...props}
                                        periods={trendPeriods}
                                        milestones={milestonePeriods}
                                        lastIndex={lastIndexByCode.get(code) ?? -1}
                                        color={colorByCode.get(code) || '#1a73e8'}
                                        kind={param.kind}
                                        stagger={si % 4}
                                      />
                                    )
                                  : false
                              }
                            />
                          ))}
                          {showTarget &&
                            param.targetField &&
                            activeCodes.map((code) => (
                              <Line
                                key={`t_${code}`}
                                type="monotone"
                                dataKey={`t_${code}`}
                                name={`${shortLabel(nameByCode.get(code) || code)} tgt`}
                                stroke={colorByCode.get(code) || TARGET_COLOR}
                                strokeWidth={1.8}
                                strokeDasharray="7 4"
                                strokeOpacity={0.95}
                                dot={false}
                                activeDot={{ r: 4, fill: TARGET_COLOR, stroke: '#ffffff' }}
                                connectNulls
                                legendType={activeCodes.length <= 4 ? 'line' : 'none'}
                              />
                            ))}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    {latestStrip.length > 0 && (
                      <div className="atc-latest-strip" aria-label="Latest values">
                        {latestStrip.map((item) => (
                          <span key={item.code} className="atc-latest-chip" style={{ borderColor: item.color }}>
                            <i style={{ background: item.color }} />
                            <span className="atc-latest-name">{item.name}</span>
                            <strong>{item.text || '—'}</strong>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {!loading && hasChart && mode === 'compare' && (
                  <div className="atc-chart-wrap">
                    <div className="atc-chart">
                      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                        {isIdcCompare ? (
                          <BarChart
                            data={muGroupedData}
                            margin={{
                              top: 28,
                              right: 12,
                              left: 4,
                              bottom: wideCompareAxis ? 28 : 48,
                            }}
                            barCategoryGap={wideCompareAxis ? '18%' : '12%'}
                            barGap={4}
                          >
                            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                            <XAxis
                              dataKey="name"
                              tick={{
                                fill: 'var(--chart-tick)',
                                fontSize: wideCompareAxis ? 13 : 11,
                                fontWeight: wideCompareAxis ? 650 : 500,
                              }}
                              interval={0}
                              angle={wideCompareAxis ? 0 : -30}
                              textAnchor={wideCompareAxis ? 'middle' : 'end'}
                              height={wideCompareAxis ? 40 : 72}
                            />
                            <YAxis
                              tick={(props) => <YAxisTick2 {...props} />}
                              ticks={muYAxis?.ticks}
                              tickFormatter={yTick2}
                              width={56}
                              domain={muYAxis?.domain || ['auto', 'auto']}
                              allowDataOverflow={false}
                              allowDecimals
                            />
                            <Tooltip
                              {...CHART_TOOLTIP}
                              cursor={{ fill: 'rgba(180, 220, 210, 0.06)' }}
                              formatter={(v, name) => {
                                const num = typeof v === 'number' ? v : Number(v);
                                return [
                                  Number.isFinite(num) ? formatLabel(num, 'mu') : '—',
                                  String(name),
                                ];
                              }}
                            />
                            <Legend
                              wrapperStyle={{ fontSize: 11, color: 'var(--chart-label)', paddingTop: 4 }}
                            />
                            <Bar
                              dataKey="input"
                              name="Input"
                              fill={MU_BAR_COLORS.input}
                              radius={[7, 7, 0, 0]}
                              cursor={canEditAtc ? 'pointer' : undefined}
                              onClick={(data) => {
                                if (!canEditAtc) return;
                                const code = officeCodeFromChartClick(data);
                                if (code) openEditFor(code);
                              }}
                              activeBar={{ fill: MU_BAR_COLORS.input, stroke: '#1e293b', strokeWidth: 1 }}
                            >
                              <LabelList
                                dataKey="input"
                                content={(props) => (
                                  <MuGroupBarLabel
                                    {...props}
                                    show
                                    inside={desktopChart && activeCodes.length <= 4}
                                  />
                                )}
                              />
                            </Bar>
                            <Bar
                              dataKey="demand"
                              name="Demand"
                              fill={MU_BAR_COLORS.demand}
                              radius={[7, 7, 0, 0]}
                              cursor={canEditAtc ? 'pointer' : undefined}
                              onClick={(data) => {
                                if (!canEditAtc) return;
                                const code = officeCodeFromChartClick(data);
                                if (code) openEditFor(code);
                              }}
                              activeBar={{ fill: MU_BAR_COLORS.demand, stroke: '#1e293b', strokeWidth: 1 }}
                            >
                              <LabelList
                                dataKey="demand"
                                content={(props) => (
                                  <MuGroupBarLabel
                                    {...props}
                                    show
                                    inside={desktopChart && activeCodes.length <= 4}
                                  />
                                )}
                              />
                            </Bar>
                            <Bar
                              dataKey="collection"
                              name="Collection"
                              fill={MU_BAR_COLORS.collection}
                              radius={[7, 7, 0, 0]}
                              cursor={canEditAtc ? 'pointer' : undefined}
                              onClick={(data) => {
                                if (!canEditAtc) return;
                                const code = officeCodeFromChartClick(data);
                                if (code) openEditFor(code);
                              }}
                              activeBar={{ fill: MU_BAR_COLORS.collection, stroke: '#1e293b', strokeWidth: 1 }}
                            >
                              <LabelList
                                dataKey="collection"
                                content={(props) => (
                                  <MuGroupBarLabel
                                    {...props}
                                    show
                                    inside={desktopChart && activeCodes.length <= 4}
                                  />
                                )}
                              />
                            </Bar>
                          </BarChart>
                        ) : (
                          <ComposedChart
                            data={compareData}
                            margin={{
                              top: showTarget ? 36 : 28,
                              right: 16,
                              left: 4,
                              bottom: isMetricCompare ? 16 : wideCompareAxis ? 28 : 48,
                            }}
                          >
                            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                            <XAxis
                              dataKey="name"
                              tick={{
                                fill: 'var(--chart-tick)',
                                fontSize: wideCompareAxis ? 13 : isMetricCompare ? 12 : 11,
                                fontWeight: wideCompareAxis ? 650 : 500,
                              }}
                              interval={0}
                              angle={wideCompareAxis || isMetricCompare ? 0 : -30}
                              textAnchor={wideCompareAxis || isMetricCompare ? 'middle' : 'end'}
                              height={wideCompareAxis ? 40 : isMetricCompare ? 36 : 72}
                            />
                            <YAxis
                              tick={(props) => (
                                <YAxisTick2
                                  {...props}
                                  unit={compareKind === 'pct' ? '%' : ''}
                                />
                              )}
                              ticks={compareYAxis?.ticks}
                              tickFormatter={yTick2}
                              width={56}
                              domain={compareYAxis?.domain || ['auto', 'auto']}
                              allowDataOverflow={false}
                              allowDecimals
                            />
                            {lossTooltipActive ? (
                              <Tooltip
                                {...CHART_TOOLTIP}
                                cursor={{ fill: 'rgba(180, 220, 210, 0.06)' }}
                                content={<LossTargetTooltip kind={compareKind} />}
                              />
                            ) : (
                              <Tooltip
                                {...CHART_TOOLTIP}
                                cursor={{ fill: 'rgba(180, 220, 210, 0.06)' }}
                                formatter={(v, name, item) => {
                                  const num = typeof v === 'number' ? v : Number(v);
                                  const delta = (
                                    item?.payload as { delta?: number | null } | undefined
                                  )?.delta;
                                  const base = Number.isFinite(num) ? fmtTip(num) : String(v ?? '');
                                  if (String(name).includes('FY target') || delta == null) {
                                    return [base, String(name)];
                                  }
                                  return [
                                    base + ' (' + formatDelta(delta, compareKind) + ')',
                                    String(name),
                                  ];
                                }}
                              />
                            )}
                            <Legend
                              wrapperStyle={{ fontSize: 11, color: 'var(--chart-label)', paddingTop: 4 }}
                            />
                            <Bar
                              dataKey="value"
                              name={isMetricCompare ? 'Loss %' : param.label}
                              radius={[8, 8, 0, 0]}
                              cursor={canEditAtc ? 'pointer' : undefined}
                              onClick={(data) => {
                                if (!canEditAtc) return;
                                if (isMetricCompare) {
                                  const code = activeCodes[0];
                                  if (code) openEditFor(code);
                                  return;
                                }
                                const code = officeCodeFromChartClick(data);
                                if (code) openEditFor(code);
                              }}
                            >
                              {compareData.map((d) => (
                                <Cell key={d.code} fill={d.fill || '#1a73e8'} />
                              ))}
                              <LabelList
                                dataKey="value"
                                content={(props) => (
                                  <BarValueLabel
                                    {...props}
                                    kind={compareKind}
                                    show={showBarLabels}
                                    inside={desktopChart}
                                    deltas={compareBarDeltas}
                                    showDelta={showBarDeltas}
                                  />
                                )}
                              />
                            </Bar>
                            {showTarget &&
                              (isMetricCompare || Boolean(param.targetField)) && (
                                <Line
                                  type="linear"
                                  dataKey="target"
                                  name="FY target"
                                  stroke={TARGET_COLOR}
                                  strokeWidth={2}
                                  strokeDasharray="6 4"
                                  dot={{
                                    r: 5,
                                    fill: TARGET_COLOR,
                                    stroke: '#ffffff',
                                    strokeWidth: 1.5,
                                  }}
                                  activeDot={{ r: 6 }}
                                  connectNulls={false}
                                >
                                  <LabelList
                                    dataKey="target"
                                    content={(props) => (
                                      <TargetPointLabel
                                        {...props}
                                        kind={compareKind}
                                        show={showTarget}
                                      />
                                    )}
                                  />
                                </Line>
                              )}
                          </ComposedChart>
                        )}
                      </ResponsiveContainer>
                    </div>
                    {!isIdcCompare && compareDeltaStrip.length > 0 && (
                      <div className="atc-delta-strip" aria-label="Comparison deltas">
                        {compareDeltaStrip.map((item) => (
                          <span
                            key={item.label}
                            className={'atc-delta-chip atc-delta-' + item.tone}
                          >
                            <span className="atc-latest-name">{item.label}</span>
                            <strong>{item.text}</strong>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {panelTab === 'table' && (
              <div className="atc-tab-panel atc-tab-panel-table" role="tabpanel">
                <div className="table-wrap atc-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th>Office</th>
                        <th>AT&amp;C</th>
                        <th>Target</th>
                        <th>T&amp;D</th>
                        <th>Coll.eff</th>
                        <th>Input</th>
                        <th>Demand</th>
                        <th>Collection</th>
                        {canEditAtc && <th />}
                      </tr>
                    </thead>
                    <tbody>
                      {tableRows.map((r, i) => (
                        <tr
                          key={`${r.period_label}-${r.office_code}-${i}`}
                          className={canEditAtc ? 'atc-row-editable' : undefined}
                          onClick={() => {
                            if (!canEditAtc) return;
                            openEditFor(String(r.office_code), String(r.period_label));
                          }}
                        >
                          <td>{String(r.period_label)}</td>
                          <td>
                            <span
                              className="atc-table-dot"
                              style={{
                                background: colorByCode.get(String(r.office_code)) || 'var(--muted)',
                              }}
                            />
                            {String(r.office_name)}
                          </td>
                          <td>{formatValue(r.atc_loss, 'pct')}</td>
                          <td>{formatValue(r.target_atc, 'pct')}</td>
                          <td>{formatValue(r.dist_loss, 'pct')}</td>
                          <td>{formatValue(r.coll_eff, 'pct')}</td>
                          <td>{formatValue(r.input_mu, 'mu')}</td>
                          <td>{formatValue(r.demand_mu, 'mu')}</td>
                          <td>{formatValue(r.collection_mu, 'mu')}</td>
                          {canEditAtc && (
                            <td>
                              <button
                                type="button"
                                className="linkish"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openEditFor(String(r.office_code), String(r.period_label));
                                }}
                              >
                                Edit
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                      {!tableRows.length && (
                        <tr>
                          <td colSpan={canEditAtc ? 10 : 9} className="muted">
                            No rows for current selection
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {panelTab === 'analytic' && (
              <div className="atc-tab-panel atc-tab-panel-analytic" role="tabpanel">
                <div className="atc-analytic-head">
                  <div>
                    <h3 className="atc-analytic-title">Weakness analytic</h3>
                    <p className="atc-analytic-sub muted">
                      {focusPeriod}
                      {focusPrevPeriod ? ` vs ${focusPrevPeriod}` : ''} · {level} ·{' '}
                      {format === 'IA' ? 'Excl. Bulk' : 'Incl. Bulk'} · offices with Input MU:{' '}
                      {focusRows.length}
                    </p>
                  </div>
                </div>

                <div className="atc-analytic-primer">
                  <div className="atc-analytic-chain">
                    <div className="atc-chain-step">
                      <span className="atc-chain-label">Input</span>
                      <span className="atc-chain-desc">Energy supplied (YTD MU)</span>
                    </div>
                    <span className="atc-chain-arrow" aria-hidden>
                      →
                    </span>
                    <div className="atc-chain-step">
                      <span className="atc-chain-label">Demand</span>
                      <span className="atc-chain-desc">Billed</span>
                    </div>
                    <span className="atc-chain-arrow" aria-hidden>
                      →
                    </span>
                    <div className="atc-chain-step">
                      <span className="atc-chain-label">Collection</span>
                      <span className="atc-chain-desc">Realized</span>
                    </div>
                  </div>
                  <ul className="atc-analytic-rules">
                    <li>
                      <span className="atc-tone-dot critical" />
                      <strong>Unbilled</strong> = Input − Demand — not billed (most serious volume)
                    </li>
                    <li>
                      <span className="atc-tone-dot warn" />
                      <strong>Outstanding</strong> = Demand − Collection — billed, not paid
                    </li>
                    <li>
                      <span className="atc-tone-dot watch" />
                      <strong>ATC% / T&amp;D%</strong> = intensity only — small Input can look worse than large MU gaps
                    </li>
                  </ul>
                </div>

                <p className="atc-analytic-prompt">Choose a topic to rank offices:</p>
                <div className="atc-analytic-topics" role="group" aria-label="Analytic topics">
                  {ANALYTIC_TOPICS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={`atc-topic-btn tone-${t.tone}${analyticTopic === t.id ? ' on' : ''}`}
                      aria-pressed={analyticTopic === t.id}
                      onClick={() => setAnalyticTopic((prev) => (prev === t.id ? null : t.id))}
                    >
                      <span className="atc-topic-short">{t.short}</span>
                      <span className="atc-topic-label">{t.label}</span>
                    </button>
                  ))}
                </div>

                {loading && <p className="muted">Loading…</p>}

                {!loading && !analyticTopic && (
                  <p className="atc-analytic-idle muted">
                    Click a topic button above to see ranked offices, colour-coded reasons, and the action to take.
                  </p>
                )}

                {!loading && analyticMeta && (
                  <div className={`atc-analytic-result tone-${analyticMeta.tone}`}>
                    <div className="atc-analytic-result-head">
                      <div>
                        <h4>{analyticMeta.label}</h4>
                        <p className="atc-analytic-formula">
                          <code>{analyticMeta.formula}</code>
                        </p>
                      </div>
                      <button
                        type="button"
                        className="linkish"
                        onClick={() => setAnalyticTopic(null)}
                      >
                        Clear
                      </button>
                    </div>
                    <div className="atc-analytic-explain">
                      <p>
                        <strong>Logic.</strong> {analyticMeta.logic}
                      </p>
                      <p>
                        <strong>Action.</strong> {analyticMeta.action}
                      </p>
                    </div>

                    {!rankedFocus.length ? (
                      <p className="atc-empty">
                        No offices match this topic for the selected month/level. Pick an as-of month
                        that has Input / Demand / Collection MU.
                      </p>
                    ) : (
                      <div className="atc-analytic-list">
                        {rankedFocus.map((r, i) => {
                          const rank = i + 1;
                          const tone = rowTone(rank, analyticMeta.id, r);
                          const metric = metricForLens(r, analyticMeta.id);
                          return (
                            <article
                              key={r.office_code}
                              className={`atc-analytic-card tone-${tone}`}
                            >
                              <div className="atc-analytic-card-top">
                                <span className={`atc-rank tone-${tone}`}>#{rank}</span>
                                <div className="atc-analytic-card-id">
                                  <strong>{r.office_name}</strong>
                                  <span className="muted">{r.office_code}</span>
                                </div>
                                <div className={`atc-metric tone-${tone}`}>
                                  {formatMetric(analyticMeta.id, metric)}
                                </div>
                                <button
                                  type="button"
                                  className="btn ghost atc-analytic-chart-btn"
                                  onClick={() => selectFocusOffice(r.office_code)}
                                >
                                  Chart
                                </button>
                              </div>
                              <p className="atc-analytic-reason">{explainReason(analyticMeta.id, r, rank)}</p>
                              <div className="atc-analytic-stats">
                                <span>
                                  Input <b>{formatMu(r.input)}</b>
                                </span>
                                <span>
                                  Unbilled <b>{formatMu(r.unbilled)}</b>
                                </span>
                                <span>
                                  Outstanding <b>{formatMu(r.outstanding)}</b>
                                </span>
                                <span>
                                  ATC <b>{formatPct(r.atcPct)}</b>
                                </span>
                                <span>
                                  T&amp;D <b>{formatPct(r.tdPct)}</b>
                                </span>
                                <span>
                                  Coll.eff <b>{formatPct(r.collEff)}</b>
                                </span>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    )}

                    <div className="atc-analytic-legend" aria-label="Colour legend">
                      <span>
                        <i className="atc-tone-dot critical" /> Critical — top priority
                      </span>
                      <span>
                        <i className="atc-tone-dot warn" /> Warn — act this cycle
                      </span>
                      <span>
                        <i className="atc-tone-dot watch" /> Watch — intensity / early signal
                      </span>
                      <span>
                        <i className="atc-tone-dot info" /> Info — lower rank
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {editOpen && editRow && (
        <div className="upload-modal-root" role="dialog" aria-modal="true" aria-labelledby="atc-edit-title">
          <button
            type="button"
            className="upload-modal-backdrop"
            aria-label="Close"
            onClick={() => !editBusy && setEditOpen(false)}
          />
          <div className="upload-modal atc-edit-modal">
            <div className="upload-modal-head">
              <h3 id="atc-edit-title">Edit AT&amp;C values</h3>
              <button type="button" className="linkish" disabled={editBusy} onClick={() => setEditOpen(false)}>
                Close
              </button>
            </div>
            <p className="muted atc-edit-meta">
              {format === 'IA' ? 'Excl. Bulk' : 'Incl. Bulk'} · {String(editRow.period_label)} ·{' '}
              {String(editRow.office_name)} ({String(editRow.office_code)})
            </p>
            {editError && <p className="error">{editError}</p>}
            <div className="atc-edit-grid">
              {(
                [
                  ['atc_loss', 'AT&C loss %'],
                  ['target_atc', 'AT&C FY target %'],
                  ['dist_loss', 'T&D loss %'],
                  ['target_dist', 'T&D FY target %'],
                  ['coll_eff', 'Collection eff. %'],
                  ['input_mu', 'Input MU'],
                  ['demand_mu', 'Demand MU'],
                  ['collection_mu', 'Collection MU'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="atc-edit-field">
                  <span>{label}</span>
                  <input
                    type="number"
                    step="any"
                    value={editForm[key] ?? ''}
                    disabled={editBusy}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, [key]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
            <div className="atc-edit-actions">
              <button type="button" className="btn ghost" disabled={editBusy} onClick={() => setEditOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn" disabled={editBusy} onClick={() => void saveEdit()}>
                {editBusy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
