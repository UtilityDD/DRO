import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { formatCapacity, installedMva, parallelCircuitLatLngs } from '@/domain/geo';
import type { Substation, TrunkLine } from '@/domain/types';
import { createBasemapLayer, basemapToBack } from '@/features/map/boundaryLayers';
import { feederLabelOffsetPx, feederLabelPlacement } from '@/features/map/feederLabels';
import { lineStyle, substationIcon } from '@/features/map/symbology';
import { layoutSsLabels } from '@/features/print/labelLayout';
import {
  buildPrintAssets,
  buildPrintStyleSheet,
  paperSizeMm,
  printSheetTitle,
  PRINT_BASEMAPS,
  type PrintSettings,
} from '@/lib/printLayout';
import { useNetworkStore } from '@/store/networkStore';

function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Soft max zoom — high enough that A4 can still fill the pane. */
function maxZoomForPaper(settings: PrintSettings): number {
  switch (settings.paperId) {
    case 'a4':
      return 14;
    case 'a3':
      return 15;
    case 'a2':
      return 16;
    case 'a1':
      return 17;
    default:
      return 15;
  }
}

/**
 * Screen preview width scales with paper so A4 / A3 / A1 look different,
 * while staying within the viewport.
 */
function previewWidthPx(settings: PrintSettings): number {
  const { widthMm, heightMm } = paperSizeMm(settings);
  // Standard ISO sizes — previous stable preview scale
  if (settings.paperId !== 'custom') {
    return Math.min(1180, Math.max(520, Math.round(widthMm * 2.15)));
  }
  // Custom only: fit within viewport so odd aspect ratios don't break layout
  const maxW = typeof window !== 'undefined' ? Math.min(1180, Math.max(360, window.innerWidth - 48)) : 900;
  const maxH = typeof window !== 'undefined' ? Math.max(280, window.innerHeight - 120) : 640;
  const byWidth = Math.min(maxW, Math.round(widthMm * 2.0));
  const byHeight = Math.round((byWidth * heightMm) / widthMm);
  if (byHeight <= maxH) return Math.max(360, byWidth);
  return Math.max(320, Math.round((maxH * widthMm) / heightMm));
}

function listColumnCount(n: number): number {
  if (n > 56) return 4;
  if (n > 32) return 3;
  if (n > 14) return 2;
  return 1;
}

