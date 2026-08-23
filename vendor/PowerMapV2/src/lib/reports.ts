import { formatCapacity, installedMva, isOverloaded } from '@/domain/geo';
import type { OrgUnit, Substation, TrunkLine, VoltageCode } from '@/domain/types';
import { VOLTAGE_CATALOG } from '@/domain/types';

export type ReportTabId =
  | 'executive'
  | 'existing-ss'
  | 'proposed-ss'
  | 'existing-feeders'
  | 'proposed-feeders';

export const REPORT_TABS: { id: ReportTabId; label: string }[] = [
  { id: 'executive', label: 'Executive' },
  { id: 'existing-ss', label: 'Existing SS' },
  { id: 'proposed-ss', label: 'Proposed SS' },
  { id: 'existing-feeders', label: 'Existing Feeders' },
  { id: 'proposed-feeders', label: 'Proposed Feeders' },
];

export type VoltageBreakdown = {
  code: VoltageCode;
  label: string;
  ssExisting: number;
  ssProposed: number;
  lineExisting: number;
  lineProposed: number;
  lineKmExisting: number;
  mvaExisting: number;
  mvaProposed: number;
};

export type ExecutiveReport = {
  ssExisting: number;
  ssProposed: number;
  ssRetired: number;
  lineExisting: number;
  lineProposed: number;
  lineRetired: number;
  doubleCircuit: number;
  installedMvaExisting: number;
  installedMvaProposed: number;
  lineKmExisting: number;
  lineKmProposed: number;
  avgLoadingSs: number | null;
  avgLoadingLine: number | null;
  overloadedSs: number;
  overloadedLines: number;
  isolatedSs: number;
  oldestYear: number | null;
  byVoltage: VoltageBreakdown[];
};

export type SsReportRow = {
  id: string;
  name: string;
  voltageCode: VoltageCode;
  status: string;
  orgName: string;
  capacity: string;
  mva: number;
  loadingPct: number | null;
  overloaded: boolean;
  year: number | null;
  proposedImprovement: string;
  progress: string;
  remarks: string;
  lat: number;
  lng: number;
};

export type FeederReportRow = {
  id: string;
  name: string;
  voltageCode: VoltageCode;
  status: string;
  fromName: string;
  toName: string;
  lengthKm: number | null;
  conductor: string;
  circuitConfig: string;
  circuitCount: number;
  loadingPct: number | null;
  overloaded: boolean;
  year: number | null;
  remarks: string;
};

function orgName(orgUnits: OrgUnit[], id: string | null): string {
  if (!id) return '—';
  return orgUnits.find((o) => o.id === id)?.name ?? '—';
}

