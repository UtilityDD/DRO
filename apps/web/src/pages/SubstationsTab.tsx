import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api, isAdminRole, type Office, type Substation } from '../api';
import { useAuth } from '../auth';

type DivBranch = Office & { cccs: Office[] };

const DIV_COLOR: Record<string, string> = {
  '3412': '#1565c0',
  '3413': '#00897b',
  '3414': '#3949ab',
  '3415': '#0277bd',
};

const STATUS_LABEL: Record<string, string> = {
  in_service: 'In service',
  under_construction: 'Under construction',
  proposed: 'Proposed',
  decommissioned: 'Decommissioned',
};

function blankDraft(divCode = ''): Partial<Substation> {
  return {
    name: '',
    voltage_kv: '33/11',
    capacity_mva: 6.3,
    division_code: divCode,
    ccc_code: '',
    district: 'Darjeeling',
    latitude: null,
    longitude: null,
    feeder_count: null,
    status: 'in_service',
    commissioned_on: '',
    remarks: '',
  };
}

function numOrNull(v: unknown) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtMva(n: number | null | undefined) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function SubstationsTab({ divisions }: { divisions: DivBranch[] }) {
  const { user } = useAuth();
  const isAdmin = isAdminRole(user);
  const [rows, setRows] = useState<Substation[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [divFilter, setDivFilter] = useState('');
  const [q, setQ] = useState('');
  const [selId, setSelId] = useState<number | 'new' | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<Substation>>(blankDraft());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () =>
    api.substations().then((r) => {
      setRows(r.rows);
      setCanEdit(Boolean(r.can_edit && isAdmin));
    });

  useEffect(() => {
    load().catch((e) => setError(e.message || 'Failed to load substations'));
  }, [isAdmin]);

  const selected = selId === 'new' ? null : rows.find((r) => r.id === selId) || null;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (divFilter && r.division_code !== divFilter) return false;
      if (!needle) return true;
      return `${r.name} ${r.ccc_name || ''} ${r.division_name || ''} ${r.voltage_kv}`.toLowerCase().includes(needle);
    });
  }, [rows, divFilter, q]);

  const groups = useMemo(() => {
    const order = divisions.map((d) => d.code);
    const map = new Map<string, Substation[]>();
    for (const r of filtered) {
      const key = r.division_code || 'unassigned';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    const keys = [...new Set([...order, ...map.keys()])].filter((k) => map.has(k));
    return keys.map((code) => {
      const list = (map.get(code) || []).sort((a, b) => a.name.localeCompare(b.name));
      const div = divisions.find((d) => d.code === code);
      return {
        code,
        name: div?.name || list[0]?.division_name || code,
        color: DIV_COLOR[code] || '#1565c0',
        capacity: list.reduce((s, r) => s + (Number(r.capacity_mva) || 0), 0),
        rows: list,
      };
    });
  }, [filtered, divisions]);

  const cccsFor = (divCode: string) => divisions.find((d) => d.code === divCode)?.cccs || [];

  const startEdit = (row?: Substation) => {
    setError('');
    if (row) {
      setSelId(row.id);
      setDraft({ ...row });
    } else {
      setSelId('new');
      setDraft(blankDraft(divFilter || divisions[0]?.code || ''));
    }
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    if (selId === 'new') setSelId(null);
    setDraft(blankDraft());
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = {
        name: String(draft.name || '').trim(),
        voltage_kv: String(draft.voltage_kv || '33/11'),
        capacity_mva: numOrNull(draft.capacity_mva),
        division_code: String(draft.division_code || ''),
        ccc_code: String(draft.ccc_code || ''),
        district: String(draft.district || 'Darjeeling'),
        latitude: numOrNull(draft.latitude),
        longitude: numOrNull(draft.longitude),
        feeder_count: numOrNull(draft.feeder_count),
        status: String(draft.status || 'in_service'),
        commissioned_on: String(draft.commissioned_on || ''),
        remarks: String(draft.remarks || ''),
      };
      const saved =
        selId === 'new'
          ? (await api.createSubstation(body)).row
          : (await api.patchSubstation(selId as number, body)).row;
      await load();
      setSelId(saved.id);
      setEditing(false);
    } catch (err) {
      setError((err as Error).message || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (selId === 'new' || selId == null) return;
    if (!confirm('Delete this substation?')) return;
    setBusy(true);
    try {
      await api.deleteSubstation(selId);
      await load();
      setSelId(null);
      setEditing(false);
    } catch (err) {
      setError((err as Error).message || 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  const lats = filtered.map((r) => Number(r.latitude)).filter((n) => Number.isFinite(n));
  const lons = filtered.map((r) => Number(r.longitude)).filter((n) => Number.isFinite(n));
  const latMin = lats.length ? Math.min(...lats) - 0.04 : 26.45;
  const latMax = lats.length ? Math.max(...lats) + 0.04 : 27.12;
  const lonMin = lons.length ? Math.min(...lons) - 0.04 : 88.12;
  const lonMax = lons.length ? Math.max(...lons) + 0.04 : 88.5;
  const mapW = 420;
  const mapH = 320;
  const xOf = (lon: number) => ((lon - lonMin) / (lonMax - lonMin || 1)) * mapW;
  const yOf = (lat: number) => ((latMax - lat) / (latMax - latMin || 1)) * mapH;

  const inspect = editing ? draft : selected;
  const setField = (key: string, value: string) => setDraft((d) => ({ ...d, [key]: value }));

  return (
    <div className="ss-work">
      <div className="panel ss-list-wrap">
        <div className="ss-toolbar">
          <div className="hier-chips">
            <button type="button" className={`hier-chip${divFilter === '' ? ' on' : ''}`} onClick={() => setDivFilter('')}>
              All
            </button>
            {divisions.map((d) => (
              <button
                type="button"
                key={d.code}
                className={`hier-chip${divFilter === d.code ? ' on' : ''}`}
                style={divFilter === d.code ? { background: DIV_COLOR[d.code], borderColor: DIV_COLOR[d.code] } : undefined}
                onClick={() => setDivFilter(d.code)}
              >
                <i style={{ width: 10, height: 10, background: divFilter === d.code ? '#fff' : DIV_COLOR[d.code] }} />
                {d.name.replace('Siliguri ', '')}
              </button>
            ))}
          </div>
          <input
            className="ss-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search substation"
            aria-label="Search substation"
          />
          {canEdit && (
            <button type="button" className="btn" onClick={() => startEdit()}>
              Add
            </button>
          )}
        </div>
        <p className="muted tight ss-count">
          {filtered.length} of {rows.length} · {fmtMva(filtered.reduce((s, r) => s + (Number(r.capacity_mva) || 0), 0))} MVA
        </p>
        <div className="ss-groups">
          {groups.map((g) => (
            <section key={g.code} className="ss-group">
              <header>
                <b style={{ color: g.color }}>{g.name}</b>
                <span>
                  {g.rows.length} · {fmtMva(g.capacity)} MVA
                </span>
              </header>
              <ul>
                {g.rows.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className={`ss-row${selId === r.id ? ' on' : ''}`}
                      onClick={() => {
                        setSelId(r.id);
                        setEditing(false);
                        setError('');
                      }}
                    >
                      <i style={{ background: g.color }} />
                      <span>
                        <strong>{r.name}</strong>
                        <em>
                          {r.voltage_kv} · {fmtMva(r.capacity_mva)} MVA
                          {r.ccc_name ? ` · ${r.ccc_name}` : ''}
                        </em>
                      </span>
                      <b>{STATUS_LABEL[r.status || ''] || r.status || ''}</b>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {!groups.length && <p className="muted">No substations in this filter.</p>}
        </div>
      </div>

      <aside className="panel ss-inspect">
        {!inspect && !editing ? (
          <p className="muted">Select a 33/11 kV substation to see parameters.</p>
        ) : editing ? (
          <form className="ss-form" onSubmit={save}>
            <p className="hier-kicker">{selId === 'new' ? 'New substation' : 'Edit substation'}</p>
            <label>
              Name
              <input required value={String(draft.name || '')} onChange={(e) => setField('name', e.target.value)} />
            </label>
            <div className="ss-form-row">
              <label>
                Voltage
                <select value={String(draft.voltage_kv || '33/11')} onChange={(e) => setField('voltage_kv', e.target.value)}>
                  <option value="33/11">33/11 kV</option>
                  <option value="132/33">132/33 kV</option>
                  <option value="66/11">66/11 kV</option>
                </select>
              </label>
              <label>
                Capacity (MVA)
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={draft.capacity_mva ?? ''}
                  onChange={(e) => setField('capacity_mva', e.target.value)}
                />
              </label>
            </div>
            <label>
              Division
              <select
                value={String(draft.division_code || '')}
                onChange={(e) => setDraft((d) => ({ ...d, division_code: e.target.value, ccc_code: '' }))}
              >
                <option value="">Select division</option>
                {divisions.map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              CCC
              <select value={String(draft.ccc_code || '')} onChange={(e) => setField('ccc_code', e.target.value)}>
                <option value="">Unassigned</option>
                {cccsFor(String(draft.division_code || '')).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              District
              <input value={String(draft.district || '')} onChange={(e) => setField('district', e.target.value)} />
            </label>
            <div className="ss-form-row">
              <label>
                Latitude
                <input
                  type="number"
                  step="0.000001"
                  value={draft.latitude ?? ''}
                  onChange={(e) => setField('latitude', e.target.value)}
                />
              </label>
              <label>
                Longitude
                <input
                  type="number"
                  step="0.000001"
                  value={draft.longitude ?? ''}
                  onChange={(e) => setField('longitude', e.target.value)}
                />
              </label>
            </div>
            <div className="ss-form-row">
              <label>
                Feeders
                <input
                  type="number"
                  min="0"
                  value={draft.feeder_count ?? ''}
                  onChange={(e) => setField('feeder_count', e.target.value)}
                />
              </label>
              <label>
                Status
                <select value={String(draft.status || 'in_service')} onChange={(e) => setField('status', e.target.value)}>
                  {Object.entries(STATUS_LABEL).map(([k, lab]) => (
                    <option key={k} value={k}>
                      {lab}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Commissioned
              <input type="date" value={String(draft.commissioned_on || '')} onChange={(e) => setField('commissioned_on', e.target.value)} />
            </label>
            <label>
              Remarks
              <textarea rows={2} value={String(draft.remarks || '')} onChange={(e) => setField('remarks', e.target.value)} />
            </label>
            {error && <p className="error">{error}</p>}
            <div className="ss-form-actions">
              <button type="submit" className="btn" disabled={busy}>
                Save
              </button>
              <button type="button" className="btn secondary" onClick={cancelEdit} disabled={busy}>
                Cancel
              </button>
              {selId !== 'new' && (
                <button type="button" className="btn secondary" onClick={remove} disabled={busy}>
                  Delete
                </button>
              )}
            </div>
          </form>
        ) : (
          <>
            <p className="hier-kicker">{inspect?.voltage_kv || '33/11'} kV substation</p>
            <h3>
              {inspect?.name} <span className="code-pill">{inspect?.division_code}</span>
            </h3>
            <p className="hier-stat">
              {fmtMva(inspect?.capacity_mva)}
              <span>MVA</span>
            </p>
            <dl className="ss-meta">
              <div>
                <dt>Division</dt>
                <dd>{inspect?.division_name || '—'}</dd>
              </div>
              <div>
                <dt>CCC</dt>
                <dd>{inspect?.ccc_name || 'Unassigned'}</dd>
              </div>
              <div>
                <dt>District</dt>
                <dd>{inspect?.district || '—'}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{STATUS_LABEL[inspect?.status || ''] || inspect?.status || '—'}</dd>
              </div>
              <div>
                <dt>Latitude</dt>
                <dd>{inspect?.latitude ?? '—'}</dd>
              </div>
              <div>
                <dt>Longitude</dt>
                <dd>{inspect?.longitude ?? '—'}</dd>
              </div>
              <div>
                <dt>11 kV feeders</dt>
                <dd>{inspect?.feeder_count ?? '—'}</dd>
              </div>
              <div>
                <dt>Commissioned</dt>
                <dd>{inspect?.commissioned_on || '—'}</dd>
              </div>
            </dl>
            {inspect?.remarks && <p className="muted tight">{inspect.remarks}</p>}
            {inspect?.source && <p className="muted tight">Source: {inspect.source}</p>}
            {canEdit && selected && (
              <button type="button" className="btn" onClick={() => startEdit(selected)}>
                Edit
              </button>
            )}
          </>
        )}
        <svg
          className="ss-mini-map"
          viewBox={`0 0 ${mapW} ${mapH}`}
          role="img"
          aria-label="Substation locations"
        >
          {filtered.map((r) => {
            const lat = Number(r.latitude);
            const lon = Number(r.longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
            const on = r.id === selId;
            return (
              <circle
                key={r.id}
                cx={xOf(lon)}
                cy={yOf(lat)}
                r={on ? 6 : 3.6}
                fill={DIV_COLOR[r.division_code] || '#1565c0'}
                opacity={on ? 1 : 0.78}
                onClick={() => {
                  setSelId(r.id);
                  setEditing(false);
                }}
              >
                <title>{`${r.name} · ${fmtMva(r.capacity_mva)} MVA`}</title>
              </circle>
            );
          })}
        </svg>
      </aside>
    </div>
  );
}
