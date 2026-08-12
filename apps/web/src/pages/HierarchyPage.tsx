import { useEffect, useState } from 'react';
import { api, type Office } from '../api';

export function HierarchyPage() {
  const [region, setRegion] = useState<Office | null>(null);
  const [divisions, setDivisions] = useState<(Office & { cccs: Office[] })[]>([]);

  useEffect(() => {
    api.hierarchy().then((r) => {
      setRegion(r.region);
      setDivisions(r.divisions);
    });
  }, []);

  return (
    <div className="stack">
      <div className="panel">
        <h2>
          {region?.name || 'Darjeeling Region'}{' '}
          <span className="code-pill">{region?.code}</span>
        </h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Zone 34 · {(region?.consumer_count || 0).toLocaleString()} consumers · {divisions.length} divisions ·{' '}
          {divisions.reduce((n, d) => n + d.cccs.length, 0)} CCC
        </p>
      </div>
      <div className="tree">
        {divisions.map((d) => (
          <div className="div-card" key={d.code}>
            <h3>
              {d.name} <span className="code-pill">{d.code}</span>
            </h3>
            <p className="muted" style={{ marginTop: '-0.35rem', fontSize: '0.82rem' }}>
              {(d.consumer_count || 0).toLocaleString()} consumers · {d.cccs.length} CCC
            </p>
            <div className="ccc-list">
              {d.cccs.map((c) => (
                <div className="ccc-item" key={c.code}>
                  <div className="ccc-item-row">
                    <strong>{c.name}</strong>
                    <span className="code-pill">{c.code}</span>
                  </div>
                  <span>{(c.consumer_count || 0).toLocaleString()} consumers</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
