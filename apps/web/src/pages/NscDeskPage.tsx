import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, canUploadModule } from '../api';
import { useAuth } from '../auth';
import {
  CUM_COLORS,
  NSC_CUMULATIVE,
  NSC_SLABS,
  SLAB_COLORS,
  asNscRow,
  customCutFill,
  encodeCutsParam,
  daysOf,
  fmtDay,
  fmtInt,
  loadCustomDelayCuts,
  makeCustomCut,
  mergeDelayCuts,
  saveCustomDelayCuts,
  type DelayCut,
  type DelayOp,
  type NscClock,
  type NscQueue,
  type NscRow,
  poleLabel,
  procedureLabel,
} from '../lib/nsc';

const PAGE = 80;
const CHART_H = 300;
const TIMELINE_H = 320;
const DIV_PALETTE = ['#1565c0', '#039be5', '#00838f', '#7c4dff', '#ef6c00', '#c62828'];
const HOT_IDS = new Set(['m1_3', 'm3_6', 'm6_12', 'y1']);

const TOOLTIP_STYLE = {
  background: '#ffffff',
  border: '1px solid rgba(30,64,120,0.12)',
  borderRadius: 12,
  color: '#1e293b',
};

type NscDesk = Awaited<ReturnType<typeof api.nscDesk>>;
type DeskView = 'bottleneck' | 'poles' | 'procedure' | 'delay' | 'offices' | 'history' | 'cases';
type DelayBand = 'exclusive' | 'cumulative';

function qsOf(p: Record<string, string | number | undefined>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined || v === '') continue;
    u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}

function num(v: unknown) {
  return Number(v || 0);
}

function ageTone(days: number | null) {
  if (days == null) return '';
  if (days >= 365) return 'nsc-age-year';
  if (days >= 180) return 'nsc-age-critical';
  if (days >= 31) return 'nsc-age-hot';
  return '';
}