function PrintMiniMap({
  substations,
  lines,
  inDistrictIds,
  bounds,
  districtBoundaries,
  settings,
  layoutKey,
}: {
  substations: Substation[];
  lines: TrunkLine[];
  inDistrictIds: string[];
  bounds: [[number, number], [number, number]] | null;
  districtBoundaries: { name: string; latLngRings: [number, number][][] }[];
  settings: PrintSettings;
  layoutKey: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const networkRef = useRef<L.FeatureGroup | null>(null);
  const districtsLayerRef = useRef<L.FeatureGroup | null>(null);
  const basemapRef = useRef<L.Layer | null>(null);
  const placeLabelsRef = useRef<() => void>(() => {});
  const boundsRef = useRef(bounds);
  const settingsRef = useRef(settings);
  const inDistrictRef = useRef(inDistrictIds);
  boundsRef.current = bounds;
  settingsRef.current = settings;
  inDistrictRef.current = inDistrictIds;

  const fitToContent = (map: L.Map) => {
    const s = settingsRef.current;
    const districts = districtsLayerRef.current;
    map.invalidateSize(false);
    const size = map.getSize();
    if (size.x < 40 || size.y < 40) return;

    // Prefer district (+ stored core bounds). Do not fit to outside stubs —
    // that zooms the sheet out and wastes the page.
    let target: L.LatLngBounds | null = null;
    if (districts && districts.getLayers().length > 0) {
      const db = districts.getBounds();
      if (db.isValid()) target = db;
    }
    if (boundsRef.current) {
      const bb = L.latLngBounds(boundsRef.current);
      if (bb.isValid()) target = target ? target.extend(bb) : bb;
    }
    if (!target || !target.isValid()) {
      map.setView([25.85, 88.55], 9);
      return;
    }

    const padX = Math.max(4, Math.round(size.x * 0.012));
    const padY = Math.max(4, Math.round(size.y * 0.012));
    map.fitBounds(target, {
      animate: false,
      padding: [padY, padX],
      maxZoom: maxZoomForPaper(s),
    });
  };

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: false,
      dragging: true,
      scrollWheelZoom: true,
      doubleClickZoom: true,
      boxZoom: false,
      keyboard: false,
    });
    const initialBasemap = settingsRef.current.basemap || 'esri';
    if (initialBasemap !== 'none') {
      const layer = createBasemapLayer(initialBasemap);
      layer.addTo(map);
      basemapRef.current = layer;
    }
    map.getContainer().classList.toggle('basemap-none', initialBasemap === 'none');
    const districts = L.featureGroup().addTo(map);
    const network = L.featureGroup().addTo(map);
    districtsLayerRef.current = districts;
    networkRef.current = network;
    mapRef.current = map;

    const ro = new ResizeObserver(() => {
      window.requestAnimationFrame(() => {
        if (mapRef.current) fitToContent(mapRef.current);
      });
    });
    ro.observe(containerRef.current);

    const onPrintPrepare = () => {
      fitToContent(map);
      placeLabelsRef.current();
      window.setTimeout(() => {
        fitToContent(map);
        placeLabelsRef.current();
      }, 80);
      window.setTimeout(() => {
        fitToContent(map);
        placeLabelsRef.current();
      }, 250);
    };
    window.addEventListener('powermap:print-prepare', onPrintPrepare);

    return () => {
      ro.disconnect();
      window.removeEventListener('powermap:print-prepare', onPrintPrepare);
      map.remove();
      mapRef.current = null;
      networkRef.current = null;
      districtsLayerRef.current = null;
      basemapRef.current = null;
    };
  }, []);

  // Swap basemap when preview selection changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const id = settings.basemap || 'esri';
    if (basemapRef.current) {
      map.removeLayer(basemapRef.current);
      basemapRef.current = null;
    }
    if (id !== 'none') {
      const next = createBasemapLayer(id);
      next.addTo(map);
      basemapToBack(next);
      basemapRef.current = next;
    }
    map.getContainer().classList.toggle('basemap-none', id === 'none');
    window.requestAnimationFrame(() => {
      fitToContent(map);
      placeLabelsRef.current();
    });
  }, [settings.basemap]);

  // Draw district boundaries
  useEffect(() => {
    const map = mapRef.current;
    const group = districtsLayerRef.current;
    if (!map || !group) return;
    group.clearLayers();

    if (settings.showDistrictBoundaries) {
      districtBoundaries.forEach((d) => {
        d.latLngRings.forEach((ring) => {
          if (ring.length < 3) return;
          group.addLayer(
            L.polygon(ring, {
              color: '#0f172a',
              weight: 1.5,
              opacity: 0.9,
              fillColor: '#64748b',
              fillOpacity: 0.04,
              interactive: false,
            }),
          );
        });
      });
    }

    fitToContent(map);
  }, [districtBoundaries, settings.showDistrictBoundaries, layoutKey]);

  // Draw network
  useEffect(() => {
    const map = mapRef.current;
    const group = networkRef.current;
    if (!map || !group) return;

    group.clearLayers();
    const ssById = new Map(substations.map((s) => [s.id, s]));

    const pairKey = (a: string, b: string) => [a, b].sort().join('|');
    const groups = new Map<string, TrunkLine[]>();
    lines.forEach((l) => {
      const key = pairKey(l.fromId, l.toId);
      const g = groups.get(key) ?? [];
      g.push(l);
      groups.set(key, g);
    });

    groups.forEach((groupLines) => {
      const sorted = [...groupLines].sort(
        (a, b) => a.circuitCount - b.circuitCount || a.name.localeCompare(b.name),
      );
      sorted.forEach((line, index) => {
        const from = ssById.get(line.fromId);
        const to = ssById.get(line.toId);
        if (!from || !to) return;
        const path = parallelCircuitLatLngs(
          from.lat,
          from.lng,
          to.lat,
          to.lng,
          index,
          sorted.length,
        );
        group.addLayer(
          L.polyline(path, {
            ...lineStyle(line.voltageCode, line.status, false, false, {
              circuitIndex: index,
              parallelTotal: sorted.length,
            }),
            interactive: false,
          }),
        );

        // Feeder length labels are placed after fitBounds (same mid-span logic as main map)
      });
    });

    substations.forEach((ss) => {
      // In-district symbols only here. Outside symbols are added after fitBounds
      // when the SS falls inside the page view.
      if (inDistrictIds.length && !inDistrictIds.includes(ss.id)) return;
      group.addLayer(
        L.marker([ss.lat, ss.lng], {
          icon: substationIcon(ss.voltageCode, ss.status, false),
          interactive: false,
          zIndexOffset: 400,
        }),
      );
    });

    const placeFeederLengths = () => {
      if (!settings.showFeederLength) return;
      group.eachLayer((layer) => {
        const any = layer as L.Layer & { options?: { pmPrintFeederLen?: boolean } };
        if (any.options?.pmPrintFeederLen) group.removeLayer(layer);
      });

      groups.forEach((groupLines) => {
        const sorted = [...groupLines].sort(
          (a, b) => a.circuitCount - b.circuitCount || a.name.localeCompare(b.name),
        );
        sorted.forEach((line, index) => {
          if (line.lengthKm == null) return;
          const from = ssById.get(line.fromId);
          const to = ssById.get(line.toId);
          if (!from || !to) return;
          const path = parallelCircuitLatLngs(
            from.lat,
            from.lng,
            to.lat,
            to.lng,
            index,
            sorted.length,
          );
          const place = feederLabelPlacement(map, path, index, sorted.length);
          const gap = feederLabelOffsetPx(map.getZoom(), sorted.length) * place.side;
          const icon = L.divIcon({
            className: 'print-map-label print-feeder-label',
            html: `<div class="print-feeder-label-rot" style="transform:translate(-50%,-50%) rotate(${place.angleDeg.toFixed(2)}deg) translateY(${-gap}px)"><span>${Number(line.lengthKm).toFixed(1)} km</span></div>`,
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          });
          group.addLayer(
            L.marker([place.lat, place.lng], {
              icon,
              interactive: false,
              zIndexOffset: 200,
              pmPrintFeederLen: true,
            } as L.MarkerOptions & { pmPrintFeederLen: boolean }),
          );
        });
      });
    };

    const placeLabels = () => {
      group.eachLayer((layer) => {
        const any = layer as L.Layer & {
          options?: { pmPrintLabel?: boolean; pmPrintOutsideSs?: boolean };
        };
        if (any.options?.pmPrintLabel || any.options?.pmPrintOutsideSs) {
          group.removeLayer(layer);
        }
      });

      const inSet = new Set(inDistrictIds);
      const coreSs =
        inDistrictIds.length > 0
          ? substations.filter((ss) => inSet.has(ss.id))
          : substations;

      if (settings.showSsNames) {
        const placements = layoutSsLabels(
          map,
          coreSs.map((ss) => ({
            id: ss.id,
            name: ss.name,
            lat: ss.lat,
            lng: ss.lng,
          })),
        );

        placements.forEach((p) => {
          if (p.callout) {
            group.addLayer(
              L.polyline(
                [
                  [p.anchorLat, p.anchorLng],
                  [p.labelLat, p.labelLng],
                ],
                {
                  color: '#94a3b8',
                  weight: 0.8,
                  opacity: 0.7,
                  dashArray: '2 3',
                  interactive: false,
                  pmPrintLabel: true,
                } as L.PolylineOptions & { pmPrintLabel: boolean },
              ),
            );
            group.addLayer(
              L.circleMarker([p.anchorLat, p.anchorLng], {
                radius: 2.2,
                color: '#475569',
                weight: 1,
                fillColor: '#ffffff',
                fillOpacity: 1,
                interactive: false,
                pmPrintLabel: true,
              } as L.CircleMarkerOptions & { pmPrintLabel: boolean }),
            );
          }

          const icon = L.divIcon({
            className: `print-map-label print-ss-label${p.callout ? ' is-callout' : ''}`,
            html: `<span>${escapeHtml(p.name)}</span>`,
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          });
          group.addLayer(
            L.marker([p.labelLat, p.labelLng], {
              icon,
              interactive: false,
              zIndexOffset: 500,
              pmPrintLabel: true,
            } as L.MarkerOptions & { pmPrintLabel: boolean }),
          );
        });
      }

      // Outside linked ends: symbol + name if the SS sits in the page view;
      // otherwise feeder stub name only (no symbol off-page).
      if (inDistrictIds.length > 0) {
        const view = map.getBounds().pad(0.02);
        const labeled = new Set<string>();
        lines.forEach((line) => {
          const fromIn = inSet.has(line.fromId);
          const toIn = inSet.has(line.toId);
          if (fromIn === toIn) return;
          const inside = ssById.get(fromIn ? line.fromId : line.toId);
          const outside = ssById.get(fromIn ? line.toId : line.fromId);
          if (!inside || !outside || labeled.has(outside.id)) return;
          labeled.add(outside.id);

          const onPage = view.contains(L.latLng(outside.lat, outside.lng));
          if (onPage) {
            group.addLayer(
              L.marker([outside.lat, outside.lng], {
                icon: substationIcon(outside.voltageCode, outside.status, false),
                interactive: false,
                zIndexOffset: 420,
                pmPrintOutsideSs: true,
              } as L.MarkerOptions & { pmPrintOutsideSs: boolean }),
            );
            if (settings.showSsNames) {
              const icon = L.divIcon({
                className: 'print-map-label print-ss-label print-link-label',
                html: `<span>${escapeHtml(outside.name)}</span>`,
                iconSize: [0, 0],
                iconAnchor: [0, 0],
              });
              group.addLayer(
                L.marker([outside.lat, outside.lng], {
                  icon,
                  interactive: false,
                  zIndexOffset: 480,
                  pmPrintLabel: true,
                } as L.MarkerOptions & { pmPrintLabel: boolean }),
              );
            }
          } else if (settings.showSsNames) {
            const t = 0.78;
            const lat = inside.lat + (outside.lat - inside.lat) * t;
            const lng = inside.lng + (outside.lng - inside.lng) * t;
            const icon = L.divIcon({
              className: 'print-map-label print-ss-label print-link-label is-callout',
              html: `<span>${escapeHtml(outside.name)}</span>`,
              iconSize: [0, 0],
              iconAnchor: [0, 0],
            });
            group.addLayer(
              L.marker([lat, lng], {
                icon,
                interactive: false,
                zIndexOffset: 480,
                pmPrintLabel: true,
              } as L.MarkerOptions & { pmPrintLabel: boolean }),
            );
          }
        });
      }
    };
    placeLabelsRef.current = () => {
      placeFeederLengths();
      placeLabels();
    };

    fitToContent(map);
    placeFeederLengths();
    placeLabels();
    const t = window.setTimeout(() => {
      fitToContent(map);
      placeFeederLengths();
      placeLabels();
    }, 140);
    return () => window.clearTimeout(t);
  }, [
    substations,
    lines,
    inDistrictIds,
    bounds,
    settings.showSsNames,
    settings.showFeederLength,
    layoutKey,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const t1 = window.setTimeout(() => fitToContent(map), 50);
    const t2 = window.setTimeout(() => fitToContent(map), 200);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [layoutKey]);

  return <div ref={containerRef} className="print-map-canvas" />;
}

