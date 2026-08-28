/**
 * Rebuilds the West Bengal boundary assets in apps/web/public/geo from OpenStreetMap.
 *
 * Taking the admin boundaries from OSM makes the outlines sit exactly on the
 * borders drawn by the OSM basemap tiles. It also means neighbouring areas share
 * the same OSM ways, so the state mask dissolved from these polygons has no seams.
 *
 * Usage:  node scripts/build-wb-districts.mjs [districts|blocks|all] [--refetch]
 * The raw Overpass response for each level is cached so the geometry can be
 * reprocessed without hammering the API.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GEO_DIR = path.join(ROOT, 'apps', 'web', 'public', 'geo');

const ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

/**
 * In West Bengal, OSM tags districts as admin_level 5 and CD blocks (plus a few
 * hill subdivisions, which have no blocks) as admin_level 6.
 */
const TARGETS = {
  districts: {
    level: 5,
    out: 'wb-districts.geojson',
    cache: 'tmp_osm_wb_districts.json',
    nameProp: 'district',
    expectCount: 23,
  },
  blocks: {
    level: 6,
    out: 'wb-blocks.geojson',
    cache: 'tmp_osm_wb_blocks.json',
    nameProp: 'block',
    expectCount: 345,
  },
};

const query = (level) => `
[out:json][timeout:600];
rel["boundary"="administrative"]["admin_level"="4"]["name"="West Bengal"];
map_to_area -> .wb;
rel(area.wb)["boundary"="administrative"]["admin_level"="${level}"];
out body geom;
`;

/** OSM spellings that differ from the names the rest of the app uses. */
const NAME_FIXUPS = new Map(
  Object.entries({
    Maldah: 'Malda',
    Darjiling: 'Darjeeling',
    Puruliya: 'Purulia',
    'Koch Bihar': 'Cooch Behar',
  }),
);

/** The 23 districts the app expects; a mismatch means the map UI would break. */
const EXPECTED = [
  'Alipurduar', 'Bankura', 'Birbhum', 'Cooch Behar', 'Dakshin Dinajpur', 'Darjeeling',
  'Hooghly', 'Howrah', 'Jalpaiguri', 'Jhargram', 'Kalimpong', 'Kolkata', 'Malda',
  'Murshidabad', 'Nadia', 'North 24 Parganas', 'Paschim Bardhaman', 'Paschim Medinipur',
  'Purba Bardhaman', 'Purba Medinipur', 'Purulia', 'South 24 Parganas', 'Uttar Dinajpur',
];

function cleanName(tags) {
  const raw = (tags?.['name:en'] || tags?.name || '').trim();
  const stripped = raw.replace(/\s+district$/i, '').trim();
  return NAME_FIXUPS.get(stripped) ?? stripped;
}

async function fetchOverpass(level) {
  let lastErr;
  for (const url of ENDPOINTS) {
    try {
      process.stdout.write(`querying ${url} (admin_level ${level}) ... `);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'DRO-PowerMap/1.0 (boundary build script)',
        },
        body: new URLSearchParams({ data: query(level) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      console.log(`ok (${(text.length / 1e6).toFixed(1)} MB)`);
      return JSON.parse(text);
    } catch (err) {
      console.log(`failed: ${err.message}`);
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('all Overpass endpoints failed');
}

const PRECISION = 1e5; // ~1 m, well below anything visible on screen
const round = (v) => Math.round(v * PRECISION) / PRECISION;
const key = (p) => `${p[0]},${p[1]}`;

/** Join OSM ways end-to-end into closed rings. */
function stitch(ways) {
  const segments = ways
    .map((w) => (w.geometry ?? []).filter(Boolean).map((p) => [round(p.lon), round(p.lat)]))
    .map((g) => g.filter((p, i, arr) => i === 0 || key(p) !== key(arr[i - 1])))
    .filter((g) => g.length >= 2);

  const used = new Array(segments.length).fill(false);
  const rings = [];
  let unclosed = 0;

  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    let ring = segments[i].slice();

    while (key(ring[0]) !== key(ring[ring.length - 1])) {
      const head = key(ring[0]);
      const tail = key(ring[ring.length - 1]);
      let joined = false;
      for (let j = 0; j < segments.length; j++) {
        if (used[j]) continue;
        const s = segments[j];
        const sHead = key(s[0]);
        const sTail = key(s[s.length - 1]);
        if (sHead === tail) ring = ring.concat(s.slice(1));
        else if (sTail === tail) ring = ring.concat(s.slice(0, -1).reverse());
        else if (sTail === head) ring = s.slice(0, -1).concat(ring);
        else if (sHead === head) ring = s.slice(1).reverse().concat(ring);
        else continue;
        used[j] = true;
        joined = true;
        break;
      }
      if (!joined) break;
    }

    if (key(ring[0]) === key(ring[ring.length - 1]) && ring.length >= 4) rings.push(ring);
    else unclosed += 1;
  }

  return { rings, unclosed };
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(a / 2);
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function outerRingsOf(feature) {
  const g = feature.geometry;
  return g.type === 'Polygon' ? [g.coordinates[0]] : g.coordinates.map((p) => p[0]);
}

/**
 * A point guaranteed to be inside `ring`: scan a horizontal line at height `y`,
 * then take the midpoint of the widest span enclosed by the ring. A plain
 * centroid is not enough because many blocks are concave.
 */
function pointOnScanline(ring, y) {
  const xs = [];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y) xs.push(xi + ((xj - xi) * (y - yi)) / (yj - yi));
  }
  xs.sort((a, b) => a - b);
  let best = null;
  let bestWidth = -1;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const width = xs[i + 1] - xs[i];
    if (width > bestWidth) {
      bestWidth = width;
      best = (xs[i] + xs[i + 1]) / 2;
    }
  }
  return best === null ? null : [best, y];
}

