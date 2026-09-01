import type { PrintSettings } from '@/lib/printLayout';
import { printSheetTitle } from '@/lib/printLayout';
import type { VoltageFocus } from '@/lib/voltageFocus';

export type OutputScope = {
  /** Focused or print-selected district names. */
  districts?: string[];
  /** Map view toggle (All / EHT / 33 / Proposed). */
  voltageFocus?: VoltageFocus;
};

export type ReportExportKind =
  | 'executive'
  | 'dossier'
  | 'existing-ss'
  | 'proposed-ss'
  | 'existing-feeders'
  | 'proposed-feeders';

const REPORT_KIND_SLUG: Record<ReportExportKind, string> = {
  executive: 'executive-summary',
  dossier: 'district-dossier',
  'existing-ss': 'existing-substations',
  'proposed-ss': 'proposed-substations',
  'existing-feeders': 'existing-feeders',
  'proposed-feeders': 'proposed-feeders',
};

/** Safe fragment for download / save-as filenames (Windows-friendly). */
export function sanitizeFilenamePart(text: string, maxLen = 48): string {
  return text
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s\-&+]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLen)
    .toLowerCase();
}

/** District selection → compact slug, e.g. `malda`, `malda-and-darjeeling`. */
export function districtFilenamePart(names: string[] | undefined): string {
  const list = (names ?? []).map((n) => n.trim()).filter(Boolean);
  if (!list.length) return 'full-network';
  if (list.length === 1) {
    return sanitizeFilenamePart(list[0].replace(/\bdistrict\b/i, '').trim());
  }
  if (list.length === 2) {
    return `${sanitizeFilenamePart(list[0])}-and-${sanitizeFilenamePart(list[1])}`;
  }
  if (list.length <= 4) {
    return list.map((n) => sanitizeFilenamePart(n.replace(/\bdistrict\b/i, '').trim())).join('-');
  }
  return `${sanitizeFilenamePart(list[0])}-plus-${list.length - 1}-districts`;
}

function viewFilenamePart(focus: VoltageFocus | undefined): string {
  if (!focus || focus === 'all') return '';
  if (focus === 'ehv') return 'eht-view';
  if (focus === '33') return '33kv-view';
  return 'proposed-view';
}

function datedSuffix(): string {
  return new Date().toISOString().slice(0, 10);
}

function joinBasename(parts: Array<string | undefined | null>): string {
  return parts
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join('_');
}

/** Browser PDF save dialog uses `document.title` as the default filename stem. */
export function printSaveDocumentTitle(
  settings: Pick<PrintSettings, 'title' | 'districts' | 'paperId' | 'orientation' | 'customWidthMm' | 'customHeightMm'>,
  districtNames: string[] = [],
): string {
  const title = printSheetTitle(settings, districtNames);
  const paper =
    settings.paperId === 'custom'
      ? `${settings.customWidthMm}x${settings.customHeightMm}mm`
      : `${settings.paperId.toUpperCase()} ${settings.orientation}`;
  return `${title} (${paper})`;
}

export function reportCsvFilename(kind: ReportExportKind, scope: OutputScope = {}): string {
  return `${joinBasename([
    'powermap',
    REPORT_KIND_SLUG[kind],
    districtFilenamePart(scope.districts),
    viewFilenamePart(scope.voltageFocus),
    datedSuffix(),
  ])}.csv`;
}

export function geoJsonFilename(scope: OutputScope = {}): string {
  return `${joinBasename([
    'powermap',
    'network',
    districtFilenamePart(scope.districts),
    viewFilenamePart(scope.voltageFocus),
    datedSuffix(),
  ])}.geojson`;
}

export function voltageCheckCsvFilename(districts: string[] = []): string {
  return `${joinBasename([
    'powermap',
    'far-from-33kv',
    districtFilenamePart(districts),
    datedSuffix(),
  ])}.csv`;
}