function avg(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function connectedIds(lines: TrunkLine[]): Set<string> {
  const set = new Set<string>();
  lines.forEach((l) => {
    set.add(l.fromId);
    set.add(l.toId);
  });
  return set;
}

export function buildExecutiveReport(
  substations: Substation[],
  lines: TrunkLine[],
): ExecutiveReport {
  const ssExisting = substations.filter((s) => s.status === 'existing');
  const ssProposed = substations.filter((s) => s.status === 'proposed');
  const lineExisting = lines.filter((l) => l.status === 'existing');
  const lineProposed = lines.filter((l) => l.status === 'proposed');
  const connected = connectedIds(lines);

  const byVoltage: VoltageBreakdown[] = VOLTAGE_CATALOG.map((v) => {
    const ssE = ssExisting.filter((s) => s.voltageCode === v.code);
    const ssP = ssProposed.filter((s) => s.voltageCode === v.code);
    const lnE = lineExisting.filter((l) => l.voltageCode === v.code);
    const lnP = lineProposed.filter((l) => l.voltageCode === v.code);
    return {
      code: v.code,
      label: v.label,
      ssExisting: ssE.length,
      ssProposed: ssP.length,
      lineExisting: lnE.length,
      lineProposed: lnP.length,
      lineKmExisting: lnE.reduce((sum, l) => sum + (l.lengthKm ?? 0), 0),
      mvaExisting: ssE.reduce((sum, s) => sum + installedMva(s.transformers), 0),
      mvaProposed: ssP.reduce((sum, s) => sum + installedMva(s.transformers), 0),
    };
  });

  const years = substations
    .map((s) => s.commissionYear)
    .filter((y): y is number => y != null);

  return {
    ssExisting: ssExisting.length,
    ssProposed: ssProposed.length,
    ssRetired: substations.filter((s) => s.status === 'retired').length,
    lineExisting: lineExisting.length,
    lineProposed: lineProposed.length,
    lineRetired: lines.filter((l) => l.status === 'retired').length,
    doubleCircuit: lines.filter((l) => l.circuitConfig === 'double' || l.circuitCount > 1)
      .length,
    installedMvaExisting: ssExisting.reduce((sum, s) => sum + installedMva(s.transformers), 0),
    installedMvaProposed: ssProposed.reduce((sum, s) => sum + installedMva(s.transformers), 0),
    lineKmExisting: lineExisting.reduce((sum, l) => sum + (l.lengthKm ?? 0), 0),
    lineKmProposed: lineProposed.reduce((sum, l) => sum + (l.lengthKm ?? 0), 0),
    avgLoadingSs: avg(
      ssExisting.map((s) => s.loadingPct).filter((v): v is number => v != null),
    ),
    avgLoadingLine: avg(
      lineExisting.map((l) => l.loadingPct).filter((v): v is number => v != null),
    ),
    overloadedSs: substations.filter((s) => isOverloaded(s.loadingPct)).length,
    overloadedLines: lines.filter((l) => isOverloaded(l.loadingPct)).length,
    isolatedSs: substations.filter((s) => s.status !== 'retired' && !connected.has(s.id))
      .length,
    oldestYear: years.length ? Math.min(...years) : null,
    byVoltage,
  };
}

export function buildSsReportRows(
  substations: Substation[],
  orgUnits: OrgUnit[],
  status: 'existing' | 'proposed',
): SsReportRow[] {
  return substations
    .filter((s) => s.status === status)
    .map((s) => ({
      id: s.id,
      name: s.name,
      voltageCode: s.voltageCode,
      status: s.status,
      orgName: orgName(orgUnits, s.orgUnitId),
      capacity: formatCapacity(s.transformers),
      mva: installedMva(s.transformers),
      loadingPct: s.loadingPct,
      overloaded: isOverloaded(s.loadingPct),
      year: s.commissionYear,
      proposedImprovement: s.proposalRef,
      progress: s.owner,
      remarks: s.remarks,
      lat: s.lat,
      lng: s.lng,
    }))
    .sort((a, b) => {
      if (status === 'existing') {
        const la = a.loadingPct ?? -1;
        const lb = b.loadingPct ?? -1;
        if (lb !== la) return lb - la;
      }
      return a.name.localeCompare(b.name);
    });
}

export function buildFeederReportRows(
  lines: TrunkLine[],
  substations: Substation[],
  status: 'existing' | 'proposed' = 'existing',
): FeederReportRow[] {
  const byId = new Map(substations.map((s) => [s.id, s]));
  return lines
    .filter((l) => l.status === status)
    .map((l) => ({
      id: l.id,
      name: l.name,
      voltageCode: l.voltageCode,
      status: l.status,
      fromName: byId.get(l.fromId)?.name ?? '—',
      toName: byId.get(l.toId)?.name ?? '—',
      lengthKm: l.lengthKm,
      conductor: l.conductor || '—',
      circuitConfig: l.circuitConfig,
      circuitCount: l.circuitCount,
      loadingPct: l.loadingPct,
      overloaded: isOverloaded(l.loadingPct),
      year: l.commissionYear,
      remarks: l.remarks,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function downloadCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (c: string | number | null | undefined) =>
    `"${String(c ?? '').replace(/"/g, '""')}"`;
  const body = [
    headers.map(esc).join(','),
    ...rows.map((r) => r.map(esc).join(',')),
  ].join('\n');
  const blob = new Blob([body], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportSsCsv(rows: SsReportRow[], kind: 'existing' | 'proposed') {
  downloadCsv(
    `powermap-${kind}-substations.csv`,
    [
      'Name',
      'Voltage kV',
      'Status',
      'Division/Org',
      'Capacity',
      'MVA',
      'Loading %',
      'Year',
      'Proposed Improvement',
      'Progress',
      'Remarks',
      'Lat',
      'Lng',
    ],
    rows.map((r) => [
      r.name,
      r.voltageCode,
      r.status,
      r.orgName,
      r.capacity,
      r.mva,
      r.loadingPct,
      r.year,
      r.proposedImprovement,
      r.progress,
      r.remarks,
      r.lat,
      r.lng,
    ]),
  );
}

export function exportFeedersCsv(rows: FeederReportRow[], kind: 'existing' | 'proposed' = 'existing') {
  downloadCsv(
    `powermap-${kind}-feeders.csv`,
    [
      'Name',
      'Voltage kV',
      'From',
      'To',
      'Length km',
      'Conductor',
      'Circuit',
      'Circuits',
      'Loading %',
      'Year',
      'Remarks',
    ],
    rows.map((r) => [
      r.name,
      r.voltageCode,
      r.fromName,
      r.toName,
      r.lengthKm,
      r.conductor,
      r.circuitConfig,
      r.circuitCount,
      r.loadingPct,
      r.year,
      r.remarks,
    ]),
  );
}

export function exportExecutiveCsv(report: ExecutiveReport) {
  downloadCsv(
    'powermap-executive-summary.csv',
    ['Metric', 'Value'],
    [
      ['Existing substations', report.ssExisting],
      ['Proposed substations', report.ssProposed],
      ['Existing feeders', report.lineExisting],
      ['Proposed feeders', report.lineProposed],
      ['Double / multi circuit feeders', report.doubleCircuit],
      ['Installed MVA (existing)', report.installedMvaExisting.toFixed(1)],
      ['Planned MVA (proposed)', report.installedMvaProposed.toFixed(1)],
      ['Existing feeder km', report.lineKmExisting.toFixed(1)],
      ['Proposed feeder km', report.lineKmProposed.toFixed(1)],
      ['Avg SS loading %', report.avgLoadingSs?.toFixed(0) ?? ''],
      ['Avg feeder loading %', report.avgLoadingLine?.toFixed(0) ?? ''],
      ['Overloaded SS', report.overloadedSs],
      ['Overloaded feeders', report.overloadedLines],
      ['Isolated SS', report.isolatedSs],
      ['Oldest commission year', report.oldestYear ?? ''],
      ...report.byVoltage.flatMap((v) => [
        [`${v.label} existing SS`, v.ssExisting],
        [`${v.label} proposed SS`, v.ssProposed],
        [`${v.label} existing feeders`, v.lineExisting],
        [`${v.label} existing km`, v.lineKmExisting.toFixed(1)],
        [`${v.label} existing MVA`, v.mvaExisting.toFixed(1)],
      ]),
    ],
  );
}
