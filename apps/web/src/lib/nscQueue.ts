import { api } from '../api';
import type { NscQueue } from './nsc';
import { hydrateChartRow, type NscChartRow } from './nscDesk';
import {
  nscCacheGetMeta,
  nscCacheGetQueue,
  nscCachePutMeta,
  nscCachePutQueue,
  nscLiveStamp,
  nscQueueMemGet,
  nscSetLiveStamp,
  nscVersionOf,
  nscVersionOfSnap,
  type NscQueueSnap,
  type NscStamp,
} from './nscCache';

export type { NscQueueSnap };

const inflight = new Map<string, Promise<NscQueueSnap>>();
let lastStampAt = 0;
/** Dump usually changes once a day. Recheck the cheap status stamp at most every 6 hours. */
const STAMP_TTL_MS = 6 * 60 * 60 * 1000;

function asQueue(q: string): NscQueue {
  return q === 'withheld' ? 'withheld' : 'pending';
}

function hydrateRows(rows: NscChartRow[]) {
  return (Array.isArray(rows) ? rows : []).map(hydrateChartRow);
}

function snapFromPayload(
  queue: NscQueue,
  payload: Awaited<ReturnType<typeof api.nscQueue>>,
  stamp: NscStamp,
  stampKey: string
): NscQueueSnap {
  return {
    stamp: stampKey,
    version: stampKey,
    queue,
    rows: hydrateRows(payload.rows),
    divisions: payload.divisions || [],
    cccs: payload.cccs || [],
    pending: stamp.pending,
    withheld: stamp.withheld,
    report_date: stamp.report_date || payload.report_date || null,
    fetchedAt: Date.now(),
  };
}

async function fetchStamp(force = false): Promise<{ key: string; stamp: NscStamp }> {
  if (!force && nscLiveStamp() && Date.now() - lastStampAt < STAMP_TTL_MS) {
    const meta = await nscCacheGetMeta();
    if (meta) return { key: nscLiveStamp() || nscVersionOf(meta), stamp: meta };
  }
  const st = await api.nscStatus();
  const key = nscVersionOf(st);
  lastStampAt = Date.now();
  nscSetLiveStamp(key);
  await nscCachePutMeta(st);
  return { key, stamp: st };
}

async function fetchQueueNetwork(queue: NscQueue, stamp?: { key: string; stamp: NscStamp }): Promise<NscQueueSnap> {
  const [st, payload] = await Promise.all([
    stamp ? Promise.resolve(stamp) : fetchStamp(),
    api.nscQueue(queue),
  ]);
  const snap = snapFromPayload(queue, payload, st.stamp, st.key);
  await nscCachePutQueue(snap);
  return snap;
}

export async function ensureNscQueue(
  queue: NscQueue,
  opts: { force?: boolean; onUpdate?: (snap: NscQueueSnap) => void } = {}
): Promise<NscQueueSnap> {
  const q = asQueue(queue);
  const cached = nscQueueMemGet(q) || (await nscCacheGetQueue(q));
  const cachedVer = nscVersionOfSnap(cached);
  const live = nscLiveStamp();

  if (!opts.force && cached) {
    if (!live || cachedVer === live) {
      const due = !live || Date.now() - lastStampAt > STAMP_TTL_MS;
      if (due) {
        revalidateNscQueue(q, cached)
          .then((next) => {
            if (next && nscVersionOfSnap(next) !== cachedVer) opts.onUpdate?.(next);
          })
          .catch(() => undefined);
      }
      return cached;
    }
  }

  const existing = inflight.get(q);
  if (existing && !opts.force) return existing;

  const p = fetchQueueNetwork(q).finally(() => {
    if (inflight.get(q) === p) inflight.delete(q);
  });
  inflight.set(q, p);
  return p;
}

async function revalidateNscQueue(queue: NscQueue, cached: NscQueueSnap): Promise<NscQueueSnap | null> {
  try {
    const st = await fetchStamp(true);
    if (st.key === nscVersionOfSnap(cached)) return cached;
    const existing = inflight.get(queue);
    if (existing) return existing;
    const p = fetchQueueNetwork(queue, st).finally(() => {
      if (inflight.get(queue) === p) inflight.delete(queue);
    });
    inflight.set(queue, p);
    return p;
  } catch {
    return cached;
  }
}

export function prefetchNscQueue(queue: NscQueue) {
  ensureNscQueue(queue).catch(() => undefined);
}

export async function warmNscStamp() {
  if (nscLiveStamp()) return;
  const meta = await nscCacheGetMeta();
  if (meta) nscSetLiveStamp(nscVersionOf(meta));
}
