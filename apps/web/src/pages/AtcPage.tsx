import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../api';

/** Fixed chart canvas — keeps Trend / Compare / label modes visually consistent */
const CHART_HEIGHT = 320;
/** Max series with on-chart endpoint pills before we switch to a latest-value strip */
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
  if (kind === 'pct') return `${n.toFixed(1)}%`;
  if (kind === 'mu') return n >= 100 ? n.toFixed(1) : n.toFixed(2);
  return String(Math.round(n));
}

/** Pill label only on the series endpoint — keeps multi-month trends readable */
function EndPointLabel({
  x,
  y,
  value,
  index,
  lastIndex,
  color,
  kind,
  stagger = 0,
}: LabelProps & {
  lastIndex: number;
  color: string;
  kind: 'pct' | 'mu' | 'count';
  stagger?: number;
}) {
  if (index !== lastIndex || value == null || value === '') return null;
  const cx = Number(x);
  const cy = Number(y);
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  const text = formatLabel(value, kind);
  if (!text) return null;
  const w = Math.max(36, text.length * 7 + 14);
  const h = 18;
  const ox = cx - w / 2;
  const oy = cy - 28 - stagger * 16;
  return (
    <g className="atc-datalabel">
      <rect x={ox} y={oy} width={w} height={h} rx={9} fill="#0f2426" stroke={color} strokeWidth={1.25} />
      <text
        x={cx}
        y={oy + h / 2 + 0.5}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#e8f3f1"
        fontSize={10}
        fontWeight={650}
      >
        {text}
      </text>
    </g>
  );
}

function BarValueLabel(props: {
  x?: number | string;
  y?: number | string;
  width?: number | string;
  value?: number | string | null;
  kind: 'pct' | 'mu' | 'count';
  show: boolean;
}) {
  const { x, y, width, value, kind, show } = props;
  if (!show || value == null || value === '') return null;
  const text = formatLabel(value, kind);
  if (!text) return null;
  const cx = Number(x) + Number(width || 0) / 2;
  const cy = Number(y) - 8;
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  return (
    <text
      className="atc-datalabel"
      x={cx}
      y={cy}
      textAnchor="middle"
      fill="#c5ddd9"
      fontSize={10}
      fontWeight={650}
    >
      {text}
    </text>
  );
}

type AtcRow = Record<string, unknown>;
type Level = 'ccc' | 'division' | 'region';

const PARAMS: { id: string; label: string; short: string; field: string; kind: 'pct' | 'mu' | 'count'; targetField?: string }[] = [
  { id: 'atc', label: 'AT&C loss', short: 'AT&C', field: 'atc_loss', kind: 'pct', targetField: 'target_atc' },
  { id: 'dist', label: 'Distribution loss', short: 'Dist', field: 'dist_loss', kind: 'pct', targetField: 'target_dist' },
  { id: 'ce', label: 'Collection efficiency', short: 'Coll.eff', field: 'coll_eff', kind: 'pct' },
  // MU fields exist only on the workbook "achievement" month (not May'25 / Mar'26 header cols)
  { id: 'input', label: 'Input (MU)', short: 'Input', field: 'input_mu', kind: 'mu' },
  { id: 'demand', label: 'Demand (MU)', short: 'Demand', field: 'demand_mu', kind: 'mu' },
  { id: 'coll', label: 'Collection (MU)', short: 'Coll.', field: 'collection_mu', kind: 'mu' },
];

const LINE_COLORS = [
  '#2dd4bf',
  '#60a5fa',
  '#f5b942',
  '#f07178',
  '#a78bfa',
  '#7bd88f',
  '#fb923c',
  '#e879f9',
  '#38bdf8',
  '#f472b6',
];

const CHART_TOOLTIP = {
  contentStyle: {
    background: '#0f2426',
    border: '1px solid rgba(180,220,210,0.16)',
    borderRadius: 12,
    color: '#e8f3f1',
    boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
  },
  labelStyle: { color: '#e8f3f1', fontWeight: 600, marginBottom: 4 },
  itemStyle: { color: '#e8f3f1', padding: '2px 0' },
  wrapperStyle: { outline: 'none' },
};

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
  if (kind === 'mu') return n.toFixed(3);
  return Math.round(n).toLocaleString();
}

