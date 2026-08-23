import type { Substation, TrunkLine } from '@/domain/types';
import { loadDistrictPolygons } from '@/lib/districts';

export type PrintPaperId = 'a4' | 'a3' | 'a2' | 'a1' | 'custom';
export type PrintOrientation = 'landscape' | 'portrait';

/** ISO sizes in millimetres (portrait width × height). */
export const PRINT_PAPERS: Record<
  Exclude<PrintPaperId, 'custom'>,
  { label: string; widthMm: number; heightMm: number }
> = {
  a4: { label: 'A4 (small)', widthMm: 210, heightMm: 297 },
  a3: { label: 'A3 (office)', widthMm: 297, heightMm: 420 },
  a2: { label: 'A2 (wall)', widthMm: 420, heightMm: 594 },
  a1: { label: 'A1 (large wall)', widthMm: 594, heightMm: 841 },
};

export type PrintSettings = {
  paperId: PrintPaperId;
  orientation: PrintOrientation;
  customWidthMm: number;
  customHeightMm: number;
  districts: string[];
  title: string;
  subtitle: string;
  showSsNames: boolean;
  showFeederLength: boolean;
  showProposed: boolean;
  showDistrictBoundaries: boolean;
  listSide: 'left' | 'right';
};

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  paperId: 'a3',
  orientation: 'landscape',
  customWidthMm: 420,
  customHeightMm: 297,
  districts: [],
  title: 'Power Network Map',
  subtitle: '',
  showSsNames: true,
  showFeederLength: true,
  showProposed: true,
  showDistrictBoundaries: true,
  listSide: 'right',
};

export function paperSizeMm(settings: PrintSettings): { widthMm: number; heightMm: number } {
  if (settings.paperId === 'custom') {
    // Custom uses exact entered mm — do not swap by orientation
    return {
      widthMm: Math.min(1200, Math.max(100, Number(settings.customWidthMm) || 100)),
      heightMm: Math.min(1200, Math.max(100, Number(settings.customHeightMm) || 100)),
    };
  }
  const p = PRINT_PAPERS[settings.paperId];
  const w = p.widthMm;
  const h = p.heightMm;
  if (settings.orientation === 'landscape') {
    return { widthMm: Math.max(w, h), heightMm: Math.min(w, h) };
  }
  return { widthMm: Math.min(w, h), heightMm: Math.max(w, h) };
}

export function cssPageSize(settings: PrintSettings): string {
  const { widthMm, heightMm } = paperSizeMm(settings);
  return `${widthMm}mm ${heightMm}mm`;
}

/** Named ISO @page size so browser print dialog matches; custom uses exact mm. */
export function cssPageRule(settings: PrintSettings): string {
  if (settings.paperId === 'custom') {
    const { widthMm, heightMm } = paperSizeMm(settings);
    return `size: ${widthMm}mm ${heightMm}mm`;
  }
  return `size: ${settings.paperId.toUpperCase()} ${settings.orientation}`;
}

/**
 * Literal print CSS (no CSS variables) — Chrome print preview often drops
 * custom-property mm sizes and then stretches the screen-pixel sheet.
 */
export function buildPrintStyleSheet(settings: PrintSettings): string {
  const { widthMm, heightMm } = paperSizeMm(settings);
  const page = cssPageRule(settings);
  const box = `
    width: ${widthMm}mm !important;
    height: ${heightMm}mm !important;
    max-width: none !important;
    max-height: none !important;
    aspect-ratio: auto !important;
    margin: 0 !important;
    padding: 0 !important;
    box-sizing: border-box !important;
  `;
  return `
@page { ${page}; margin: 0; }
body.is-printing .print-overlay {
  background: #fff !important;
}
body.is-printing .print-toolbar {
  display: none !important;
}
body.is-printing .print-stage {
  padding: 0 !important;
  overflow: hidden !important;
  ${box}
}
body.is-printing .print-sheet {
  ${box}
  box-shadow: none !important;
  overflow: hidden !important;
}
body.is-printing .print-sheet-body {
  flex: 1 1 auto !important;
  min-height: 0 !important;
  height: auto !important;
}
body.is-printing .print-map-pane,
body.is-printing .print-map-canvas,
body.is-printing .print-map-canvas.leaflet-container {
  height: 100% !important;
  min-height: 0 !important;
}
@media print {
  html, body {
    ${box}
    overflow: hidden !important;
    background: #fff !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  body.print-preview-open .app-shell > :not(.print-overlay) {
    display: none !important;
  }
  .print-overlay,
  .print-stage,
  .print-sheet {
    position: static !important;
    inset: auto !important;
    display: flex !important;
    flex-direction: column !important;
    ${box}
    background: #fff !important;
    overflow: hidden !important;
    box-shadow: none !important;
  }
  .print-sheet {
    page-break-after: avoid !important;
    page-break-inside: avoid !important;
    break-inside: avoid !important;
  }
  .no-print,
  .print-toolbar {
    display: none !important;
  }
  .print-sheet-body {
    flex: 1 1 auto !important;
    min-height: 0 !important;
    height: auto !important;
    overflow: hidden !important;
    grid-template-rows: minmax(0, 1fr) auto !important;
  }
  .print-map-pane {
    position: relative !important;
    min-height: 0 !important;
    height: 100% !important;
    overflow: hidden !important;
  }
  .print-map-canvas,
  .print-map-canvas.leaflet-container {
    position: absolute !important;
    inset: 0 !important;
    width: 100% !important;
    height: 100% !important;
    min-height: 0 !important;
  }
  .print-side-list {
    max-height: none !important;
    overflow: hidden !important;
    flex-shrink: 0 !important;
  }
}
`.trim();
}

