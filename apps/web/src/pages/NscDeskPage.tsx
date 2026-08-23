import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
  NSC_SLABS,
  SLAB_COLORS,
  asNscRow,
  daysOf,
  fmtDay,
  fmtInt,
  type NscClock,
  type NscQueue,
  type NscRow,
} from '../lib/nsc';

const PAGE = 80;
const CHART_H = 280;
const TIMELINE_H = 340;
const DIV_PALETTE = ['#1565c0', '#039be5', '#00838f', '#7c4dff', '#ef6c00', '#c62828'];

const TOOLTIP_STYLE = {
  background: '#ffffff',
  border: '1px solid rgba(30,64,120,0.12)',
  borderRadius: 12,
  color: '#1e293b',
};

type NscDesk = Awaited<ReturnType<typeof api.nscDesk>>;

function qsOf(p: Record<string, string | number | undefined>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined || v === '') continue;
    u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}

export function NscDeskPage() {
  const { user } = useAuth();
  const canUpload = canUploadModule(user, 'nsc');
  const [desk, setDesk] = useState<NscDesk | null>(null);
  const [rows, setRows] = useState<NscRow[]>([]);
  const [total, setTotal] = useState(0);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [queue, setQueue] = useState<NscQueue>('pending');
  const [clock, setClock] = useState<NscClock>('quotation');
  const [division, setDivision] = useState('');
  const [ccc, setCcc] = useState('');
  const [klass, setKlass] = useState('');
  const [slab, setSlab] = useState('');
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [page, setPage] = useState(0);
  const [timeKey, setTimeKey] = useState('');
  const deskReq = useRef(0);
  const rowReq = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const filterQs = useMemo(
    () =>
      qsOf({
        queue,
        clock,
        division,
        ccc,
        class: klass,
        slab,
        time: timeKey,
        q: qDebounced,
      }),
    [queue, clock, division, ccc, klass, slab, timeKey, qDebounced]
  );

  useEffect(() => {
    setPage(0);
  }, [filterQs]);

  useEffect(() => {
    if (queue !== 'withheld') setTimeKey('');
  }, [queue]);

  const loadDesk = async () => {
    const id = ++deskReq.current;
    setLoading(true);
    setError('');
    try {
      const next = await api.nscDesk(filterQs);
      if (id !== deskReq.current) return;
      setDesk(next);
      setFetchedAt(Date.now());
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
    loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterQs, page]);

  const divisions = desk?.divisions || [];
  const cccs = desk?.cccs || [];
  const classes = desk?.classes || [];
  const timelineYears = desk?.years || [];
  const byDivision = desk?.by_division || [];
  const byCcc = desk?.by_ccc || [];
  const byClass = desk?.by_class || [];
  const bySlab = (desk?.by_slab || []).map((s) => ({ ...s, fill: SLAB_COLORS[s.id] || '#94a3b8' }));
  const reasons = desk?.reasons || [];
  const timeline = desk?.timeline || [];
  const timelineDivisions = desk?.timeline_divisions || [];
  const reportDate = desk?.report_date || null;
  const pageCount = Math.max(1, Math.ceil(total / PAGE));
  const peakYear = useMemo(() => {
    if (!timeline.length) return null;
    return [...timeline].sort((a, b) => Number(b.added) - Number(a.added))[0];
  }, [timeline]);

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

  return (
    <div className="stack nsc-desk">
      <div className="panel nsc-head">
        <div className="panel-head">
          <div>
            <h2 style={{ marginBottom: 0 }}>Pending NSC</h2>
            <p className="muted tight">
              {reportDate ? `As on ${fmtDay(reportDate)}` : 'No snapshot yet'}
              {fetchedAt ? ` · loaded ${new Date(fetchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}
              {loading ? ' · refreshing…' : ''}
            </p>
          </div>
          <div className="nsc-head-actions">
            <button type="button" className="btn secondary" onClick={() => { loadDesk(); loadRows(); }} disabled={loading}>
              Refresh
            </button>
            <button type="button" className="btn secondary" disabled={!total || exporting} onClick={download}>
              {exporting ? 'Preparing…' : 'Download'}
            </button>
            {canUpload && (
              <a className="btn" href="/upload?module=nsc">
                Upload
              </a>
            )}
          </div>
        </div>

        <div className="kpi-grid nsc-kpis">
          <div className="kpi">
            <div className="label">Pending</div>
            <div className="value">{fmtInt(desk?.pending || 0)}</div>
          </div>
          <div className="kpi">
            <div className="label">Withheld</div>
            <div className="value">{fmtInt(desk?.withheld || 0)}</div>
          </div>
          <div className="kpi">
            <div className="label">This view</div>
            <div className="value">{fmtInt(desk?.view || 0)}</div>
          </div>
          <div className="kpi">
            <div className="label">{clock === 'quotation' ? 'Avg quotation age' : 'Avg processing'}</div>
            <div className="value">{desk?.avg_days || 0}d</div>
          </div>
          <div className="kpi">
            <div className="label">&gt; 1 year</div>
            <div className="value">{fmtInt(desk?.gt_year || 0)}</div>
          </div>
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
            <button
              type="button"
              className={`hier-tab ${clock === 'quotation' ? 'on' : ''}`}
              onClick={() => setClock('quotation')}
            >
              After collection
            </button>
            <button
              type="button"
              className={`hier-tab ${clock === 'processing' ? 'on' : ''}`}
              onClick={() => setClock('processing')}
            >
              Create → collection
            </button>
          </div>
        </div>

        <div className="filters nsc-filters">
          <select value={division} onChange={(e) => { setDivision(e.target.value); setCcc(''); }}>
            <option value="">All divisions</option>
            {divisions.map((d) => (
              <option key={d.code} value={d.code}>
                {d.name}
              </option>
            ))}
          </select>
          <select value={ccc} onChange={(e) => setCcc(e.target.value)}>
            <option value="">All CCCs</option>
            {cccs.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
          <select value={klass} onChange={(e) => setKlass(e.target.value)}>
            <option value="">All classes</option>
            {classes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select value={slab} onChange={(e) => setSlab(e.target.value)}>
            <option value="">All delay slabs</option>
            {NSC_SLABS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
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
          <input placeholder="Application, Con ID, phone, WO, agency" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {error && <p className="error">{error}</p>}
      </div>

      {queue === 'withheld' && (
        <div className="panel nsc-timeline">
          <div className="panel-head">
            <div>
              <h2 style={{ marginBottom: 0 }}>
                {timeKey.length === 7
                  ? `Withheld in ${String(timeline.find((p) => p.key === timeKey)?.label || timeKey)} ${timeKey.slice(0, 4)}`
                  : timeKey
                    ? `Withheld in ${timeKey} — by month`
                    : 'Withheld timeline'}
              </h2>
              <p className="muted tight">
                {timeKey
                  ? 'Bars are cases still withheld that were held in this period. Line is cumulative within the year. Click a month to filter; All years to zoom out.'
                  : 'Each bar is still-open withheld cases by the year they were held. Line is the running backlog. Click a year to see months.'}
                {peakYear ? ` · peak ${String(peakYear.label)}: ${fmtInt(Number(peakYear.added))}` : ''}
              </p>
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
                <YAxis
                  yAxisId="left"
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  allowDecimals={false}
                  tickFormatter={(v) => fmtInt(Number(v))}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  allowDecimals={false}
                  tickFormatter={(v) => fmtInt(Number(v))}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(value, name) => [fmtInt(Number(value ?? 0)), String(name)]}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {timelineDivisions.map((d, i) => (
                  <Bar
                    key={d}
                    yAxisId="left"
                    dataKey={d}
                    name={d}
                    stackId="held"
                    fill={DIV_PALETTE[i % DIV_PALETTE.length]}
                    cursor="pointer"
                  />
                ))}
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="cumulative"
                  name="Cumulative open"
                  stroke="#b91c1c"
                  strokeWidth={2.4}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="nsc-charts">
        <div className="panel">
          <h2>Division × delay slab</h2>
          <div style={{ width: '100%', height: CHART_H }}>
            <ResponsiveContainer>
              <BarChart data={byDivision} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,64,120,0.08)" />
                <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 11 }} interval={0} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {NSC_SLABS.filter((s) => s.id !== 'unknown').map((s) => (
                  <Bar key={s.id} dataKey={s.id} name={s.label} stackId="a" fill={SLAB_COLORS[s.id]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="panel">
          <h2>Delay range</h2>
          <div style={{ width: '100%', height: CHART_H }}>
            <ResponsiveContainer>
              <BarChart data={bySlab} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,64,120,0.08)" />
                <XAxis type="number" tick={{ fill: '#64748b', fontSize: 11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fill: '#64748b', fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                  {bySlab.map((s) => (
                    <Cell key={s.id} fill={s.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="panel">
          <h2>Class</h2>
          <div style={{ width: '100%', height: CHART_H }}>
            <ResponsiveContainer>
              <BarChart data={byClass} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,64,120,0.08)" />
                <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 11 }} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#1a73e8" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="panel">
          <h2>CCC</h2>
          <div style={{ width: '100%', height: CHART_H }}>
            <ResponsiveContainer>
              <BarChart data={byCcc} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,64,120,0.08)" />
                <XAxis type="number" tick={{ fill: '#64748b', fontSize: 11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fill: '#64748b', fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#039be5" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Delay table (division × slab)</h2>
        <div className="table-wrap nsc-crosstab">
          <table>
            <thead>
              <tr>
                <th>Division</th>
                {NSC_SLABS.filter((s) => s.id !== 'unknown').map((s) => (
                  <th key={s.id}>{s.label}</th>
                ))}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {byDivision.map((d) => (
                <tr key={String(d.name)}>
                  <td>{d.name}</td>
                  {NSC_SLABS.filter((s) => s.id !== 'unknown').map((s) => (
                    <td key={s.id}>
                      <button type="button" className="linkish" onClick={() => setSlab(s.id)}>
                        {fmtInt(Number(d[s.id] || 0))}
                      </button>
                    </td>
                  ))}
                  <td>
                    <strong>{fmtInt(Number(d.total || 0))}</strong>
                  </td>
                </tr>
              ))}
              {!byDivision.length && (
                <tr>
                  <td colSpan={10} className="muted">
                    No applications in this view.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {queue === 'withheld' && (
        <div className="panel">
          <h2>Withheld reasons</h2>
          <div style={{ width: '100%', height: 320 }}>
            <ResponsiveContainer>
              <BarChart data={reasons} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,64,120,0.08)" />
                <XAxis type="number" tick={{ fill: '#64748b', fontSize: 11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={220} tick={{ fill: '#64748b', fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#dc2626" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-head">
          <h2 style={{ marginBottom: 0 }}>
            Applications
            <span className="muted" style={{ fontWeight: 500, marginLeft: 8 }}>
              {fmtInt(total)} · page {page + 1}/{pageCount}
            </span>
          </h2>
          <div className="nsc-pager">
            <button type="button" className="btn secondary" disabled={page <= 0} onClick={() => setPage((p) => p - 1)}>
              Prev
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={page + 1 >= pageCount}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="nsc-detail">
            <thead>
              <tr>
                <th>Application</th>
                <th>Con ID</th>
                <th>Class</th>
                <th>Phone</th>
                <th>Division</th>
                <th>CCC</th>
                <th>Agency</th>
                <th>WO</th>
                <th>Quotation</th>
                <th>Collected</th>
                {queue === 'withheld' && <th>Withheld</th>}
                {queue === 'withheld' && <th>Reason</th>}
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.application_no}>
                  <td>{r.application_no}</td>
                  <td>{r.consumer_id || '—'}</td>
                  <td>{r.consumer_class}</td>
                  <td>{r.phone || '—'}</td>
                  <td>{r.division_name}</td>
                  <td>{r.ccc_name}</td>
                  <td>{r.agency_name || '—'}</td>
                  <td>{r.wo_no || '—'}</td>
                  <td>{fmtDay(r.quotation_issue_on)}</td>
                  <td>{fmtDay(r.collected_on)}</td>
                  {queue === 'withheld' && <td>{fmtDay(r.withheld_on)}</td>}
                  {queue === 'withheld' && <td>{r.withheld_reason || '—'}</td>}
                  <td>{daysOf(r, clock) ?? '—'}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={12} className="muted">
                    {loading ? 'Loading…' : 'No rows. Upload a pending-NSC workbook from Upload Center.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
