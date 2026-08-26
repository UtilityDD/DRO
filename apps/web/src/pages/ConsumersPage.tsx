import { FormEvent, useState } from 'react';
import { api } from '../api';
import { ConsumerBubbleMap } from './ConsumerBubbleMap';

export function ConsumersPage() {
  const [tab, setTab] = useState<'map' | 'lookup'>('map');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');

  const search = async (e?: FormEvent) => {
    e?.preventDefault();
    setError('');
    try {
      const r = await api.consumers(q);
      setRows(r.rows);
      setTotal(r.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    }
  };

  const exportCsv = () => {
    const cols = ['consumer_id', 'name', 'ccc_code', 'division_code', 'consumer_class', 'status', 'meter_no'];
    const header = cols.join(',');
    const body = rows
      .map((r) => cols.map((c) => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([`${header}\n${body}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'consumer_master.csv';
    a.click();
  };

  if (tab === 'map') {
    return (
      <div className="cons-shell">
        <div className="hier-tabs cons-tabs" role="tablist" aria-label="Consumer views">
          <button type="button" role="tab" aria-selected className="hier-tab on" onClick={() => setTab('map')}>
            Map
          </button>
          <button type="button" role="tab" aria-selected={false} className="hier-tab" onClick={() => setTab('lookup')}>
            Lookup
          </button>
        </div>
        <ConsumerBubbleMap />
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="hier-tabs cons-tabs" role="tablist" aria-label="Consumer views">
        <button type="button" role="tab" aria-selected={false} className="hier-tab" onClick={() => setTab('map')}>
          Map
        </button>
        <button type="button" role="tab" aria-selected className="hier-tab on" onClick={() => setTab('lookup')}>
          Lookup
        </button>
      </div>
      <div className="panel stack">
        <form className="filters" onSubmit={search}>
          <input
            placeholder="Consumer ID or name"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ minWidth: 220 }}
          />
          <button className="btn" type="submit">
            Search
          </button>
          <button type="button" className="btn secondary" onClick={exportCsv} disabled={!rows.length}>
            Export CSV
          </button>
          <span className="muted">{total ? `${total} in scope (showing ${rows.length})` : ''}</span>
        </form>
        {error && <p className="error">{error}</p>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Consumer ID</th>
                <th>Name</th>
                <th>CCC</th>
                <th>Division</th>
                <th>Class</th>
                <th>Status</th>
                <th>Meter</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={String(r.consumer_id)}>
                  <td>{String(r.consumer_id)}</td>
                  <td>{String(r.name || '')}</td>
                  <td>{String(r.ccc_code || '')}</td>
                  <td>{String(r.division_code || '')}</td>
                  <td>{String(r.consumer_class || '')}</td>
                  <td>
                    <span className={`badge ${String(r.status || '')}`}>{String(r.status || '')}</span>
                  </td>
                  <td>{String(r.meter_no || '')}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={7} className="muted">
                    No rows — upload consumer master or search
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
