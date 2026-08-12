import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';

type Col = { key: string; label: string };

type Props = {
  title: string;
  subtitle?: string;
  columns: Col[];
  load: (query: string) => Promise<{ rows: Record<string, unknown>[]; total?: number }>;
  summary?: ReactNode;
  filters?: ReactNode;
  onRowAction?: (row: Record<string, unknown>) => ReactNode;
  exportName?: string;
};

export function DataPage({ title, subtitle, columns, load, summary, filters, onRowAction, exportName }: Props) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [division, setDivision] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (division) p.set('division', division);
    if (status) p.set('status', status);
    const s = p.toString();
    return s ? `?${s}` : '';
  }, [division, status]);

  useEffect(() => {
    setLoading(true);
    load(query)
      .then((r) => {
        setRows(r.rows);
        setTotal(r.total ?? r.rows.length);
        setError('');
      })
      .catch((e) => setError(e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [query, load, tick]);

  const exportCsv = () => {
    const header = columns.map((c) => c.label).join(',');
    const body = rows
      .map((r) =>
        columns
          .map((c) => {
            const v = r[c.key];
            const s = v == null ? '' : String(v);
            return `"${s.replace(/"/g, '""')}"`;
          })
          .join(',')
      )
      .join('\n');
    const blob = new Blob([`${header}\n${body}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${exportName || title.replace(/\s+/g, '_').toLowerCase()}.csv`;
    a.click();
  };

  const primaryCols = columns.slice(0, 4);
  const restCols = columns.slice(4);

  return (
    <div className="stack">
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2 style={{ marginBottom: 0 }}>{title}</h2>
            {subtitle && <p className="muted tight">{subtitle}</p>}
          </div>
          <button type="button" className="btn secondary" onClick={exportCsv} disabled={!rows.length}>
            Export
          </button>
        </div>
        {summary}
        <div className="filters">
          <select value={division} onChange={(e) => setDivision(e.target.value)} aria-label="Division">
            <option value="">All divisions</option>
            <option value="3412">Siliguri Town</option>
            <option value="3415">Siliguri Sub Urban</option>
            <option value="3413">Kurseong</option>
            <option value="3414">Darjeeling</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            <option value="pending">pending</option>
            <option value="in_progress">in_progress</option>
            <option value="completed">completed</option>
            <option value="open">open</option>
            <option value="closed">closed</option>
            <option value="reconnected">reconnected</option>
          </select>
          {filters}
          <span className="muted filter-count">{loading ? 'Loading…' : `${total} rows`}</span>
        </div>
        {error && <p className="error">{error}</p>}

        {/* Desktop table */}
        <div className="table-wrap desktop-only">
          <table>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
                {onRowAction && <th>Action</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={String(r.id ?? r.application_no ?? r.docket_no ?? r.work_id ?? i)}>
                  {columns.map((c) => (
                    <td key={c.key}>
                      {c.key === 'status' || c.key === 'priority' || c.key === 'billing_status' ? (
                        <span className={`badge ${String(r[c.key] || '')}`}>{String(r[c.key] ?? '')}</span>
                      ) : (
                        String(r[c.key] ?? '')
                      )}
                    </td>
                  ))}
                  {onRowAction && (
                    <td>
                      {onRowAction({
                        ...r,
                        __reload: () => setTick((t) => t + 1),
                      })}
                    </td>
                  )}
                </tr>
              ))}
              {!rows.length && !loading && (
                <tr>
                  <td colSpan={columns.length + (onRowAction ? 1 : 0)} className="muted">
                    No rows in scope
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="mobile-cards mobile-only">
          {rows.map((r, i) => {
            const enriched = { ...r, __reload: () => setTick((t) => t + 1) };
            return (
              <article className="data-card" key={String(r.id ?? r.application_no ?? r.docket_no ?? r.work_id ?? i)}>
                <div className="data-card-top">
                  <div>
                    <div className="data-card-title">{String(r[primaryCols[0]?.key] ?? '—')}</div>
                    <div className="data-card-sub">{String(r[primaryCols[1]?.key] ?? '')}</div>
                  </div>
                  {columns.some((c) => c.key === 'status') && (
                    <span className={`badge ${String(r.status || '')}`}>{String(r.status ?? '')}</span>
                  )}
                </div>
                <div className="data-card-grid">
                  {primaryCols.slice(2).map((c) => (
                    <div key={c.key}>
                      <span className="meta-label">{c.label}</span>
                      <span>{String(r[c.key] ?? '—')}</span>
                    </div>
                  ))}
                  {restCols
                    .filter((c) => c.key !== 'status')
                    .slice(0, 4)
                    .map((c) => (
                      <div key={c.key}>
                        <span className="meta-label">{c.label}</span>
                        <span>
                          {c.key === 'priority' || c.key === 'billing_status' ? (
                            <span className={`badge ${String(r[c.key] || '')}`}>{String(r[c.key] ?? '')}</span>
                          ) : (
                            String(r[c.key] ?? '—')
                          )}
                        </span>
                      </div>
                    ))}
                </div>
                {onRowAction && <div className="data-card-actions">{onRowAction(enriched)}</div>}
              </article>
            );
          })}
          {!rows.length && !loading && <p className="muted empty-state">No rows in scope</p>}
        </div>
      </div>
    </div>
  );
}
