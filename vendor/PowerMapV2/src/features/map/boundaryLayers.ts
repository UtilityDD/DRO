import L from 'leaflet';

/** State outline — used only to punch the outside mask hole. */
const WB_STATE_URL =
  'https://raw.githubusercontent.com/shuklaneerajdev/IndiaStateTopojsonFiles/master/WestBengal.geojson';

/** Clean district polygons for district-level view. */
const WB_DISTRICTS_URL =
  'https://cdn.jsdelivr.net/gh/udit-001/india-maps-data@2884453/geojson/states/west-bengal.geojson';

/**
 * Default map frame: Malda Zone and north Bengal (same as the other Power Map app).
 */
export const DEFAULT_ZONE_BOUNDS: [L.LatLngTuple, L.LatLngTuple] = [
  [24.95, 87.75],
  [27.15, 89.75],
];

/** Tighter zoom on large desktop map panes; slightly looser on small screens. */
export function fitDefaultZone(map: L.Map, bounds: L.LatLngBounds) {
  map.invalidateSize(false);
  const { x, y } = map.getSize();
  const desktop = x >= 1000 || y >= 640;
  const pad = desktop ? -0.1 : -0.02;
  map.fitBounds(bounds.pad(pad), {
    animate: false,
    maxZoom: desktop ? 10 : 9,
  });
}

export type BasemapId = 'google' | 'google-hybrid' | 'osm' | 'carto' | 'none';

export interface BoundaryLayerOptions {
  showMask: boolean;
  maskOpacity: number;
  showDistricts: boolean;
  showDistrictLabels: boolean;
  /** Empty = all undimmed (unless dimAllDistricts). Non-empty = only these stay bright. */
  focusedDistricts: string[];
  dimAllDistricts: boolean;
  /** Allow clicking districts to focus (cursor tool). */
  districtsInteractive: boolean;
  onDistrictClick?: (name: string, additive: boolean) => void;
}

export interface BoundaryHandle {
  group: L.LayerGroup;
  bounds: L.LatLngBounds | null;
  districtNames: string[];
  apply: (opts: BoundaryLayerOptions) => void;
  destroy: () => void;
}

type GeoJSONGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

type GeoJSONFeature = {
  type: 'Feature';
  properties?: Record<string, unknown>;
  geometry: GeoJSONGeometry | null;
};

type GeoJSONFC = {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
};

function collectOuterRings(data: GeoJSONFC): number[][][] {
  const rings: number[][][] = [];
  for (const feature of data.features) {
    const g = feature.geometry;
    if (!g) continue;
    if (g.type === 'Polygon') rings.push(g.coordinates[0]);
    else if (g.type === 'MultiPolygon') {
      for (const poly of g.coordinates) rings.push(poly[0]);
    }
  }
  return rings;
}