type Ring = number[][];
type DistrictPoly = { name: string; rings: Ring[] };

function pointInRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPoly(lng: number, lat: number, d: DistrictPoly): boolean {
  return d.rings.some((ring) => pointInRing(lng, lat, ring));
}

export type PrintDistrictBoundary = {
  name: string;
  /** Leaflet [lat, lng] rings */
  latLngRings: [number, number][][];
};

export type PrintAssetBundle = {
  substations: Substation[];
  lines: TrunkLine[];
  districtNames: string[];
  districtBoundaries: PrintDistrictBoundary[];
  bounds: [[number, number], [number, number]] | null;
};

/** Filter network to selected districts (empty = use all available from caller). */
export async function buildPrintAssets(
  substations: Substation[],
  lines: TrunkLine[],
  districtNames: string[],
  opts?: { includeProposed?: boolean },
): Promise<PrintAssetBundle> {
  const includeProposed = opts?.includeProposed ?? true;
  const allDistricts = (await loadDistrictPolygons()) as DistrictPoly[];
  const want = districtNames.map((n) => n.toLowerCase());
  const matched =
    want.length === 0
      ? []
      : allDistricts.filter((d) => want.includes(d.name.toLowerCase()));

  const statusOk = (status: string) =>
    status === 'existing' || (includeProposed && status === 'proposed');

  let ss: Substation[];
  if (!matched.length) {
    ss = substations.filter((s) => statusOk(s.status));
  } else {
    ss = substations.filter(
      (s) => statusOk(s.status) && matched.some((d) => pointInPoly(s.lng, s.lat, d)),
    );
  }

  // Boundaries to draw: selected districts, or districts that contain printed SS
  let boundaryDistricts = matched;
  if (!boundaryDistricts.length && ss.length) {
    const hit = new Set<string>();
    for (const s of ss) {
      const d = allDistricts.find((x) => pointInPoly(s.lng, s.lat, x));
      if (d) hit.add(d.name);
    }
    boundaryDistricts = allDistricts.filter((d) => hit.has(d.name));
  }

  const districtBoundaries: PrintDistrictBoundary[] = boundaryDistricts.map((d) => ({
    name: d.name,
    latLngRings: d.rings.map((ring) =>
      ring.map((p) => [p[1], p[0]] as [number, number]),
    ),
  }));

  const ssIds = new Set(ss.map((s) => s.id));
  const filteredLines = lines.filter((l) => {
    if (!statusOk(l.status)) return false;
    return ssIds.has(l.fromId) || ssIds.has(l.toId);
  });

  let bounds: [[number, number], [number, number]] | null = null;
  if (boundaryDistricts.length) {
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;
    for (const d of boundaryDistricts) {
      for (const ring of d.rings) {
        for (const p of ring) {
          minLng = Math.min(minLng, p[0]);
          maxLng = Math.max(maxLng, p[0]);
          minLat = Math.min(minLat, p[1]);
          maxLat = Math.max(maxLat, p[1]);
        }
      }
    }
    if (Number.isFinite(minLat)) {
      bounds = [
        [minLat, minLng],
        [maxLat, maxLng],
      ];
    }
  } else if (ss.length) {
    const lats = ss.map((s) => s.lat);
    const lngs = ss.map((s) => s.lng);
    bounds = [
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)],
    ];
  }

  return {
    substations: ss,
    lines: filteredLines,
    districtNames: boundaryDistricts.map((d) => d.name),
    districtBoundaries,
    bounds,
  };
}
