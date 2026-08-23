/** District boundary helpers for editor authorization (point-in-polygon). */

const WB_DISTRICTS_URL =
  'https://cdn.jsdelivr.net/gh/udit-001/india-maps-data@2884453/geojson/states/west-bengal.geojson';

type Ring = number[][];
type DistrictPoly = { name: string; rings: Ring[] };

let cache: DistrictPoly[] | null = null;
let loadPromise: Promise<DistrictPoly[]> | null = null;

function featureName(props: Record<string, unknown> | null | undefined): string {
  if (!props) return 'District';
  const keys = ['district', 'DISTRICT', 'name', 'NAME', 'dtname', 'DTNAME'];
  for (const k of keys) {
    const v = props[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return 'District';
}

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

function pointInDistrict(lng: number, lat: number, d: DistrictPoly): boolean {
  return d.rings.some((ring) => pointInRing(lng, lat, ring));
}

export async function loadDistrictPolygons(): Promise<DistrictPoly[]> {
  if (cache) return cache;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const res = await fetch(WB_DISTRICTS_URL);
    const data = (await res.json()) as {
      features: Array<{
        properties?: Record<string, unknown>;
        geometry?: {
          type: string;
          coordinates: number[][][] | number[][][][];
        } | null;
      }>;
    };
    const list: DistrictPoly[] = [];
    for (const f of data.features ?? []) {
      const g = f.geometry;
      if (!g) continue;
      const rings: Ring[] = [];
      if (g.type === 'Polygon') {
        rings.push((g.coordinates as number[][][])[0]);
      } else if (g.type === 'MultiPolygon') {
        for (const poly of g.coordinates as number[][][][]) rings.push(poly[0]);
      }
      if (!rings.length) continue;
      list.push({ name: featureName(f.properties), rings });
    }
    cache = list;
    return list;
  })();
  return loadPromise;
}

export async function districtAt(lat: number, lng: number): Promise<string | null> {
  const districts = await loadDistrictPolygons();
  const hit = districts.find((d) => pointInDistrict(lng, lat, d));
  return hit?.name ?? null;
}

export async function substationIdsInDistricts(
  substations: Array<{ id: string; lat: number; lng: number }>,
  districtNames: string[],
): Promise<string[]> {
  if (!districtNames.length) return [];
  const want = new Set(districtNames.map((n) => n.toLowerCase()));
  const districts = await loadDistrictPolygons();
  const matched = districts.filter((d) => want.has(d.name.toLowerCase()));
  if (!matched.length) return [];
  const ids: string[] = [];
  for (const ss of substations) {
    if (matched.some((d) => pointInDistrict(ss.lng, ss.lat, d))) ids.push(ss.id);
  }
  return ids;
}