export function PrintSheet({
  settings,
  onClose,
}: {
  settings: PrintSettings;
  onClose: () => void;
}) {
  const allSs = useNetworkStore((s) => s.substations);
  const allLines = useNetworkStore((s) => s.lines);
  const setPrintSettings = useNetworkStore((s) => s.setPrintSettings);
  const [bundle, setBundle] = useState<Awaited<ReturnType<typeof buildPrintAssets>> | null>(
    null,
  );
  const [busy, setBusy] = useState(true);
  const [isPrinting, setIsPrinting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    void buildPrintAssets(allSs, allLines, settings.districts, {
      includeProposed: settings.showProposed,
    }).then((b) => {
      if (!cancelled) {
        setBundle(b);
        setBusy(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [allSs, allLines, settings.districts, settings.showProposed]);

  const size = paperSizeMm(settings);
  const previewW = previewWidthPx(settings);
  const layoutKey = `${settings.paperId}-${settings.orientation}-${size.widthMm}x${size.heightMm}-${settings.listSide}`;

  const listRows = useMemo(() => {
    const inDistrict = new Set(bundle?.inDistrictIds ?? []);
    const source =
      inDistrict.size > 0
        ? (bundle?.substations ?? []).filter((s) => inDistrict.has(s.id))
        : (bundle?.substations ?? []);
    return [...source].sort((a, b) => {
      const va = Number(a.voltageCode);
      const vb = Number(b.voltageCode);
      if (vb !== va) return vb - va;
      return a.name.localeCompare(b.name);
    });
  }, [bundle]);

  const totalMva = listRows.reduce((sum, s) => sum + installedMva(s.transformers), 0);
  const listCols = listColumnCount(listRows.length);
  const sheetTitle = printSheetTitle(settings, bundle?.districtNames ?? []);
  const sheetSub =
    settings.subtitle.trim() ||
    (listRows.length
      ? `${listRows.length} substations · ${totalMva.toFixed(0)} MVA`
      : '');

  useEffect(() => {
    document.body.classList.add('print-preview-open');

    // Literal mm + named @page — do not use CSS variables (print engines drop them)
    let pageStyle = document.getElementById('powermap-print-page');
    if (!pageStyle) {
      pageStyle = document.createElement('style');
      pageStyle.id = 'powermap-print-page';
      document.head.appendChild(pageStyle);
    }
    pageStyle.textContent = buildPrintStyleSheet(settings);

    // Keep laser visible during on-screen preview (presenting). Hide only via
    // @media print CSS so the pointer never lands on the PDF.
    const chromeSel =
      '.app-shell > .app-bar, .app-shell > .bottom-nav, .app-shell .sheet-root, .app-shell .present-nav-root, .app-shell .pm-desk-toolbar, .app-shell .page-masthead';

    const hideShellChrome = () => {
      document.querySelectorAll<HTMLElement>(chromeSel).forEach((el) => {
        if (el.dataset.pmPrintHide === undefined) {
          el.dataset.pmPrintHide = el.getAttribute('style') ?? '';
        }
        el.style.setProperty('display', 'none', 'important');
        el.style.setProperty('visibility', 'hidden', 'important');
        el.style.setProperty('height', '0', 'important');
      });
    };
    const restoreShellChrome = () => {
      document.querySelectorAll<HTMLElement>('[data-pm-print-hide]').forEach((el) => {
        const prev = el.dataset.pmPrintHide;
        el.removeAttribute('data-pm-print-hide');
        if (!prev) el.removeAttribute('style');
        else el.setAttribute('style', prev);
      });
    };

    // Hide as soon as preview opens — print engines often use a narrow page
    // width that re-shows mobile app-bar / bottom-nav via !important CSS.
    hideShellChrome();

    const onBeforePrint = () => {
      document.body.classList.add('is-printing');
      hideShellChrome();
      window.dispatchEvent(new Event('powermap:print-prepare'));
    };
    const onAfterPrint = () => {
      document.body.classList.remove('is-printing');
      // Keep chrome hidden while preview stays open; restore on unmount.
      setIsPrinting(false);
    };
    window.addEventListener('beforeprint', onBeforePrint);
    window.addEventListener('afterprint', onAfterPrint);

    return () => {
      document.body.classList.remove('print-preview-open');
      document.body.classList.remove('is-printing');
      restoreShellChrome();
      pageStyle?.remove();
      window.removeEventListener('beforeprint', onBeforePrint);
      window.removeEventListener('afterprint', onAfterPrint);
    };
  }, [settings]);

  const doPrint = () => {
    setIsPrinting(true);
    document.body.classList.add('is-printing');
    document
      .querySelectorAll<HTMLElement>(
        '.app-shell > .app-bar, .app-shell > .bottom-nav, .app-shell .sheet-root, .app-shell .present-nav-root, .app-shell .pm-desk-toolbar, .app-shell .page-masthead',
      )
      .forEach((el) => {
        if (el.dataset.pmPrintHide === undefined) {
          el.dataset.pmPrintHide = el.getAttribute('style') ?? '';
        }
        el.style.setProperty('display', 'none', 'important');
        el.style.setProperty('visibility', 'hidden', 'important');
        el.style.setProperty('height', '0', 'important');
      });
    window.requestAnimationFrame(() => {
      window.dispatchEvent(new Event('powermap:print-prepare'));
      window.setTimeout(() => {
        window.dispatchEvent(new Event('powermap:print-prepare'));
        window.setTimeout(() => window.print(), 800);
      }, 200);
    });
  };

  return (
    <div className="print-overlay" role="dialog" aria-label="Print preview">
      <div className="print-toolbar no-print">
        <div className="print-toolbar-meta">
          <strong>Print preview</strong>
          <span>
            {size.widthMm} × {size.heightMm} mm · {listRows.length} SS
          </span>
        </div>
        <div className="print-toolbar-size no-print">
          <label>
            Size
            <select
              value={settings.paperId}
              onChange={(e) =>
                setPrintSettings({
                  paperId: e.target.value as PrintSettings['paperId'],
                })
              }
            >
              <option value="a4">A4</option>
              <option value="a3">A3</option>
              <option value="a2">A2</option>
              <option value="a1">A1</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          {settings.paperId === 'custom' ? (
            <>
              <label>
                W
                <input
                  type="number"
                  min={100}
                  max={1200}
                  value={settings.customWidthMm}
                  onChange={(e) =>
                    setPrintSettings({
                      customWidthMm: Math.min(
                        1200,
                        Math.max(100, Number(e.target.value) || 100),
                      ),
                    })
                  }
                />
              </label>
              <label>
                H
                <input
                  type="number"
                  min={100}
                  max={1200}
                  value={settings.customHeightMm}
                  onChange={(e) =>
                    setPrintSettings({
                      customHeightMm: Math.min(
                        1200,
                        Math.max(100, Number(e.target.value) || 100),
                      ),
                    })
                  }
                />
              </label>
            </>
          ) : (
            <label>
              Orient
              <select
                value={settings.orientation}
                onChange={(e) =>
                  setPrintSettings({
                    orientation: e.target.value as PrintSettings['orientation'],
                  })
                }
              >
                <option value="landscape">Landscape</option>
                <option value="portrait">Portrait</option>
              </select>
            </label>
          )}
          <label>
            Basemap
            <select
              value={settings.basemap || 'esri'}
              onChange={(e) =>
                setPrintSettings({
                  basemap: e.target.value as PrintSettings['basemap'],
                })
              }
            >
              {PRINT_BASEMAPS.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="btn-row">
          <button type="button" className="primary-btn" onClick={doPrint} disabled={busy}>
            Print / Save PDF
          </button>
          <button type="button" className="primary-btn ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      <div className="print-stage">
        <div
          className={`print-sheet list-${settings.listSide} cols-${listCols}`}
          style={
            isPrinting
              ? {
                  width: `${size.widthMm}mm`,
                  height: `${size.heightMm}mm`,
                  maxWidth: 'none',
                  aspectRatio: 'auto',
                  ['--print-list-cols' as string]: String(listCols),
                }
              : {
                  width: previewW,
                  aspectRatio: `${size.widthMm} / ${size.heightMm}`,
                  ['--print-list-cols' as string]: String(listCols),
                }
          }
        >
          <header className="print-sheet-header">
            <div className="print-sheet-title">
              <h1>{sheetTitle}</h1>
              {sheetSub ? <p>{sheetSub}</p> : null}
            </div>
            <div className="print-sheet-legend" aria-label="Voltage legend">
              <span>
                <i className="sym square" />
                400
              </span>
              <span>
                <i className="sym diamond" />
                220
              </span>
              <span>
                <i className="sym hex" />
                132
              </span>
              <span>
                <i className="sym circle" />
                33
              </span>
              <span className="print-legend-note">outline = proposed</span>
            </div>
          </header>

          <div className="print-sheet-body">
            <div className="print-map-pane">
              {busy || !bundle ? (
                <div className="print-map-loading">Preparing map…</div>
              ) : (
                <PrintMiniMap
                  substations={bundle.substations}
                  lines={bundle.lines}
                  inDistrictIds={bundle.inDistrictIds}
                  bounds={bundle.bounds}
                  districtBoundaries={bundle.districtBoundaries}
                  settings={settings}
                  layoutKey={`${layoutKey}-c${listCols}`}
                />
              )}
            </div>

            <aside className="print-side-list">
              <div className="print-side-head">
                <h2>Capacities</h2>
                <p>
                  {listRows.length} SS · {totalMva.toFixed(1)} MVA
                </p>
              </div>
              <ol className="print-ss-list">
                {listRows.map((ss, i) => (
                  <li key={ss.id}>
                    <span className="print-ss-idx">{i + 1}</span>
                    <span
                      className={`print-volt-dot v-${ss.voltageCode}`}
                      aria-hidden
                    />
                    <span className="print-ss-name">
                      {ss.name}
                      {ss.status === 'proposed' ? '*' : ''}
                    </span>
                    <span className="print-ss-cap">
                      {formatCapacity(ss.transformers)}
                    </span>
                    <span className="print-ss-kv">{ss.voltageCode}</span>
                  </li>
                ))}
                {!listRows.length && !busy && (
                  <li className="print-ss-empty">No substations in selection.</li>
                )}
              </ol>
              <p className="print-side-foot">* Proposed</p>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}
