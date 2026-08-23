import type { AssetLifecycle, VoltageCode } from '@/domain/types';
import { VOLTAGE_CATALOG } from '@/domain/types';
import L from 'leaflet';

export function voltageColor(code: VoltageCode): string {
  return VOLTAGE_CATALOG.find((v) => v.code === code)?.color ?? '#64748b';
}

/** SVG symbol by voltage: square / diamond / hexagon / circle */
export function substationIcon(
  voltage: VoltageCode,
  status: AssetLifecycle,
  selected = false,
): L.DivIcon {
  const color = voltageColor(voltage);
  const filled = status === 'existing';
  const size = selected ? 28 : 22;
  const stroke = selected ? 3 : 2;
  const shape = shapeSvg(voltage, size, color, filled, stroke);

  return L.divIcon({
    className: 'pm-ss-icon',
    html: `<div class="pm-ss-wrap${selected ? ' is-selected' : ''}" style="width:${size}px;height:${size}px">${shape}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function shapeSvg(
  voltage: VoltageCode,
  size: number,
  color: string,
  filled: boolean,
  stroke: number,
): string {
  const fill = filled ? color : 'transparent';
  const common = `fill="${fill}" stroke="${color}" stroke-width="${stroke}"`;

  if (voltage === '400') {
    const pad = 3;
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect x="${pad}" y="${pad}" width="${size - pad * 2}" height="${size - pad * 2}" ${common}/></svg>`;
  }
  if (voltage === '220') {
    const c = size / 2;
    const r = size / 2 - 3;
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><polygon points="${c},${c - r} ${c + r},${c} ${c},${c + r} ${c - r},${c}" ${common}/></svg>`;
  }
  if (voltage === '132') {
    const c = size / 2;
    const r = size / 2 - 3;
    const pts = [0, 1, 2, 3, 4, 5]
      .map((i) => {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        return `${c + r * Math.cos(a)},${c + r * Math.sin(a)}`;
      })
      .join(' ');
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><polygon points="${pts}" ${common}/></svg>`;
  }
  // 33 kV circle
  const c = size / 2;
  const r = size / 2 - 3;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${c}" cy="${c}" r="${r}" ${common}/></svg>`;
}

export function tapIcon(selected = false): L.DivIcon {
  const size = selected ? 16 : 12;
  return L.divIcon({
    className: 'pm-tap-icon',
    html: `<div class="pm-tap-mark${selected ? ' is-selected' : ''}" style="width:${size}px;height:${size}px"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export function lineStyle(
  voltage: VoltageCode,
  status: AssetLifecycle,
  selected = false,
  isTap = false,
  opts?: { circuitIndex?: number; parallelTotal?: number },
): L.PolylineOptions {
  const parallel = (opts?.parallelTotal ?? 1) > 1;
  const ckt2 = parallel && (opts?.circuitIndex ?? 0) > 0;

  return {
    color: voltageColor(voltage),
    weight: selected ? (isTap ? 4 : 5.5) : isTap ? 2.5 : ckt2 ? 3.2 : 3.8,
    opacity: selected ? 1 : ckt2 ? 0.95 : 0.88,
    dashArray: status === 'proposed' ? '8 6' : undefined,
    lineCap: 'round',
    lineJoin: 'round',
  };
}
