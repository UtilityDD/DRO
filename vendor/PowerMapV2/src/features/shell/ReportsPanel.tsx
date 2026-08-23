import { useMemo, useState } from 'react';
import { useNetworkStore } from '@/store/networkStore';
import {
  REPORT_TABS,
  buildExecutiveReport,
  buildFeederReportRows,
  buildSsReportRows,
  exportExecutiveCsv,
  exportFeedersCsv,
  exportSsCsv,
  type FeederReportRow,
  type ReportTabId,
  type SsReportRow,
} from '@/lib/reports';

function pct(v: number | null | undefined) {
  if (v == null) return '—';
  return `${Math.round(v)}%`;
}

function km(v: number | null | undefined) {
  if (v == null) return '—';
  return v.toFixed(1);
}

export function ReportsForm() {
  const [tab, setTab] = useState<ReportTabId>('executive');
  const visibleSubstations = useNetworkStore((s) => s.visibleSubstations);
  const visibleLines = useNetworkStore((s) => s.visibleLines);
  const allSubstations = useNetworkStore((s) => s.substations);
  const orgUnits = useNetworkStore((s) => s.orgUnits);
  const setSelection = useNetworkStore((s) => s.setSelection);
  const setMapFocus = useNetworkStore((s) => s.setMapFocus);
  const flashStatus = useNetworkStore((s) => s.flashStatus);

  const substations = visibleSubstations();
  const lines = visibleLines();

  const executive = useMemo(
    () => buildExecutiveReport(substations, lines),
    [substations, lines],
  );
  const existingSs = useMemo(
    () => buildSsReportRows(substations, orgUnits, 'existing'),
    [substations, orgUnits],
  );
  const proposedSs = useMemo(
    () => buildSsReportRows(substations, orgUnits, 'proposed'),
    [substations, orgUnits],
  );
  const existingFeeders = useMemo(
    () => buildFeederReportRows(lines, allSubstations, 'existing'),
    [lines, allSubstations],
  );
  const proposedFeeders = useMemo(
    () => buildFeederReportRows(lines, allSubstations, 'proposed'),
    [lines, allSubstations],
  );

  const focusSs = (row: SsReportRow) => {
    setSelection({ kind: 'substation', id: row.id });
    setMapFocus({ lat: row.lat, lng: row.lng });
    flashStatus(`Selected · ${row.name}`);
  };

  const focusFeeder = (row: FeederReportRow) => {
    setSelection({ kind: 'line', id: row.id });
    const line = useNetworkStore.getState().lines.find((l) => l.id === row.id);
    const from = line ? allSubstations.find((s) => s.id === line.fromId) : undefined;
    const to = line ? allSubstations.find((s) => s.id === line.toId) : undefined;
    if (from && to) {
      setMapFocus({
        lat: (from.lat + to.lat) / 2,
        lng: (from.lng + to.lng) / 2,
      });
    }
    flashStatus(`Selected · ${row.name}`);
  };

  const exportCurrent = () => {
    if (tab === 'executive') exportExecutiveCsv(executive);
    else if (tab === 'existing-ss') exportSsCsv(existingSs, 'existing');
    else if (tab === 'proposed-ss') exportSsCsv(proposedSs, 'proposed');
    else if (tab === 'existing-feeders') exportFeedersCsv(existingFeeders, 'existing');
    else exportFeedersCsv(proposedFeeders, 'proposed');
    flashStatus('CSV exported');
  };

  const exportGeoJson = () => {
    const ss = substations;
    const ls = lines;
    const geo = {
      type: 'FeatureCollection',
      features: [
        ...ss.map((s) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
          properties: { kind: 'substation', ...s },
        })),
        ...ls.map((l) => {
          const from = allSubstations.find((s) => s.id === l.fromId);
          const to = allSubstations.find((s) => s.id === l.toId);
          return {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: from && to ? [[from.lng, from.lat], [to.lng, to.lat]] : [],
            },
            properties: { kind: 'line', ...l },
          };
        }),
      ],
    };
    const blob = new Blob([JSON.stringify(geo, null, 2)], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'powermap-network.geojson';
    a.click();
    URL.revokeObjectURL(url);
    flashStatus('GeoJSON exported');
  };

  return (
    <div className="form-stack reports-panel">
      <p className="muted reports-filter-note">Respects current map filters.</p>

      <div className="report-tabs" role="tablist" aria-label="Report type">
        {REPORT_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`report-tab${tab === t.id ? ' is-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'executive' && <ExecutiveView report={executive} />}
      {tab === 'existing-ss' && (
        <SsTable
          rows={existingSs}
          empty="No existing substations in the current filter."
          onSelect={focusSs}
          showLoading
        />
      )}
      {tab === 'proposed-ss' && (
        <SsTable
          rows={proposedSs}
          empty="No proposed substations in the current filter."
          onSelect={focusSs}
          showLoading={false}
        />
      )}
      {tab === 'existing-feeders' && (
        <FeederTable
          rows={existingFeeders}
          empty="No existing feeders in the current filter."
          onSelect={focusFeeder}
          showLoading
        />
      )}
      {tab === 'proposed-feeders' && (
        <FeederTable
          rows={proposedFeeders}
          empty="No proposed feeders in the current filter."
          onSelect={focusFeeder}
          showLoading={false}
        />
      )}

      <div className="btn-row">
        <button type="button" className="primary-btn" onClick={exportCurrent}>
          Export CSV
        </button>
        <button type="button" className="primary-btn ghost" onClick={exportGeoJson}>
          Export GeoJSON
        </button>
      </div>
    </div>
  );
}

function ExecutiveView({
  report,
}: {
  report: ReturnType<typeof buildExecutiveReport>;
}) {
  return (
    <div className="form-stack">
      <div className="report-card">
        <div>
          <span>Existing SS</span>
          <strong>{report.ssExisting}</strong>
        </div>
        <div>
          <span>Proposed SS</span>
          <strong>{report.ssProposed}</strong>
        </div>
        <div>
          <span>Existing feeders</span>
          <strong>{report.lineExisting}</strong>
        </div>
        <div>
          <span>Proposed feeders</span>
          <strong>{report.lineProposed}</strong>
        </div>
        <div>
          <span>Installed MVA</span>
          <strong>{report.installedMvaExisting.toFixed(1)}</strong>
        </div>
        <div>
          <span>Planned MVA</span>
          <strong>{report.installedMvaProposed.toFixed(1)}</strong>
        </div>
        <div>
          <span>Existing km</span>
          <strong>{report.lineKmExisting.toFixed(1)}</strong>
        </div>
        <div>
          <span>Proposed km</span>
          <strong>{report.lineKmProposed.toFixed(1)}</strong>
        </div>
        <div>
          <span>Avg SS loading</span>
          <strong>{pct(report.avgLoadingSs)}</strong>
        </div>
        <div>
          <span>Avg feeder loading</span>
          <strong>{pct(report.avgLoadingLine)}</strong>
        </div>
        <div>
          <span>Overloaded SS</span>
          <strong className={report.overloadedSs ? 'is-warn' : ''}>{report.overloadedSs}</strong>
        </div>
        <div>
          <span>Overloaded feeders</span>
          <strong className={report.overloadedLines ? 'is-warn' : ''}>
            {report.overloadedLines}
          </strong>
        </div>
        <div>
          <span>Isolated SS</span>
          <strong>{report.isolatedSs}</strong>
        </div>
        <div>
          <span>Double / multi ckt</span>
          <strong>{report.doubleCircuit}</strong>
        </div>
        <div>
          <span>Oldest year</span>
          <strong>{report.oldestYear ?? '—'}</strong>
        </div>
      </div>

      <p className="section-label">By voltage</p>
      <div className="report-table-wrap">
        <table className="report-table">
          <thead>
            <tr>
              <th>Voltage</th>
              <th>SS ex</th>
              <th>SS pr</th>
              <th>Fd ex</th>
              <th>km</th>
              <th>MVA</th>
            </tr>
          </thead>
          <tbody>
            {report.byVoltage.map((v) => (
              <tr key={v.code}>
                <td>{v.label}</td>
                <td>{v.ssExisting}</td>
                <td>{v.ssProposed}</td>
                <td>{v.lineExisting}</td>
                <td>{v.lineKmExisting.toFixed(1)}</td>
                <td>{v.mvaExisting.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SsTable({
  rows,
  empty,
  onSelect,
  showLoading,
}: {
  rows: SsReportRow[];
  empty: string;
  onSelect: (row: SsReportRow) => void;
  showLoading: boolean;
}) {
  if (!rows.length) return <p className="muted">{empty}</p>;

  const totalMva = rows.reduce((sum, r) => sum + r.mva, 0);

  return (
    <div className="form-stack">
      <div className="report-mini-stats">
        <span>
          <strong>{rows.length}</strong> SS
        </span>
        <span>
          <strong>{totalMva.toFixed(1)}</strong> MVA
        </span>
        {showLoading && (
          <span>
            <strong>{rows.filter((r) => r.overloaded).length}</strong> overloaded
          </span>
        )}
      </div>
      <div className="report-table-wrap">
        <table className="report-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>kV</th>
              <th>Capacity</th>
              {showLoading && <th>Load</th>}
              <th>Org</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className={r.overloaded ? 'is-overloaded' : undefined}
                onClick={() => onSelect(r)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(r);
                  }
                }}
                tabIndex={0}
                title="Click to select on map"
              >
                <td>
                  <div className="report-name">{r.name}</div>
                  {(r.year || r.proposedImprovement || r.progress) && (
                    <div className="muted report-sub">
                      {[r.year, r.proposedImprovement, r.progress].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </td>
                <td>{r.voltageCode}</td>
                <td>
                  <div>{r.capacity}</div>
                  <div className="muted report-sub">{r.mva.toFixed(1)} MVA</div>
                </td>
                {showLoading && (
                  <td className={r.overloaded ? 'is-warn' : undefined}>{pct(r.loadingPct)}</td>
                )}
                <td>{r.orgName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FeederTable({
  rows,
  empty,
  onSelect,
  showLoading,
}: {
  rows: FeederReportRow[];
  empty: string;
  onSelect: (row: FeederReportRow) => void;
  showLoading: boolean;
}) {
  if (!rows.length) return <p className="muted">{empty}</p>;

  const totalKm = rows.reduce((sum, r) => sum + (r.lengthKm ?? 0), 0);

  return (
    <div className="form-stack">
      <div className="report-mini-stats">
        <span>
          <strong>{rows.length}</strong> feeders
        </span>
        <span>
          <strong>{totalKm.toFixed(1)}</strong> km
        </span>
        {showLoading && (
          <span>
            <strong>{rows.filter((r) => r.overloaded).length}</strong> overloaded
          </span>
        )}
      </div>
      <div className="report-table-wrap">
        <table className="report-table">
          <thead>
            <tr>
              <th>Feeder</th>
              <th>km</th>
              <th>Cond.</th>
              {showLoading && <th>Load</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className={r.overloaded ? 'is-overloaded' : undefined}
                onClick={() => onSelect(r)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(r);
                  }
                }}
                tabIndex={0}
                title="Click to select on map"
              >
                <td>
                  <div className="report-name">{r.name}</div>
                  <div className="muted report-sub">
                    {r.voltageCode} kV · {r.fromName} → {r.toName}
                    {r.circuitConfig === 'double' || r.circuitCount > 1
                      ? ` · ${r.circuitConfig}/${r.circuitCount}`
                      : ''}
                    {r.year || r.remarks
                      ? ` · ${[r.year, r.remarks].filter(Boolean).join(' · ')}`
                      : ''}
                  </div>
                </td>
                <td>{km(r.lengthKm)}</td>
                <td>{r.conductor}</td>
                {showLoading && (
                  <td className={r.overloaded ? 'is-warn' : undefined}>{pct(r.loadingPct)}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