export function NscDeskPage() {
  const { user } = useAuth();
  const canUpload = canUploadModule(user, 'nsc');
  const [desk, setDesk] = useState<NscDesk | null>(null);
  const [rows, setRows] = useState<NscRow[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [queue, setQueue] = useState<NscQueue>('pending');
  const [clock, setClock] = useState<NscClock>('quotation');
  const [view, setView] = useState<DeskView>('bottleneck');
  const [division, setDivision] = useState('');
  const [ccc, setCcc] = useState('');
  const [klass, setKlass] = useState('');
  const [pole, setPole] = useState('');
  const [poleMin, setPoleMin] = useState<number | ''>('');
  const [poleMax, setPoleMax] = useState<number | ''>('');
  const [procedure, setProcedure] = useState('');
  const [slab, setSlab] = useState('');
  const [band, setBand] = useState<DelayBand>('exclusive');
  const [cumId, setCumId] = useState('');
  const [delayMin, setDelayMin] = useState<number | ''>('');
  const [delayMax, setDelayMax] = useState<number | ''>('');
  const [customOp, setCustomOp] = useState<DelayOp>('gt');
  const [customA, setCustomA] = useState(45);
  const [customB, setCustomB] = useState(90);
  const [customCuts, setCustomCuts] = useState<DelayCut[]>([]);
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [page, setPage] = useState(0);
  const [timeKey, setTimeKey] = useState('');
  const deskReq = useRef(0);
  const rowReq = useRef(0);
  const cutStoreKey = `dro.nsc.delayCuts.${user?.username || 'local'}`;

  useEffect(() => {
    setCustomCuts(loadCustomDelayCuts(cutStoreKey));
  }, [cutStoreKey]);

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const delayFilter = !slab && (delayMin !== '' || delayMax !== '');
  const cutsParam = encodeCutsParam(customCuts);
  const filterQs = useMemo(
    () =>
      qsOf({
        queue,
        clock,
        division,
        ccc,
        class: klass,
        pole,
        pole_min: poleMin,
        pole_max: poleMax,
        procedure,
        slab: delayFilter ? '' : slab,
        delay_min: delayFilter ? delayMin : '',
        delay_max: delayFilter ? delayMax : '',
        cuts: cutsParam,
        time: timeKey,
        q: qDebounced,
      }),
    [queue, clock, division, ccc, klass, pole, poleMin, poleMax, procedure, slab, delayFilter, delayMin, delayMax, cutsParam, timeKey, qDebounced]
  );

  useEffect(() => {
    setPage(0);
  }, [filterQs]);

  useEffect(() => {
    if (queue !== 'withheld') {
      setTimeKey('');
      if (view === 'history') setView('bottleneck');
    }
  }, [queue, view]);

  const loadDesk = async () => {
    const id = ++deskReq.current;
    setLoading(true);
    setError('');
    try {
      const next = await api.nscDesk(filterQs);
      if (id !== deskReq.current) return;
      setDesk(next);
    } catch (e) {
      if (id !== deskReq.current) return;
      setError(e instanceof Error ? e.message : 'Failed to load NSC');
    } finally {
      if (id === deskReq.current) setLoading(false);
    }
  };

  const loadRows = async () => {
    const id = ++rowReq.current;
    try {
      const r = await api.nsc(`${filterQs}${filterQs ? '&' : '?'}limit=${PAGE}&offset=${page * PAGE}`);
      if (id !== rowReq.current) return;
      setRows((r.rows || []).map(asNscRow));
      setTotal(r.total || 0);
    } catch (e) {
      if (id !== rowReq.current) return;
      if (!rows.length) setError(e instanceof Error ? e.message : 'Failed to load NSC');
    }
  };

  useEffect(() => {
    loadDesk();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterQs]);

  useEffect(() => {
    if (view !== 'cases') return;
    loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterQs, page, view]);

  const divisions = desk?.divisions || [];
  const cccs = desk?.cccs || [];
  const classes = desk?.classes || [];
  const timelineYears = desk?.years || [];
  const byDivision = desk?.by_division || [];
  const byCcc = desk?.by_ccc || [];
  const slabOrder = new Map(NSC_SLABS.map((s, i) => [s.id, i]));
  const bySlab = (desk?.by_slab || [])
    .filter((s) => s.id !== 'unknown')
    .sort((a, b) => (slabOrder.get(a.id) ?? 99) - (slabOrder.get(b.id) ?? 99))
    .map((s) => ({ ...s, fill: SLAB_COLORS[s.id] || '#94a3b8' }));
  const reasons = desk?.reasons || [];
  const timeline = desk?.timeline || [];
  const timelineDivisions = desk?.timeline_divisions || [];
  const reportDate = desk?.report_date || null;
  const viewCount = desk?.view || 0;
  const stuck30 = desk?.stuck_30 ?? bySlab.filter((s) => HOT_IDS.has(s.id)).reduce((s, r) => s + r.count, 0);
  const stuck180 = desk?.stuck_180 ?? bySlab.filter((s) => s.id === 'm6_12' || s.id === 'y1').reduce((s, r) => s + r.count, 0);
  const stuckPct = viewCount ? Math.round((1000 * stuck30) / viewCount) / 10 : 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE));
  const worstCcc = byCcc[0];

  const mixTotal = desk?.mix_total || bySlab.reduce((s, r) => s + r.count, 0);
  const countById = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of bySlab) m.set(s.id, s.count);
    for (const s of desk?.by_cumulative || []) m.set(s.id, s.count);
    return m;
  }, [bySlab, desk?.by_cumulative]);
  const rangeRows = mergeDelayCuts(customCuts, band === 'exclusive');
  const mixRows = rangeRows.map((row) => {
    const fill = row.cut
      ? row.custom
        ? customCutFill(row.cut)
        : CUM_COLORS[row.id] || '#64748b'
      : SLAB_COLORS[row.id] || '#94a3b8';
    return {
      id: row.id,
      name: row.label,
      count: countById.get(row.id) || 0,
      fill,
      custom: row.custom,
      cut: row.cut,
    };
  });

  const switchBand = (next: DelayBand) => {
    setBand(next);
    setSlab('');
    setCumId('');
    setDelayMin('');
    setDelayMax('');
    if (next === 'cumulative' && (view === 'bottleneck' || view === 'delay')) setView('delay');
  };

  const applyCut = (cut: DelayCut) => {
    const same = cumId === cut.id;
    setSlab('');
    if (same) {
      setCumId('');
      setDelayMin('');
      setDelayMax('');
      return;
    }
    setCumId(cut.id);
    if (cut.op === 'le') {
      setDelayMin(0);
      setDelayMax(cut.days);
    } else if (cut.op === 'gt') {
      setDelayMin(cut.days + 1);
      setDelayMax('');
    } else {
      setDelayMin(cut.days);
      setDelayMax(cut.daysMax ?? cut.days);
    }
  };

  const persistCuts = (next: DelayCut[]) => {
    setCustomCuts(next);
    saveCustomDelayCuts(cutStoreKey, next);
  };

  const addCustomRange = () => {
    const cut = makeCustomCut(customOp, customA, customOp === 'bt' ? customB : undefined);
    if (!cut) return;
    const builtIn = NSC_CUMULATIVE.find((c) => c.op === cut.op && c.days === cut.days && cut.op !== 'bt');
    if (builtIn) {
      applyCut(builtIn);
      setView('delay');
      return;
    }
    const existing = customCuts.find((c) => c.id === cut.id);
    if (existing) {
      applyCut(existing);
      setView('delay');
      return;
    }
    if (customCuts.length >= 12) return;
    persistCuts([...customCuts, cut]);
    applyCut(cut);
    setView('delay');
  };

  const removeCustomRange = (id: string) => {
    persistCuts(customCuts.filter((c) => c.id !== id));
    if (cumId === id) {
      setCumId('');
      setDelayMin('');
      setDelayMax('');
    }
  };

  const selectMixRow = (row: (typeof mixRows)[number]) => {
    if (row.cut) {
      applyCut(row.cut);
      return;
    }
    setCumId('');
    setDelayMin('');
    setDelayMax('');
    setSlab((prev) => (prev === row.id ? '' : row.id));
  };

  const delayActive = delayMin !== '' || delayMax !== '' || !!slab;
  const appliedCut =
    mixRows.find((r) => r.id === cumId)?.cut ||
    NSC_CUMULATIVE.find((c) => c.id === cumId) ||
    customCuts.find((c) => c.id === cumId);
  const rangeLabel = appliedCut
    ? appliedCut.label
    : slab
      ? NSC_SLABS.find((s) => s.id === slab)?.label || ''
      : delayMin !== '' && delayMax !== ''
        ? delayMin === 0
          ? `≤${delayMax}d`
          : `${delayMin}–${delayMax}d`
        : delayMin !== ''
          ? `>${Math.max(0, Number(delayMin) - 1)}d`
          : delayMax !== ''
            ? `≤${delayMax}d`
            : '';

  const poleMix = desk?.pole;
  const byPoleBin = desk?.by_pole_bin || [];
  const poleHint =
    pole === 'non_pole'
      ? 'Non-pole'
      : pole === 'pole'
        ? poleMin !== '' || poleMax !== ''
          ? `${poleMin || 1}${poleMax !== '' ? `–${poleMax}` : '+'} poles`
          : 'Pole'
        : pole === 'unknown'
          ? 'Not recorded'
          : '';

  const applyPoleBin = (b: { id: string; min?: number; max?: number | null }) => {
    if (b.id === 'p0') {
      setPoleMin('');
      setPoleMax('');
      setPole((prev) => (prev === 'non_pole' ? '' : 'non_pole'));
      return;
    }
    const min = b.min ?? 1;
    const max = b.max == null ? ('' as const) : b.max;
    const same = pole === 'pole' && poleMin === min && poleMax === max;
    if (same) {
      setPole('');
      setPoleMin('');
      setPoleMax('');
      return;
    }
    setPole('pole');
    setPoleMin(min);
    setPoleMax(max);
  };

  const openPoleCases = (kind: string) => {
    setPole(kind);
    setPoleMin('');
    setPoleMax('');
    setView('cases');
  };

  const procMix = desk?.procedure;
  const procHint = procedure === 'proc_b' ? 'Proc. B' : procedure === 'proc_a' ? 'Individual' : '';
  const openProcCases = (id: string) => {
    if (id === 'proc_b') {
      setProcedure('');
      setView('procedure');
      return;
    }
    setProcedure(id);
    setView('cases');
  };

  const openCcc = (code?: string) => {
    if (code) setCcc(code);
    setView('cases');
  };

  const openDivision = (code?: string) => {
    if (code) {
      setDivision(code);
      setCcc('');
    }
    setView('cases');
  };

  const onTimelineClick = (state: { activePayload?: { payload?: { key?: string } }[] }) => {
    const key = state?.activePayload?.[0]?.payload?.key;
    if (!key) return;
    setTimeKey((prev) => (prev === key ? (key.length === 7 ? key.slice(0, 4) : '') : key));
  };

  const download = async () => {
    setExporting(true);
    setError('');
    try {
      await api.nscExport(filterQs);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const filteredHint = [
    division && divisions.find((d) => d.code === division)?.name,
    ccc && cccs.find((c) => c.code === ccc)?.name,
    rangeLabel,
    poleHint,
    procHint,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="stack nsc-desk">
      <div className="panel nsc-head">
        <div className="panel-head">
          <div>
            <h2 style={{ marginBottom: 0 }}>Pending NSC</h2>
            <p className="muted tight">
              {reportDate ? `As on ${fmtDay(reportDate)}` : 'No snapshot yet'}
              {filteredHint ? ` · ${filteredHint}` : ''}
              {loading ? ' · updating…' : ''}
            </p>
          </div>
          <div className="nsc-head-actions">
            <button type="button" className="btn secondary" onClick={() => { loadDesk(); if (view === 'cases') loadRows(); }} disabled={loading}>
              Refresh
            </button>
            <button type="button" className="btn secondary" disabled={!viewCount || exporting} onClick={download}>
              {exporting ? 'Preparing…' : 'Download'}
            </button>
            {canUpload && (
              <a className="btn" href="/upload?module=nsc">
                Upload
              </a>
            )}
          </div>
        </div>

        <div className="nsc-cards">
          <div className="kpi">
            <div className="label">Pending</div>
            <div className="value">{fmtInt(desk?.pending || 0)}</div>
          </div>
          <div className="kpi">
            <div className="label">Withheld</div>
            <div className="value">{fmtInt(desk?.withheld || 0)}</div>
          </div>
          <div className="kpi nsc-kpi-warn">
            <div className="label">Stuck &gt;30d</div>
            <div className="value">{fmtInt(stuck30)}</div>
            <div className="muted tight">{stuckPct}%</div>
          </div>
          <div className="kpi nsc-kpi-alert">
            <div className="label">Stuck &gt;6m</div>
            <div className="value">{fmtInt(stuck180)}</div>
          </div>
          <div className="kpi">
            <div className="label">Avg age</div>
            <div className="value">{desk?.avg_days || 0}d</div>
          </div>
          <button type="button" className={`nsc-pole-kpi non ${pole === 'non_pole' && poleMin === '' ? 'on' : ''}`} onClick={() => openPoleCases('non_pole')}>
            <span className="label">Non-pole</span>
            <strong>{fmtInt(poleMix?.non_pole || 0)}</strong>
          </button>
          <button type="button" className={`nsc-pole-kpi pole ${pole === 'pole' ? 'on' : ''}`} onClick={() => openPoleCases('pole')}>
            <span className="label">Pole</span>
            <strong>{fmtInt(poleMix?.pole || 0)}</strong>
            <span className="muted tight">{fmtInt(poleMix?.poles_sum || 0)} poles</span>
          </button>
          <button type="button" className={`nsc-proc-card ${procedure === 'proc_a' ? 'on' : ''}`} onClick={() => openProcCases('proc_a')}>
            <span className="nsc-proc-kicker">Proc. A</span>
            <strong>{fmtInt(procMix?.proc_a || 0)}</strong>
            <span className="muted tight">&gt;30d {fmtInt(procMix?.hot_proc_a || 0)}</span>
          </button>
          <button type="button" className={`nsc-proc-card b ${procedure === 'proc_b' || view === 'procedure' ? 'on' : ''}`} onClick={() => openProcCases('proc_b')}>
            <span className="nsc-proc-kicker">Proc. B</span>
            <strong>{fmtInt(procMix?.proc_b || 0)}</strong>
            <span className="muted tight">&gt;30d {fmtInt(procMix?.hot_proc_b || 0)}</span>
          </button>
        </div>

        <div className="nsc-toolbar">
          <div className="hier-tabs" role="tablist" aria-label="NSC queue">
            <button type="button" className={`hier-tab ${queue === 'pending' ? 'on' : ''}`} onClick={() => setQueue('pending')}>
              Pending
            </button>
            <button type="button" className={`hier-tab ${queue === 'withheld' ? 'on' : ''}`} onClick={() => setQueue('withheld')}>
              Withheld
            </button>
          </div>
          <div className="hier-tabs" role="tablist" aria-label="Delay clock">
            <button type="button" className={`hier-tab ${clock === 'quotation' ? 'on' : ''}`} onClick={() => setClock('quotation')}>
              After collection
            </button>
            <button type="button" className={`hier-tab ${clock === 'processing' ? 'on' : ''}`} onClick={() => setClock('processing')}>
              Create → collection
            </button>
          </div>
          <div className="hier-tabs" role="tablist" aria-label="Delay range type">
            <button type="button" className={`hier-tab ${band === 'exclusive' ? 'on' : ''}`} onClick={() => switchBand('exclusive')}>
              Slabs
            </button>
            <button type="button" className={`hier-tab ${band === 'cumulative' ? 'on' : ''}`} onClick={() => switchBand('cumulative')}>
              Cumulative
            </button>
          </div>
        </div>

        <div className="filters nsc-filters">
          <select
            value={division}
            onChange={(e) => {
              setDivision(e.target.value);
              setCcc('');
            }}
          >
            <option value="">Division</option>
            {divisions.map((d) => (
              <option key={d.code} value={d.code}>
                {d.name}
              </option>
            ))}
          </select>
          <select value={ccc} onChange={(e) => setCcc(e.target.value)}>
            <option value="">CCC</option>
            {cccs.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
          <select value={klass} onChange={(e) => setKlass(e.target.value)}>
            <option value="">Class</option>
            {classes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={pole}
            onChange={(e) => {
              setPole(e.target.value);
              setPoleMin('');
              setPoleMax('');
            }}
          >
            <option value="">Work</option>
            <option value="non_pole">Non-pole</option>
            <option value="pole">Pole</option>
            {(poleMix?.unknown || 0) > 0 && <option value="unknown">Not recorded</option>}
          </select>
          <select value={procedure} onChange={(e) => setProcedure(e.target.value)}>
            <option value="">Applicant</option>
            <option value="proc_a">Individual</option>
            <option value="proc_b">Proc. B</option>
          </select>
          {band === 'exclusive' && (
            <select
              value={slab}
              onChange={(e) => {
                setSlab(e.target.value);
                setCumId('');
                setDelayMin('');
                setDelayMax('');
              }}
            >
              <option value="">Slab</option>
              {NSC_SLABS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          )}
          {queue === 'withheld' && (
            <select value={timeKey.slice(0, 4)} onChange={(e) => setTimeKey(e.target.value)}>
              <option value="">All years</option>
              {timelineYears.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          )}
          <input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          {(division || ccc || klass || pole || procedure || slab || timeKey || q || delayActive) && (
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                setDivision('');
                setCcc('');
                setKlass('');
                setPole('');
                setPoleMin('');
                setPoleMax('');
                setProcedure('');
                setSlab('');
                setCumId('');
                setDelayMin('');
                setDelayMax('');
                setTimeKey('');
                setQ('');
              }}
            >
              Clear
            </button>
          )}
        </div>
        {error && <p className="error">{error}</p>}
      </div>

      <div className="hier-tabs nsc-views" role="tablist" aria-label="NSC views">
        <button type="button" className={`hier-tab ${view === 'bottleneck' ? 'on' : ''}`} onClick={() => setView('bottleneck')}>
          Bottlenecks
        </button>
        <button type="button" className={`hier-tab ${view === 'poles' ? 'on' : ''}`} onClick={() => setView('poles')}>
          Pole
        </button>
        <button type="button" className={`hier-tab ${view === 'procedure' ? 'on' : ''}`} onClick={() => setView('procedure')}>
          Proc. B
        </button>
        <button type="button" className={`hier-tab ${view === 'delay' ? 'on' : ''}`} onClick={() => setView('delay')}>
          Delay
        </button>
        <button type="button" className={`hier-tab ${view === 'offices' ? 'on' : ''}`} onClick={() => setView('offices')}>
          Offices
        </button>
        {queue === 'withheld' && (
          <button type="button" className={`hier-tab ${view === 'history' ? 'on' : ''}`} onClick={() => setView('history')}>
            History
          </button>
        )}
        <button type="button" className={`hier-tab ${view === 'cases' ? 'on' : ''}`} onClick={() => setView('cases')}>
          Cases
        </button>
      </div>

      {view === 'bottleneck' && (
        <div className="nsc-focus">
          <div className="panel nsc-callout">
            {worstCcc ? (
              <p className="nsc-callout-body">
                <strong>{worstCcc.name}</strong>
                <span className="muted">
                  {fmtInt(worstCcc.hot || 0)} &gt;30d{worstCcc.hot_pct ? ` · ${worstCcc.hot_pct}%` : ''}
                </span>
              </p>
            ) : (
              <p className="muted">None</p>
            )}
            {worstCcc?.code && (
              <button type="button" className="btn" onClick={() => openCcc(worstCcc.code)}>
                Cases
              </button>
            )}
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2 style={{ marginBottom: 0 }}>CCC</h2>
            </div>
            <div className="nsc-heat-list">
              {byCcc.map((c) => {
                const totalC = c.count || 1;
                const onTrack = Math.max(0, totalC - (c.hot || 0) - 0);
                const hot = c.hot || 0;
                const critical = c.critical || 0;
                const mid = Math.max(0, hot - critical);
                return (
                  <button key={c.code || c.name} type="button" className="nsc-heat-row" onClick={() => openCcc(c.code)}>
                    <div className="nsc-heat-meta">
                      <span className="nsc-heat-name">{c.name}</span>
                      <span className="muted">
                        {fmtInt(hot)} · {c.hot_pct || 0}% · {c.avg_days || 0}d
                      </span>
                    </div>
                    <div className="nsc-heat-bar" aria-hidden>
                      <span style={{ width: `${(100 * onTrack) / totalC}%` }} className="nsc-heat-ok" />
                      <span style={{ width: `${(100 * mid) / totalC}%` }} className="nsc-heat-mid" />
                      <span style={{ width: `${(100 * critical) / totalC}%` }} className="nsc-heat-bad" />
                    </div>
                  </button>
                );
              })}
              {!byCcc.length && <p className="muted">None</p>}
            </div>
            <div className="nsc-heat-legend muted">
              <span className="nsc-dot ok" /> ≤30d
              <span className="nsc-dot mid" /> 31d–6m
              <span className="nsc-dot bad" /> &gt;6m
            </div>
          </div>
        </div>
      )}

      {view === 'poles' && (
        <div className="stack">
          <div className="nsc-focus">
            <div className="panel nsc-callout">
              <p className="nsc-callout-body">
                {(poleMix?.unknown || 0) > 0 && !(poleMix?.pole || poleMix?.non_pole) ? (
                  <span>Poles not in this snapshot.</span>
                ) : (
                  <span>
                    {fmtInt(poleMix?.hot_non_pole || 0)} non-pole &gt;30d · {fmtInt(poleMix?.hot_pole || 0)} pole &gt;30d
                  </span>
                )}
              </p>
              <div className="nsc-pole-actions">
                <button type="button" className="btn" onClick={() => openPoleCases('non_pole')}>
                  Non-pole
                </button>
                <button type="button" className="btn secondary" onClick={() => openPoleCases('pole')}>
                  Pole
                </button>
              </div>
            </div>
            <div className="panel">
              <div className="panel-head">
                <h2 style={{ marginBottom: 0 }}>Poles</h2>
              </div>
              <div className="nsc-mix">
                {byPoleBin.map((s) => {
                  const pct = mixTotal ? Math.round((1000 * s.count) / mixTotal) / 10 : 0;
                  const on =
                    s.id === 'p0'
                      ? pole === 'non_pole' && poleMin === ''
                      : pole === 'pole' && poleMin === (s.min ?? 1) && (s.max == null ? poleMax === '' : poleMax === s.max);
                  return (
                    <div key={s.id} className={`nsc-mix-row ${on ? 'on' : ''}`}>
                      <button type="button" className="nsc-mix-main" onClick={() => applyPoleBin(s)}>
                        <span className="nsc-mix-label">{s.name}</span>
                        <span className="nsc-mix-track">
                          <span
                            className="nsc-mix-fill"
                            style={{ width: `${Math.max(pct, s.count ? 1.5 : 0)}%`, background: s.id === 'p0' ? '#059669' : '#ea580c' }}
                          />
                        </span>
                        <span className="nsc-mix-count">
                          {fmtInt(s.count)} <span className="muted">{pct}%</span>
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="panel">
            <div className="panel-head">
              <h2 style={{ marginBottom: 0 }}>CCC</h2>
            </div>
            <div className="nsc-heat-list">
              {[...byCcc]
                .sort((a, b) => (b.hot_pole || 0) - (a.hot_pole || 0) || (b.pole || 0) - (a.pole || 0))
                .map((c) => {
                  const totalC = c.count || 1;
                  const non = c.non_pole || 0;
                  const yes = c.pole || 0;
                  return (
                    <button key={c.code || c.name} type="button" className="nsc-heat-row" onClick={() => openCcc(c.code)}>
                      <div className="nsc-heat-meta">
                        <span className="nsc-heat-name">{c.name}</span>
                        <span className="muted">
                          {fmtInt(non)} non-pole · {fmtInt(yes)} pole · {fmtInt(c.hot_pole || 0)} &gt;30d
                        </span>
                      </div>
                      <div className="nsc-heat-bar" aria-hidden>
                        <span style={{ width: `${(100 * non) / totalC}%` }} className="nsc-heat-ok" />
                        <span style={{ width: `${(100 * yes) / totalC}%` }} className="nsc-heat-mid" />
                      </div>
                    </button>
                  );
                })}
              {!byCcc.length && <p className="muted">None</p>}
            </div>
          </div>
        </div>
      )}

      {view === 'procedure' && (
        <div className="stack">
          <div className="panel nsc-callout">
            <p className="nsc-callout-body">
              {fmtInt(procMix?.proc_b || 0)} Proc. B · {fmtInt(procMix?.hot_proc_b || 0)} &gt;30d
            </p>
            <div className="nsc-pole-actions">
              <button type="button" className="btn" onClick={() => { setProcedure('proc_b'); setView('cases'); }}>
                Proc. B
              </button>
              <button type="button" className="btn secondary" onClick={() => { setProcedure('proc_a'); setView('cases'); }}>
                Individual
              </button>
            </div>
          </div>
          <div className="panel">
            <h2>Division</h2>
            <div className="table-wrap nsc-crosstab">
              <table>
                <thead>
                  <tr>
                    <th>Division</th>
                    <th>Individual</th>
                    <th>Proc. B</th>
                    <th>&gt;30d</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {byDivision.map((d) => (
                    <tr key={String(d.name)}>
                      <td>
                        <button type="button" className="linkish" onClick={() => openDivision(String(d.code || ''))}>
                          {d.name}
                        </button>
                      </td>
                      <td>
                        <button type="button" className="linkish" onClick={() => { setProcedure('proc_a'); setView('cases'); }}>
                          {fmtInt(num(d.proc_a))}
                        </button>
                      </td>
                      <td>
                        <button type="button" className="linkish" onClick={() => { setProcedure('proc_b'); setView('cases'); }}>
                          {fmtInt(num(d.proc_b))}
                        </button>
                      </td>
                      <td>{fmtInt(num(d.hot_proc_b))}</td>
                      <td>
                        <strong>{fmtInt(num(d.total))}</strong>
                      </td>
                    </tr>
                  ))}
                  {!byDivision.length && (
                    <tr>
                      <td colSpan={5} className="muted">
                        None
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className="panel">
            <h2>CCC</h2>
            <div className="table-wrap nsc-crosstab">
              <table>
                <thead>
                  <tr>
                    <th>CCC</th>
                    <th>Proc. B</th>
                    <th>&gt;30d</th>
                    <th>Individual</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {[...byCcc]
                    .filter((c) => (c.proc_b || 0) > 0)
                    .sort((a, b) => (b.hot_proc_b || 0) - (a.hot_proc_b || 0) || (b.proc_b || 0) - (a.proc_b || 0))
                    .map((c) => (
                      <tr key={c.code || c.name}>
                        <td>
                          <button type="button" className="linkish" onClick={() => openCcc(c.code)}>
                            {c.name}
                          </button>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="linkish"
                            onClick={() => {
                              setProcedure('proc_b');
                              if (c.code) setCcc(c.code);
                              setView('cases');
                            }}
                          >
                            {fmtInt(c.proc_b || 0)}
                          </button>
                        </td>
                        <td>{fmtInt(c.hot_proc_b || 0)}</td>
                        <td>{fmtInt(c.proc_a || 0)}</td>
                        <td>
                          <strong>{fmtInt(c.count || 0)}</strong>
                        </td>
                      </tr>
                    ))}
                  {!byCcc.some((c) => (c.proc_b || 0) > 0) && (
                    <tr>
                      <td colSpan={5} className="muted">
                        None
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {view === 'delay' && (
        <div className="stack">
          <div className="panel">
            <div className="nsc-custom">
              <select value={customOp} onChange={(e) => setCustomOp(e.target.value as DelayOp)}>
                <option value="le">≤</option>
                <option value="gt">&gt;</option>
                <option value="bt">–</option>
              </select>
              <input
                type="number"
                min={0}
                value={customA}
                onChange={(e) => setCustomA(Number(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addCustomRange();
                }}
                aria-label={customOp === 'bt' ? 'From days' : 'Days'}
              />
              {customOp === 'bt' && (
                <input
                  type="number"
                  min={0}
                  value={customB}
                  onChange={(e) => setCustomB(Number(e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addCustomRange();
                  }}
                  aria-label="To days"
                />
              )}
              <span className="muted">days</span>
              <button type="button" className="btn" onClick={addCustomRange}>
                Add
              </button>
            </div>
            <div className="nsc-mix">
              {mixRows.map((s) => {
                const pct = mixTotal ? Math.round((1000 * s.count) / mixTotal) / 10 : 0;
                const on = s.cut ? cumId === s.id : slab === s.id;
                return (
                  <div key={s.id} className={`nsc-mix-row ${on ? 'on' : ''} ${s.custom ? 'nsc-mix-custom' : ''}`}>
                    <button type="button" className="nsc-mix-main" onClick={() => selectMixRow(s)}>
                      <span className="nsc-mix-label">
                        {s.name}
                        {s.custom ? <span className="nsc-mix-local">*</span> : null}
                      </span>
                      <span className="nsc-mix-track">
                        <span className="nsc-mix-fill" style={{ width: `${Math.max(pct, s.count ? 1.5 : 0)}%`, background: s.fill }} />
                      </span>
                      <span className="nsc-mix-count">
                        {fmtInt(s.count)} <span className="muted">{pct}%</span>
                      </span>
                    </button>
                    {s.custom && (
                      <button type="button" className="nsc-mix-remove" aria-label={`Remove ${s.name}`} onClick={() => removeCustomRange(s.id)}>
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="panel">
            <h2>Division</h2>
            <div className="table-wrap nsc-crosstab">
              <table>
                <thead>
                  <tr>
                    <th>Division</th>
                    {mixRows.map((s) => (
                      <th key={s.id} className={cumId === s.id || slab === s.id ? 'nsc-cut-on' : ''}>
                        {s.name}
                        {s.custom ? ' *' : ''}
                      </th>
                    ))}
                    {band === 'exclusive' && <th>&gt;30d</th>}
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {byDivision.map((d) => (
                    <tr key={String(d.name)}>
                      <td>
                        <button type="button" className="linkish" onClick={() => openDivision(String(d.code || ''))}>
                          {d.name}
                        </button>
                      </td>
                      {mixRows.map((s) => (
                        <td key={s.id} className={cumId === s.id || slab === s.id ? 'nsc-cut-on' : ''}>
                          <button type="button" className="linkish" onClick={() => selectMixRow(s)}>
                            {fmtInt(num(d[s.id]))}
                          </button>
                        </td>
                      ))}
                      {band === 'exclusive' && <td>{fmtInt(num(d.hot))}</td>}
                      <td>
                        <strong>{fmtInt(num(d.total))}</strong>
                      </td>
                    </tr>
                  ))}
                  {!byDivision.length && (
                    <tr>
                      <td colSpan={12} className="muted">
                        None
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {view === 'offices' && (
        <div className="stack">
          <div className="panel">
            <h2>Division</h2>
            <div style={{ width: '100%', height: CHART_H }}>
              <ResponsiveContainer>
                <BarChart data={byDivision} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,64,120,0.08)" />
                  <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 11 }} interval={0} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 11 }} allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {band === 'cumulative'
                    ? mixRows
                        .filter((s) => s.cut?.op === 'gt')
                        .map((s) => (
                          <Bar
                            key={s.id}
                            dataKey={s.id}
                            name={s.name}
                            fill={s.fill}
                            cursor="pointer"
                            onClick={() => s.cut && applyCut(s.cut)}
                          />
                        ))
                    : NSC_SLABS.map((s) => (
                        <Bar
                          key={s.id}
                          dataKey={s.id}
                          name={s.label}
                          stackId="a"
                          fill={SLAB_COLORS[s.id]}
                          cursor="pointer"
                          onClick={() => {
                            switchBand('exclusive');
                            setSlab(s.id);
                          }}
                        />
                      ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          {queue === 'withheld' && reasons.length > 0 && (
            <div className="panel">
              <h2>Reasons</h2>
              <div className="nsc-reason-list">
                {reasons.map((r) => (
                  <div key={r.name} className="nsc-reason-row">
                    <span>{r.name}</span>
                    <strong>{fmtInt(r.count)}</strong>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {view === 'history' && queue === 'withheld' && (
        <div className="panel nsc-timeline">
          <div className="panel-head">
            <div>
              <h2 style={{ marginBottom: 0 }}>
                {timeKey.length === 7
                  ? `${String(timeline.find((p) => p.key === timeKey)?.label || timeKey)} ${timeKey.slice(0, 4)}`
                  : timeKey
                    ? timeKey
                    : 'Timeline'}
              </h2>
            </div>
            {timeKey && (
              <button type="button" className="btn secondary" onClick={() => setTimeKey(timeKey.length === 7 ? timeKey.slice(0, 4) : '')}>
                {timeKey.length === 7 ? `Back to ${timeKey.slice(0, 4)}` : 'All years'}
              </button>
            )}
          </div>
          <div style={{ width: '100%', height: TIMELINE_H }}>
            <ResponsiveContainer>
              <ComposedChart data={timeline} margin={{ top: 12, right: 16, left: 0, bottom: 0 }} onClick={onTimelineClick}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,64,120,0.08)" />
                <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 11 }} />
                <YAxis yAxisId="left" tick={{ fill: '#64748b', fontSize: 11 }} allowDecimals={false} tickFormatter={(v) => fmtInt(Number(v))} />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  allowDecimals={false}
                  tickFormatter={(v) => fmtInt(Number(v))}
                />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value, name) => [fmtInt(Number(value ?? 0)), String(name)]} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {timelineDivisions.map((d, i) => (
                  <Bar key={d} yAxisId="left" dataKey={d} name={d} stackId="held" fill={DIV_PALETTE[i % DIV_PALETTE.length]} cursor="pointer" />
                ))}
                <Line yAxisId="right" type="monotone" dataKey="cumulative" name="Open" stroke="#b91c1c" strokeWidth={2.4} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {view === 'cases' && (
        <div className="panel">
          <div className="panel-head">
            <h2 style={{ marginBottom: 0 }}>
              Cases
              <span className="muted" style={{ fontWeight: 500, marginLeft: 8 }}>
                {fmtInt(total)} · page {page + 1}/{pageCount}
              </span>
            </h2>
            <div className="nsc-pager">
              <button type="button" className="btn secondary" disabled={page <= 0} onClick={() => setPage((p) => p - 1)}>
                Prev
              </button>
              <button type="button" className="btn secondary" disabled={page + 1 >= pageCount} onClick={() => setPage((p) => p + 1)}>
                Next
              </button>
            </div>
          </div>
          <div className="table-wrap">
            <table className="nsc-detail">
              <thead>
                <tr>
                  <th>Application</th>
                  <th>CCC</th>
                  <th>Class</th>
                  <th>Work</th>
                  <th>Procedure</th>
                  <th>Age</th>
                  <th>Agency</th>
                  <th>WO</th>
                  <th>Collected</th>
                  {queue === 'withheld' && <th>Withheld</th>}
                  {queue === 'withheld' && <th>Reason</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const age = daysOf(r, clock);
                  return (
                    <tr key={r.application_no}>
                      <td>{r.application_no}</td>
                      <td>{r.ccc_name}</td>
                      <td>{r.consumer_class}</td>
                      <td>{poleLabel(r.pole_kind, r.pole_count)}</td>
                      <td>{procedureLabel(r.procedure, r.applicant_type)}</td>
                      <td className={ageTone(age)}>{age ?? '—'}</td>
                      <td>{r.agency_name || '—'}</td>
                      <td>{r.wo_no || '—'}</td>
                      <td>{fmtDay(r.collected_on)}</td>
                      {queue === 'withheld' && <td>{fmtDay(r.withheld_on)}</td>}
                      {queue === 'withheld' && <td>{r.withheld_reason || '—'}</td>}
                    </tr>
                  );
                })}
                {!rows.length && (
                  <tr>
                    <td colSpan={9} className="muted">
                      {loading ? 'Loading…' : 'None'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