/** Interior sample points across the largest ring, widest span first. */
function interiorPoints(feature) {
  const rings = outerRingsOf(feature);
  const ring = rings.reduce((best, r) => (ringArea(r) > ringArea(best) ? r : best), rings[0]);
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of ring) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const points = [];
  for (const t of [0.5, 0.35, 0.65, 0.2, 0.8, 0.45, 0.55]) {
    const p = pointOnScanline(ring, minY + (maxY - minY) * t);
    if (p) points.push(p);
  }
  return points;
}

/**
 * Assign every block to its district by containment. Blocks nest inside
 * districts, so an interior point of the block identifies the district
 * unambiguously — unlike shared boundary vertices, which a block on a district
 * border shares equally with the neighbour.
 */
function assignParentDistricts(blocks, districts) {
  let unmatched = 0;
  for (const f of blocks) {
    let host = null;
    for (const p of interiorPoints(f)) {
      host = districts.find((d) => outerRingsOf(d).some((r) => pointInRing(p, r)));
      if (host) break;
    }
    if (host) f.properties.district = host.properties.district;
    else {
      console.warn(`  ! ${f.properties.block}: no parent district found`);
      unmatched += 1;
    }
  }
  return unmatched;
}

async function buildTarget(name, target, refetch) {
  console.log(`\n=== ${name} (admin_level ${target.level}) ===`);
  const cachePath = path.join(ROOT, target.cache);
  let raw;
  if (!refetch && existsSync(cachePath)) {
    console.log('using cached Overpass response');
    raw = JSON.parse(await readFile(cachePath, 'utf8'));
  } else {
    raw = await fetchOverpass(target.level);
    await writeFile(cachePath, JSON.stringify(raw));
  }

  const relations = (raw.elements ?? []).filter((e) => e.type === 'relation');
  const features = [];
  let totalPoints = 0;
  let skipped = 0;

  for (const rel of relations) {
    const label = cleanName(rel.tags);
    const members = rel.members ?? [];
    const outer = stitch(members.filter((m) => m.type === 'way' && m.role !== 'inner'));
    const inner = stitch(members.filter((m) => m.type === 'way' && m.role === 'inner'));

    if (!outer.rings.length) {
      console.warn(`  ! ${label}: no closed outer ring, skipped`);
      skipped += 1;
      continue;
    }
    if (outer.unclosed) console.warn(`  ! ${label}: ${outer.unclosed} unclosed outer chain(s)`);

    outer.rings.sort((a, b) => ringArea(b) - ringArea(a));
    const polygons = outer.rings.map((r) => [r]);
    for (const hole of inner.rings) {
      const host = polygons.find((p) => pointInRing(hole[0], p[0]));
      if (host) host.push(hole);
    }

    totalPoints += outer.rings.reduce((n, r) => n + r.length, 0);
    features.push({
      type: 'Feature',
      properties: { [target.nameProp]: label, osm_id: rel.id },
      geometry:
        polygons.length === 1
          ? { type: 'Polygon', coordinates: polygons[0] }
          : { type: 'MultiPolygon', coordinates: polygons },
    });
  }

  features.sort((a, b) =>
    a.properties[target.nameProp].localeCompare(b.properties[target.nameProp]),
  );

  const outerRings = features.flatMap(outerRingsOf);
  const dissolved = dissolveCheck(outerRings);

  console.log(`relations: ${relations.length} | features: ${features.length} | skipped: ${skipped}`);
  console.log(`outer rings: ${outerRings.length} | outer points: ${totalPoints}`);
  console.log(
    dissolved
      ? `dissolve: ok -> ${dissolved.rings} state ring(s), ${dissolved.dropped} shared edges removed`
      : 'dissolve: FAILED',
  );

  return { features, dissolved };
}

