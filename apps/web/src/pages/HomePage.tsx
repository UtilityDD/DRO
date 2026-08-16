import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api';

export function HomePage() {
  const [pulse, setPulse] = useState<Record<string, number> | null>(null);
  const [nscDiv, setNscDiv] = useState<{ division_name: string; pending: number }[]>([]);

  useEffect(() => {
    api.pulse().then((r) => setPulse(r.pulse));
    api
      .nscSummary()
      .then((r) => setNscDiv(r.byDivision.map((d) => ({ division_name: d.division_name, pending: d.pending || 0 }))))
      .catch(() => {});
  }, []);

  if (!pulse) return <p className="muted">Loading region pulse…</p>;

  const kpis = [
    { label: 'Pending NSC', value: pulse.pending_nsc },
    { label: 'Pending Disco', value: pulse.pending_disco },
    { label: 'Open Grievances', value: pulse.open_grievances },
    { label: 'Open Tech Works', value: pulse.open_tech_works },
    { label: 'Spot Coverage %', value: pulse.spot_coverage_pct },
    { label: 'Region Consumers', value: pulse.region_consumers?.toLocaleString?.() ?? pulse.region_consumers },
  ];

  return (
    <div className="stack">
      <div className="kpi-grid">
        {kpis.map((k, i) => (
          <div className="kpi" key={k.label} style={{ animationDelay: `${i * 0.05}s` }}>
            <div className="label">{k.label}</div>
            <div className="value">{k.value}</div>
          </div>
        ))}
      </div>

      <div className="split">
        <div className="panel">
          <h2>NSC pending by division</h2>
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={nscDiv}>
                <XAxis dataKey="division_name" tick={{ fill: '#64748b', fontSize: 11 }} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: '#ffffff',
                    border: '1px solid rgba(30,64,120,0.12)',
                    borderRadius: 12,
                    color: '#1e293b',
                  }}
                  labelStyle={{ color: '#1e293b', fontWeight: 600 }}
                  itemStyle={{ color: '#1e293b' }}
                />
                <Bar dataKey="pending" fill="#1a73e8" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="panel">
          <h2>Quick links</h2>
          <div className="stack home-actions" style={{ gap: '0.55rem' }}>
            <Link className="btn secondary" to="/nsc">
              Review new connections
            </Link>
            <Link className="btn secondary" to="/disco">
              Revenue drive — disconnections
            </Link>
            <Link className="btn secondary" to="/upload">
              Upload SAP / CRM base data
            </Link>
            <Link className="btn secondary" to="/hierarchy">
              Explore CCC hierarchy
            </Link>
          </div>
          <p className="muted" style={{ marginTop: '1rem', fontSize: '0.82rem' }}>
            Master in DB: {pulse.consumer_master_count} consumers · {pulse.ccc_count} CCCs in scope
          </p>
        </div>
      </div>
    </div>
  );
}
