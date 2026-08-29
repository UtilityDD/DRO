import { api } from '../api';
import { dumpGet, dumpMemGet, dumpPut, type DumpSnap } from './dumpCache';

export type AtcDumpPayload = {
  rows: Record<string, unknown>[];
  periods: string[];
  version: string;
};

export type AtcStamp = {
  latest_period: string | null;
  count: number;
  version: string;
};

const DATASET = 'atc';
const inflight = new Map<string, Promise<DumpSnap<AtcDumpPayload>>>();
let liveVersion = '';
let lastStampAt = 0;
const STAMP_TTL_MS = 6 * 60 * 60 * 1000;

export function atcVersionOf(s: { latest_period?: string | null; count?: number } | null | undefined) {
  if (!s) return '';
  return `${String(s.latest_period || '').trim()}|n${Number(s.count) || 0}`;
}

export function atcLiveVersion() {
  return liveVersion;
}

export async function warmAtcStamp() {
  if (liveVersion) return;
  const cached = await dumpGet<AtcDumpPayload>(DATASET);
  if (cached?.version) liveVersion = cached.version;
}

async function fetchStamp(force = false): Promise<AtcStamp> {
  if (!force && liveVersion && Date.now() - lastStampAt < STAMP_TTL_MS) {
    return { latest_period: null, count: 0, version: liveVersion };
  }
  const st = await api.atcStatus();
  const version = st.version || atcVersionOf(st);
  liveVersion = version;
  lastStampAt = Date.now();
  return { ...st, version };
}

async function fetchDumpNetwork(refresh = false): Promise<DumpSnap<AtcDumpPayload>> {
  const [st, payload] = await Promise.all([fetchStamp(refresh), api.atcQuery(refresh ? 'refresh=1' : '')]);
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const periods = Array.isArray(payload.periods) ? payload.periods : [];
  const version = st.version || payload.version || atcVersionOf({ latest_period: periods[periods.length - 1], count: rows.length });
  liveVersion = version;
  return dumpPut(DATASET, version, { rows, periods, version });
}

export async function ensureAtcDump(
  opts: { force?: boolean; onUpdate?: (snap: DumpSnap<AtcDumpPayload>) => void } = {}
): Promise<DumpSnap<AtcDumpPayload>> {
  const cached = dumpMemGet<AtcDumpPayload>(DATASET) || (await dumpGet<AtcDumpPayload>(DATASET));
  if (!opts.force && cached) {
    if (!liveVersion || cached.version === liveVersion) {
      const due = !liveVersion || Date.now() - lastStampAt > STAMP_TTL_MS;
      if (due) {
        revalidate(cached)
          .then((next) => {
            if (next && next.version !== cached.version) opts.onUpdate?.(next);
          })
          .catch(() => undefined);
      }
      return cached;
    }
  }

  const existing = inflight.get(DATASET);
  if (existing && !opts.force) return existing;

  const p = fetchDumpNetwork(Boolean(opts.force) || Boolean(cached && liveVersion && cached.version !== liveVersion)).finally(() => {
    if (inflight.get(DATASET) === p) inflight.delete(DATASET);
  });
  inflight.set(DATASET, p);
  return p;
}

async function revalidate(cached: DumpSnap<AtcDumpPayload>): Promise<DumpSnap<AtcDumpPayload> | null> {
  try {
    const st = await fetchStamp(true);
    if (st.version === cached.version) return cached;
    return fetchDumpNetwork(true);
  } catch {
    return cached;
  }
}

export function prefetchAtcDump() {
  ensureAtcDump().catch(() => undefined);
}

export async function atcDumpMergeRow(row: Record<string, unknown>) {
  const cached = dumpMemGet<AtcDumpPayload>(DATASET) || (await dumpGet<AtcDumpPayload>(DATASET));
  if (!cached) return;
  const period = String(row.period_label || '');
  const office = String(row.office_code || '');
  const fmt = String(row.source_format || 'IA').toUpperCase();
  const rows = cached.data.rows.map((r) =>
    String(r.period_label) === period &&
    String(r.office_code) === office &&
    String(r.source_format || 'IA').toUpperCase() === fmt
      ? { ...r, ...row }
      : r
  );
  await dumpPut(DATASET, cached.version, { ...cached.data, rows });
}