export function districtName(props: Record<string, unknown> | undefined): string {
  if (!props) return 'District';
  for (const k of ['district', 'DISTRICT', 'dtname', 'DT_NAME', 'NAME_2', 'name', 'NAME']) {
    const v = props[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return 'District';
}

function ringCentroid(ring: number[][]): [number, number] {
  let x = 0;
  let y = 0;
  const n = Math.max(ring.length - 1, 1);
  for (let i = 0; i < n; i++) {
    x += ring[i][0];
    y += ring[i][1];
  }
  return [y / n, x / n];
}

function featureCentroid(feature: GeoJSONFeature): [number, number] | null {
  const g = feature.geometry;
  if (!g) return null;
  if (g.type === 'Polygon') return ringCentroid(g.coordinates[0]);
  if (g.type === 'MultiPolygon' && g.coordinates[0]?.[0]) {
    return ringCentroid(g.coordinates[0][0]);
  }
  return null;
}

export function isMaldaAndNorthDistrict(name: string) {
  return /malda|maldah|dinajpur|darjeel|darjil|jalpaiguri|alipurduar|cooch|koch.?bihar|kalimpong/i.test(
    name,
  );
}

/** Bounds covering Malda Zone plus north Bengal districts. */
export function boundsForMaldaAndNorth(districtData: GeoJSONFC | null): L.LatLngBounds {
  const fallback = L.latLngBounds(DEFAULT_ZONE_BOUNDS);
  if (!districtData?.features?.length) return fallback;

  const selected = districtData.features.filter((f) =>
    isMaldaAndNorthDistrict(districtName(f.properties)),
  );
  if (!selected.length) return fallback;

  const layer = L.geoJSON({
    type: 'FeatureCollection',
    features: selected,
  } as GeoJSON.GeoJsonObject);
  const b = layer.getBounds();
  return b.isValid() ? b : fallback;
}

async function fetchGeoJSON(url: string): Promise<GeoJSONFC> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return (await res.json()) as GeoJSONFC;
}

function styleForDistrict(
  name: string,
  focusedDistricts: string[],
  dimAllDistricts: boolean,
): L.PathOptions {
  const focusing = focusedDistricts.length > 0;
  const bright = !dimAllDistricts && (!focusing || focusedDistricts.includes(name));
  if (bright) {
    return {
      color: focusing ? '#0b6e4f' : '#0f766e',
      weight: focusing ? 2 : 1.35,
      opacity: 1,
      fillColor: focusing ? '#0b6e4f' : '#0f766e',
      fillOpacity: focusing ? 0.08 : 0.03,
    };
  }
  return {
    color: '#94a3b8',
    weight: 1,
    opacity: 0.35,
    fillColor: '#0f172a',
    fillOpacity: 0.48,
  };
}

export async function createBoundaryLayers(map: L.Map): Promise<BoundaryHandle> {
  const stateData = await fetchGeoJSON(WB_STATE_URL);
  const rings = collectOuterRings(stateData);

  let districtData: GeoJSONFC | null = null;
  try {
    districtData = await fetchGeoJSON(WB_DISTRICTS_URL);
  } catch {
    districtData = null;
  }

  const districtNames = districtData
    ? [...new Set(districtData.features.map((f) => districtName(f.properties)))].sort((a, b) =>
        a.localeCompare(b),
      )
    : [];

  const maskFeature: GeoJSONFeature = {
    type: 'Feature',
    properties: { role: 'mask' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-180, -90],
          [180, -90],
          [180, 90],
          [-180, 90],
          [-180, -90],
        ],
        ...rings,
      ],
    },
  };

  const group = L.layerGroup().addTo(map);

  const maskLayer = L.geoJSON(maskFeature as GeoJSON.GeoJsonObject, {
    interactive: false,
    style: {
      stroke: false,
      fillColor: '#0f172a',
      fillOpacity: 0.35,
      fillRule: 'evenodd',
    },
  }).addTo(group);

  let clickHandler: BoundaryLayerOptions['onDistrictClick'];
  let latestFocused: string[] = [];
  let latestDimAll = false;

  const districtLayer = districtData
    ? L.geoJSON(districtData as GeoJSON.GeoJsonObject, {
        interactive: false,
        style: (feature) => {
          const name = districtName(feature?.properties as Record<string, unknown>);
          return styleForDistrict(name, latestFocused, latestDimAll);
        },
        onEachFeature: (feature, layer) => {
          const name = districtName(feature.properties as Record<string, unknown>);
          (layer as L.Layer & { __districtName?: string }).__districtName = name;
          layer.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            const additive = Boolean(
              (e as L.LeafletMouseEvent).originalEvent?.shiftKey ||
                (e as L.LeafletMouseEvent).originalEvent?.metaKey ||
                (e as L.LeafletMouseEvent).originalEvent?.ctrlKey,
            );
            clickHandler?.(name, additive);
          });
        },
      })
    : null;

  type LabelEntry = { name: string; marker: L.Marker };
  const labelEntries: LabelEntry[] = [];
  const labelGroup = L.layerGroup();
  if (districtData) {
    for (const feature of districtData.features) {
      const c = featureCentroid(feature);
      if (!c) continue;
      const name = districtName(feature.properties);
      const marker = L.marker(c, {
        interactive: false,
        icon: L.divIcon({
          className: 'pm-district-label',
          html: `<span>${name}</span>`,
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        }),
      });
      labelEntries.push({ name, marker });
      labelGroup.addLayer(marker);
    }
  }

  let bounds: L.LatLngBounds | null = null;
  try {
    bounds = boundsForMaldaAndNorth(districtData);
  } catch {
    bounds = L.latLngBounds(DEFAULT_ZONE_BOUNDS);
  }

  const apply = (opts: BoundaryLayerOptions) => {
    latestFocused = opts.focusedDistricts;
    latestDimAll = opts.dimAllDistricts;
    clickHandler = opts.onDistrictClick;

    if (opts.showMask) {
      if (!group.hasLayer(maskLayer)) maskLayer.addTo(group);
      maskLayer.setStyle({
        stroke: false,
        fillColor: '#0f172a',
        fillOpacity: opts.maskOpacity,
        fillRule: 'evenodd',
      });
    } else if (group.hasLayer(maskLayer)) {
      group.removeLayer(maskLayer);
    }

    if (districtLayer) {
      if (opts.showDistricts) {
        if (!group.hasLayer(districtLayer)) districtLayer.addTo(group);
        districtLayer.eachLayer((layer) => {
          const name =
            (layer as L.Layer & { __districtName?: string }).__districtName ??
            districtName(
              (layer as L.GeoJSON & { feature?: GeoJSONFeature }).feature?.properties,
            );
          if (layer instanceof L.Path) {
            layer.setStyle(
              styleForDistrict(name, opts.focusedDistricts, opts.dimAllDistricts),
            );
          }
        });
        districtLayer.eachLayer((layer) => {
          const el = (layer as L.Path).getElement?.();
          if (el instanceof HTMLElement || el instanceof SVGElement) {
            el.style.pointerEvents = opts.districtsInteractive ? 'auto' : 'none';
          }
          if ('options' in layer) {
            (layer as L.Path).options.interactive = opts.districtsInteractive;
          }
        });
      } else if (group.hasLayer(districtLayer)) {
        group.removeLayer(districtLayer);
      }
    }

    if (opts.showDistricts && opts.showDistrictLabels) {
      if (!group.hasLayer(labelGroup)) labelGroup.addTo(group);
      const focusing = opts.focusedDistricts.length > 0;
      for (const entry of labelEntries) {
        const bright =
          !opts.dimAllDistricts &&
          (!focusing || opts.focusedDistricts.includes(entry.name));
        const el = entry.marker.getElement();
        if (el) {
          el.classList.toggle('is-dimmed', !bright);
          el.classList.toggle('is-focused', focusing && bright);
        }
      }
    } else if (group.hasLayer(labelGroup)) {
      group.removeLayer(labelGroup);
    }

    if (opts.showMask && group.hasLayer(maskLayer)) maskLayer.bringToBack();
  };

  return {
    group,
    bounds,
    districtNames,
    apply,
    destroy: () => group.remove(),
  };
}

export function createBasemapLayer(id: BasemapId): L.TileLayer {
  switch (id) {
    case 'none':
      return L.tileLayer('', {
        maxZoom: 20,
        attribution: 'No basemap',
      });
    case 'google':
      return L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
        maxZoom: 20,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
        attribution: 'Map data &copy; Google',
      });
    case 'google-hybrid':
      return L.tileLayer('https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', {
        maxZoom: 20,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
        attribution: 'Map data &copy; Google',
      });
    case 'osm':
      return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap',
      });
    case 'carto':
    default:
      return L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap &copy; CARTO',
      });
  }
}
