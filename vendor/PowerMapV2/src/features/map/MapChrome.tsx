import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type L from 'leaflet';
import { Layers, RotateCcw, RotateCw } from 'lucide-react';
import { useNetworkStore } from '@/store/networkStore';
import type { MapLayerSettings } from '@/domain/types';

type BasemapId = MapLayerSettings['basemap'];

const BASEMAPS: { id: BasemapId; label: string; title: string }[] = [
  { id: 'google', label: 'Roads', title: 'Google Roads' },
  { id: 'google-hybrid', label: 'Hybrid', title: 'Google Hybrid' },
  { id: 'osm', label: 'OSM', title: 'OpenStreetMap' },
  { id: 'esri', label: 'Gray', title: 'Light canvas' },
  { id: 'none', label: 'Off', title: 'No basemap' },
];

function normBearing(deg: number) {
  const n = ((deg % 360) + 360) % 360;
  return n > 359.5 || n < 0.5 ? 0 : n;
}

function pointerAngle(el: HTMLElement, clientX: number, clientY: number) {
  const r = el.getBoundingClientRect();
  const x = clientX - (r.left + r.width / 2);
  const y = clientY - (r.top + r.height / 2);
  const deg = (Math.atan2(x, -y) * 180) / Math.PI;
  return normBearing(deg);
}

export function MapChrome({ map }: { map: L.Map | null }) {
  const basemap = useNetworkStore((s) => s.mapLayers.basemap);
  const setMapLayers = useNetworkStore((s) => s.setMapLayers);
  const mapHomeNonce = useNetworkStore((s) => s.mapHomeNonce);
  const [open, setOpen] = useState(false);
  const [bearing, setBearing] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const discRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{ pointerId: number; moved: boolean } | null>(null);

  const current = BASEMAPS.find((b) => b.id === basemap) ?? BASEMAPS[0];

  useEffect(() => {
    if (!map) return;
    const sync = () => setBearing(normBearing(map.getBearing?.() ?? 0));
    sync();
    map.on('rotate', sync);
    return () => {
      map.off('rotate', sync);
    };
  }, [map]);

  useEffect(() => {
    if (!mapHomeNonce) return;
    setBearing(0);
    setOpen(false);
    map?.setBearing?.(0);
  }, [mapHomeNonce, map]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const applyBearing = (deg: number) => {
    const next = normBearing(deg);
    setBearing(next);
    map?.setBearing?.(next);
  };

  const onDiscPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (!map || e.button !== 0) return;
    const el = discRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    dragRef.current = { pointerId: e.pointerId, moved: false };
  };

  const onDiscPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    const el = discRef.current;
    if (!drag || drag.pointerId !== e.pointerId || !el) return;
    if (Math.hypot(e.movementX, e.movementY) > 1) drag.moved = true;
    if (drag.moved) applyBearing(pointerAngle(el, e.clientX, e.clientY));
  };

  const onDiscPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (!drag.moved) applyBearing(0);
  };

  return (
    <div className="pm-map-chrome" ref={wrapRef}>
      <div className={`pm-basemap-picker${open ? ' is-open' : ''}`}>
        {open && (
          <div className="pm-basemap-menu" role="listbox" aria-label="Basemap">
            {BASEMAPS.map((b) => (
              <button
                key={b.id}
                type="button"
                role="option"
                aria-selected={b.id === basemap}
                className={b.id === basemap ? 'on' : ''}
                title={b.title}
                onClick={() => {
                  setMapLayers({ basemap: b.id });
                  setOpen(false);
                }}
              >
                <span className={`pm-basemap-swatch pm-basemap-swatch--${b.id}`} />
                {b.label}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          className="pm-basemap-toggle"
          aria-expanded={open}
          aria-haspopup="listbox"
          title={`Basemap · ${current.title}`}
          onClick={() => setOpen((v) => !v)}
        >
          <Layers size={15} strokeWidth={1.9} />
          <span>{current.label}</span>
        </button>
      </div>

      <div className="pm-compass-cluster">
        <button
          type="button"
          className="pm-rotate-btn"
          title="Rotate left 15°"
          aria-label="Rotate map left"
          disabled={!map}
          onClick={() => applyBearing(bearing - 15)}
        >
          <RotateCcw size={14} strokeWidth={2} />
        </button>
        <button
          type="button"
          ref={discRef}
          className="pm-compass"
          title="North. Click to reset. Drag to rotate. Right-drag the map, or pinch-rotate."
          aria-label={`North. Map bearing ${Math.round(bearing)} degrees. Click to reset.`}
          disabled={!map}
          onPointerDown={onDiscPointerDown}
          onPointerMove={onDiscPointerMove}
          onPointerUp={onDiscPointerUp}
          onPointerCancel={onDiscPointerUp}
        >
          <span className="pm-compass-rose" style={{ transform: `rotate(${-bearing}deg)` }}>
            <svg viewBox="0 0 40 40" aria-hidden>
              <circle cx="20" cy="20" r="18.5" />
              <polygon className="pm-compass-n" points="20,5 23.6,20 20,17.2 16.4,20" />
              <polygon className="pm-compass-s" points="20,35 23.6,20 20,22.8 16.4,20" />
              <text x="20" y="12.2">
                N
              </text>
            </svg>
          </span>
        </button>
        <button
          type="button"
          className="pm-rotate-btn"
          title="Rotate right 15°"
          aria-label="Rotate map right"
          disabled={!map}
          onClick={() => applyBearing(bearing + 15)}
        >
          <RotateCw size={14} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