async function writeFC(fileName, features) {
  const json = JSON.stringify({ type: 'FeatureCollection', features });
  await mkdir(GEO_DIR, { recursive: true });
  const out = path.join(GEO_DIR, fileName);
  await writeFile(out, json);
  console.log(
    `wrote ${path.relative(ROOT, out)} (${(Buffer.byteLength(json) / 1e6).toFixed(2)} MB)`,
  );
}

async function main() {
  const args = process.argv.slice(2);
  const refetch = args.includes('--refetch');
  const which = args.find((a) => !a.startsWith('--')) ?? 'all';
  const doDistricts = which === 'all' || which === 'districts';
  const doBlocks = which === 'all' || which === 'blocks';
  let failed = false;

  let districtFeatures = null;

  if (doDistricts) {
    const { features, dissolved } = await buildTarget('districts', TARGETS.districts, refetch);
    districtFeatures = features;
    const got = features.map((f) => f.properties.district);
    const missing = EXPECTED.filter((n) => !got.includes(n));
    const extra = got.filter((n) => !EXPECTED.includes(n));
    if (missing.length) console.error(`MISSING districts: ${missing.join(', ')}`);
    if (extra.length) console.error(`UNEXPECTED districts: ${extra.join(', ')}`);
    console.log(got.join(', '));
    await writeFC(TARGETS.districts.out, features);
    if (missing.length || extra.length || !dissolved) failed = true;
  }

  if (doBlocks) {
    const { features, dissolved } = await buildTarget('blocks', TARGETS.blocks, refetch);

    if (!districtFeatures) {
      const existing = path.join(GEO_DIR, TARGETS.districts.out);
      if (existsSync(existing)) {
        districtFeatures = JSON.parse(await readFile(existing, 'utf8')).features;
      }
    }

    // Tag each block with its district so the map can label and filter blocks
    // without a second lookup; block names alone are ambiguous (two "Sankrail").
    if (districtFeatures) {
      const unmatched = assignParentDistricts(features, districtFeatures);
      console.log(
        unmatched
          ? `parent district: ${features.length - unmatched}/${features.length} matched, ${unmatched} UNMATCHED`
          : `parent district: all ${features.length} blocks matched`,
      );
      if (unmatched) failed = true;
    } else {
      console.warn('districts file not available; blocks written without parent district');
    }

    await writeFC(TARGETS.blocks.out, features);
    if (!dissolved) failed = true;
  }

  if (failed) process.exitCode = 1;
}

/** Mirrors dissolveRings() in boundaryLayers.ts so the build catches breakage. */
function dissolveCheck(rings) {
  const edges = new Map();
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const ka = key(a);
      const kb = key(b);
      if (ka === kb) continue;
      const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const hit = edges.get(k);
      if (hit) hit.count += 1;
      else edges.set(k, { a, b, ka, kb, count: 1 });
    }
  }
  const perimeter = [];
  let dropped = 0;
  for (const e of edges.values()) {
    if (e.count === 1) perimeter.push(e);
    else dropped += 1;
  }
  if (!perimeter.length) return null;

  const adjacency = new Map();
  perimeter.forEach((e, i) => {
    for (const k of [e.ka, e.kb]) {
      const list = adjacency.get(k);
      if (list) list.push(i);
      else adjacency.set(k, [i]);
    }
  });

  const used = new Set();
  let count = 0;
  for (let i = 0; i < perimeter.length; i++) {
    if (used.has(i)) continue;
    const first = perimeter[i];
    used.add(i);
    let cursor = first.kb;
    let len = 2;
    while (cursor !== first.ka) {
      let next = -1;
      for (const c of adjacency.get(cursor) ?? []) {
        if (!used.has(c)) {
          next = c;
          break;
        }
      }
      if (next < 0) return null;
      used.add(next);
      const e = perimeter[next];
      const forward = e.ka === cursor;
      cursor = forward ? e.kb : e.ka;
      len += 1;
    }
    if (len >= 4) count += 1;
  }
  return { rings: count, dropped };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