function chartValue(v: unknown, kind: 'pct' | 'mu' | 'count') {
  const n = toNum(v);
  if (n == null) return null;
  if (kind === 'pct') return asPct(n);
  return n;
}

function shortLabel(name: string) {
  const n = name.trim();
  return n.length <= 16 ? n : `${n.slice(0, 14)}…`;
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
  const [rows, setRows] = useState<AtcRow[]>([]);
  const [periods, setPeriods] = useState<string[]>([]);
  const [format, setFormat] = useState<'IA' | 'IB'>('IA');
  const [mode, setMode] = useState<'trend' | 'compare'>('trend');
  const [level, setLevel] = useState<Level>('ccc');
  const [division, setDivision] = useState('');
  const [asOf, setAsOf] = useState('');
  const [paramId, setParamId] = useState('atc');
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const [showTarget, setShowTarget] = useState(true);
  const [unitQuery, setUnitQuery] = useState('');
  const [unitsOpen, setUnitsOpen] = useState(true);
  const [panelTab, setPanelTab] = useState<'chart' | 'table'>('chart');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const param = PARAMS.find((p) => p.id === paramId) || PARAMS[0];

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
      .catch((e) => setError(e.message || 'Failed to load AT&C'))
      .finally(() => setLoading(false));
  }, [format]);

  useEffect(() => {
    if (format === 'IB' && level === 'ccc') setLevel('division');
  }, [format, level]);

  const sortedPeriods = useMemo(() => {
    return [...periods].sort((a, b) => {
      const ra = rows.find((r) => r.period_label === a);
      const rb = rows.find((r) => r.period_label === b);
      return String(ra?.period_sort || a).localeCompare(String(rb?.period_sort || b));
    });
  }, [periods, rows]);

  // MU metrics only exist on achievement months — jump Compare as-of to a month that has values
  useEffect(() => {
    if (param.kind !== 'mu' || mode !== 'compare' || !rows.length) return;
    const hasMu = (p: string) =>
      rows.some((r) => r.period_label === p && toNum(r[param.field]) != null);
    if (asOf && hasMu(asOf)) return;
    const withData = [...sortedPeriods].reverse().find(hasMu);
    if (withData) setAsOf(withData);
  }, [paramId, param.kind, param.field, mode, rows, asOf, sortedPeriods]);

  const divisions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) {
      if (r.office_type === 'division') {
        map.set(String(r.office_code), String(r.office_name || r.office_code));
      } else if (r.division_code) {
        map.set(String(r.division_code), String(r.division_name || r.division_code));
      }
    }
    return [...map.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  }, [rows]);

  const officeOptions = useMemo(() => {
    let list = rows.filter((r) => r.office_type === level);
    if (division) {
      if (level === 'ccc') {
        list = list.filter(
          (r) =>
            String(r.division_code || '') === division ||
            String(r.office_code || '').startsWith(division)
        );
      } else if (level === 'division') {
        list = list.filter((r) => String(r.office_code) === division);
      }
    }
    if (level === 'region') {
      list = list.filter((r) => String(r.office_code) === '341' || /region/i.test(String(r.office_name)));
    }
    const map = new Map<string, string>();
    for (const r of list) map.set(String(r.office_code), String(r.office_name || r.office_code));
    return [...map.entries()]
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, level, division]);

  // Reset unit selection when hierarchy / basis changes (not on every officeOptions identity change)
  const officeKey = `${format}|${level}|${division}|${officeOptions.map((o) => o.code).join(',')}`;
  useEffect(() => {
    if (!officeOptions.length) {
      setSelectedCodes([]);
      return;
    }
    if (level === 'region' || level === 'division') {
      setSelectedCodes(officeOptions.map((o) => o.code));
    } else {
      setSelectedCodes(officeOptions.slice(0, Math.min(4, officeOptions.length)).map((o) => o.code));
    }
    setUnitQuery('');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- officeKey captures option codes
  }, [officeKey]);

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
    return sortedPeriods.map((p) => {
      const point: Record<string, string | number | null> = { period: p };
      for (const code of activeCodes) {
        const row = rows.find(
          (r) => String(r.office_code) === code && r.period_label === p && r.office_type === level
        );
        point[`u_${code}`] = row ? chartValue(row[param.field], param.kind) : null;
      }
      return point;
    });
  }, [rows, sortedPeriods, activeCodes, param, level]);

  const compareData = useMemo(() => {
    const period = asOf || sortedPeriods[sortedPeriods.length - 1] || '';
    return activeCodes.map((code) => {
      const row = rows.find(
        (r) => String(r.office_code) === code && r.period_label === period && r.office_type === level
      );
      return {
        name: shortLabel(nameByCode.get(code) || code),
        code,
        value: row ? chartValue(row[param.field], param.kind) : null,
        target:
          showTarget && param.targetField && row
            ? chartValue(row[param.targetField], param.kind)
            : null,
      };
    });
  }, [rows, asOf, sortedPeriods, activeCodes, param, level, nameByCode, showTarget]);

  const targetRef = useMemo(() => {
    if (!showTarget || !param.targetField || !activeCodes.length) return null;
    const period = mode === 'compare' ? asOf || sortedPeriods[sortedPeriods.length - 1] : sortedPeriods[sortedPeriods.length - 1];
    const vals = activeCodes
      .map((code) => {
        const row = rows.find(
          (r) => String(r.office_code) === code && r.period_label === period && r.office_type === level
        );
        return row ? chartValue(row[param.targetField!], param.kind) : null;
      })
      .filter((v): v is number => v != null);
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }, [showTarget, param, asOf, sortedPeriods, activeCodes, rows, level, mode]);

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

  const toggleCode = (code: string) => {
    setSelectedCodes((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  };

  const selectAll = () => setSelectedCodes(officeOptions.map((o) => o.code));
  const selectNone = () => setSelectedCodes([]);

  const fmtTip = (v: number) =>
    param.kind === 'pct' ? `${Number(v).toFixed(2)}%` : Number(v).toFixed(param.kind === 'mu' ? 3 : 0);

  const showLineEndLabels = mode === 'trend' && activeCodes.length > 0 && activeCodes.length <= LABEL_SERIES_CAP;
  const showBarLabels = mode === 'compare' && activeCodes.length > 0 && activeCodes.length <= LABEL_BAR_CAP;

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
    if (mode !== 'trend' || !activeCodes.length || showLineEndLabels) return [];
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
        color: colorByCode.get(code) || '#2dd4bf',
        period,
        text: formatLabel(value, param.kind),
      };
    });
  }, [mode, activeCodes, showLineEndLabels, sortedPeriods, trendData, nameByCode, colorByCode, param.kind]);

  const breadcrumb = [
    'Darjeeling Region',
    level !== 'region' && (division ? divisions.find(([c]) => c === division)?.[1] || 'Division' : 'All divisions'),
    level === 'ccc' && 'CCC',
  ]
    .filter(Boolean)
    .join(' › ');

  const hasChart =
    (mode === 'trend' && trendData.length > 0 && activeCodes.length > 0) ||
    (mode === 'compare' && compareData.length > 0 && activeCodes.length > 0);

  return (
    <div className="atc-page">
      <header className="atc-hero">
        <div className="atc-hero-title">
          <h2>AT&amp;C / T&amp;D</h2>
          <span className="muted">{breadcrumb}</span>
        </div>
        <div className="atc-hero-meta">
          <span className="atc-pill">{sortedPeriods.length} mo</span>
          <span className="atc-pill">{activeCodes.length} units</span>
          <span
            className="atc-pill"
            title={format === 'IA' ? 'Format-IA · including bulk path' : 'Format-IB · excluding bulk path'}
          >
            {format === 'IA' ? 'Incl. Bulk' : 'Excl. Bulk'}
          </span>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <div className="atc-layout">
        <aside className="atc-controls panel">
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
                { value: 'IA', label: 'Incl. Bulk' },
                { value: 'IB', label: 'Excl. Bulk' },
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
                { value: 'region', label: 'Region' },
                { value: 'division', label: 'Div' },
                { value: 'ccc', label: 'CCC', disabled: format === 'IB' },
              ]}
            />
            {level !== 'region' && (
              <label className="atc-field">
                <select
                  value={division}
                  onChange={(e) => setDivision(e.target.value)}
                  aria-label="Division filter"
                >
                  <option value="">All divisions</option>
                  {divisions.map(([code, name]) => (
                    <option key={code} value={code}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </section>

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

          {mode === 'compare' && (
            <section className="atc-block">
              <div className="atc-label">Month</div>
              <div className="atc-month-row">
                {sortedPeriods.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`atc-month ${asOf === p ? 'on' : ''}`}
                    onClick={() => setAsOf(p)}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </section>
          )}

          {param.targetField && (
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
                Units <span className="atc-count">{selectedCodes.length}/{officeOptions.length}</span>
              </div>
              <button type="button" className="linkish" onClick={() => setUnitsOpen((v) => !v)}>
                {unitsOpen ? 'Hide' : 'Show'}
              </button>
            </div>

            {unitsOpen && (
              <>
                <div className="atc-units-tools">
                  <input
                    type="search"
                    placeholder="Search unit…"
                    value={unitQuery}
                    onChange={(e) => setUnitQuery(e.target.value)}
                    aria-label="Search units"
                  />
                  <div className="atc-units-links">
                    <button type="button" className="linkish" onClick={selectAll}>
                      All
                    </button>
                    <button type="button" className="linkish" onClick={selectNone}>
                      None
                    </button>
                  </div>
                </div>
                <div className="atc-unit-list" role="listbox" aria-multiselectable>
                  {filteredOffices.map((o) => {
                    const on = selectedCodes.includes(o.code);
                    const color = colorByCode.get(o.code);
                    return (
                      <label key={o.code} className={`atc-unit ${on ? 'on' : ''}`}>
                        <input
                          type="checkbox"
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
              </>
            )}
          </section>
        </aside>

        <div className="atc-main">
          <div className="panel atc-result-panel">
            <div className="atc-result-head">
              <div className="atc-result-title">
                <h3>
                  {mode === 'trend' ? 'Trend' : 'Compare'} · {param.short}
                  {mode === 'compare' && asOf ? ` · ${asOf}` : ''}
                </h3>
              </div>
              <div className="atc-tabs" role="tablist" aria-label="Chart or table">
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
              </div>
            </div>

            {panelTab === 'chart' && (
              <div className="atc-tab-panel" role="tabpanel">
                {loading && <p className="muted">Loading…</p>}

                {!loading && !activeCodes.length && (
                  <p className="atc-empty">Select at least one unit on the left.</p>
                )}

                {!loading && hasChart && mode === 'trend' && (
                  <div className="atc-chart-wrap">
                    <div className="atc-chart" style={{ height: CHART_HEIGHT }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={trendData}
                          margin={{ top: 28, right: 16, left: 4, bottom: 8 }}
                        >
                          <CartesianGrid stroke="rgba(180,220,210,0.1)" vertical={false} />
                          <XAxis dataKey="period" tick={{ fill: '#8faba8', fontSize: 12 }} />
                          <YAxis
                            tick={{ fill: '#8faba8', fontSize: 12 }}
                            unit={param.kind === 'pct' ? '%' : ''}
                            width={48}
                          />
                          <Tooltip
                            {...CHART_TOOLTIP}
                            formatter={(v: number, name: string) => [fmtTip(v), name]}
                          />
                          <Legend wrapperStyle={{ fontSize: 11, color: '#e8f3f1', paddingTop: 4 }} />
                          {showTarget && targetRef != null && (
                            <ReferenceLine
                              y={targetRef}
                              stroke="#f5b942"
                              strokeDasharray="5 5"
                              strokeWidth={1.5}
                            />
                          )}
                          {activeCodes.map((code, si) => (
                            <Line
                              key={code}
                              type="monotone"
                              dataKey={`u_${code}`}
                              name={nameByCode.get(code) || code}
                              stroke={colorByCode.get(code)}
                              strokeWidth={2.4}
                              dot={{ r: 3.5, strokeWidth: 0 }}
                              activeDot={{ r: 6, strokeWidth: 2, stroke: '#0f2426' }}
                              connectNulls
                              label={
                                showLineEndLabels
                                  ? (props: LabelProps) => (
                                      <EndPointLabel
                                        {...props}
                                        lastIndex={lastIndexByCode.get(code) ?? -1}
                                        color={colorByCode.get(code) || '#2dd4bf'}
                                        kind={param.kind}
                                        stagger={si % 3}
                                      />
                                    )
                                  : false
                              }
                            />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    {latestStrip.length > 0 ? (
                      <div className="atc-latest-strip" aria-label="Latest values">
                        <span className="atc-latest-caption">Latest</span>
                        {latestStrip.map((item) => (
                          <span key={item.code} className="atc-latest-chip" style={{ borderColor: item.color }}>
                            <i style={{ background: item.color }} />
                            <span className="atc-latest-name">{item.name}</span>
                            <strong>{item.text || '—'}</strong>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="atc-latest-strip atc-latest-strip-spacer" aria-hidden />
                    )}
                  </div>
                )}

                {!loading && hasChart && mode === 'compare' && (
                  <div className="atc-chart-wrap">
                    <div className="atc-chart" style={{ height: CHART_HEIGHT }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart
                          data={compareData}
                          margin={{ top: 28, right: 16, left: 4, bottom: 48 }}
                        >
                          <CartesianGrid stroke="rgba(180,220,210,0.1)" vertical={false} />
                          <XAxis
                            dataKey="name"
                            tick={{ fill: '#8faba8', fontSize: 11 }}
                            interval={0}
                            angle={-30}
                            textAnchor="end"
                            height={72}
                          />
                          <YAxis
                            tick={{ fill: '#8faba8', fontSize: 12 }}
                            unit={param.kind === 'pct' ? '%' : ''}
                            width={48}
                          />
                          <Tooltip
                            {...CHART_TOOLTIP}
                            formatter={(v: number, name: string) => [fmtTip(v), name]}
                          />
                          <Legend wrapperStyle={{ fontSize: 11, color: '#e8f3f1', paddingTop: 4 }} />
                          <Bar dataKey="value" name={param.label} radius={[8, 8, 0, 0]}>
                            {compareData.map((d) => (
                              <Cell key={d.code} fill={colorByCode.get(d.code) || '#2dd4bf'} />
                            ))}
                            <LabelList
                              dataKey="value"
                              content={(props) => (
                                <BarValueLabel {...props} kind={param.kind} show={showBarLabels} />
                              )}
                            />
                          </Bar>
                          {showTarget && param.targetField && (
                            <Line
                              type="monotone"
                              dataKey="target"
                              name="FY target"
                              stroke="#f5b942"
                              strokeWidth={2}
                              dot={{ r: 3, fill: '#f5b942' }}
                            />
                          )}
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="atc-latest-strip atc-latest-strip-spacer" aria-hidden />
                  </div>
                )}
              </div>
            )}

            {panelTab === 'table' && (
              <div className="atc-tab-panel atc-table-panel" role="tabpanel">
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th>Office</th>
                        <th>AT&amp;C</th>
                        <th>Target</th>
                        <th>Dist</th>
                        <th>Coll.eff</th>
                        <th>Input</th>
                        <th>Demand</th>
                        <th>Collection</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tableRows.map((r, i) => (
                        <tr key={`${r.period_label}-${r.office_code}-${i}`}>
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
                        </tr>
                      ))}
                      {!tableRows.length && (
                        <tr>
                          <td colSpan={9} className="muted">
                            No rows for current selection
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
