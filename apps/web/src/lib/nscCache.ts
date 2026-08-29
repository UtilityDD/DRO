import { openDB, type DBSchema } from 'idb';
import type { NscQueue } from './nsc';
import type { NscChartRow, NscOfficeOpt } from './nscDesk';

export type NscStamp = {
  report_date: string | null;
  updated_at: string | null;
  pending: number;
  withheld: number;
  total?: number;
};

export type NscQueueSnap = {
  stamp: string;
  version?: string;
  queue: NscQueue;
  rows: NscChartRow[];
  divisions: NscOfficeOpt[];
  cccs: NscOfficeOpt[];
  pending: number;
  withheld: number;
  report_date: string | null;
  fetchedAt: number;
};

interface NscDB extends DBSchema {
  meta: { key: string; value: NscStamp & { fetchedAt: number } };
  queue: { key: string; value: NscQueueSnap };
}

const queueMem = new Map<string, NscQueueSnap>();
let liveStamp = '';
let cacheUser = '';

function queueKey(queue: NscQueue) {
  return cacheUser ? `${cacheUser}|${queue}` : queue;
}

function metaKey() {
  return cacheUser ? `stamp|${cacheUser}` : 'stamp';
}

/** Bind NSC cache to the signed-in user so another login cannot reuse their rows. */
export function nscCacheBindUser(username: string | null | undefined) {
  const next = String(username || '').trim().toLowerCase();
  if (next === cacheUser) return;
  cacheUser = next;
  queueMem.clear();
  liveStamp = '';
}

export function nscCacheClear() {
  queueMem.clear();
  liveStamp = '';
  cacheUser = '';
  void nscCacheDropStores();
}

async function nscCacheDropStores() {
  try {
    const handle = await db();
    await handle.clear('queue');
    await handle.clear('meta');
  } catch {
    /* ignore */
  }
}

export function nscStampOf(s: NscStamp | null | undefined) {
  if (!s) return '';
  return `${s.report_date || ''}|${s.updated_at || ''}|${s.pending || 0}|${s.withheld || 0}`;
}

/** Daily dump identity. Counts change when a new SAP file is uploaded (once a day, rarely 2–3). */
export function nscVersionOf(s: NscStamp | null | undefined) {
  if (!s) return '';
  return `${String(s.report_date || '').slice(0, 10)}|p${Number(s.pending) || 0}|w${Number(s.withheld) || 0}`;
}

export function nscVersionOfSnap(snap: { version?: string; report_date?: string | null; pending?: number; withheld?: number } | null) {
  if (!snap) return '';
  if (snap.version) return snap.version;
  return nscVersionOf({
    report_date: snap.report_date || null,
    updated_at: null,
    pending: snap.pending || 0,
    withheld: snap.withheld || 0,
  });
}

export function nscLiveStamp() {
  return liveStamp;
}

export function nscSetLiveStamp(stamp: string) {
  liveStamp = stamp;
}

async function db() {
  return openDB<NscDB>('dro-ops-nsc', 8, {
    upgrade(database, oldVersion) {
      if (oldVersion < 8) {
        if (database.objectStoreNames.contains('queue')) database.deleteObjectStore('queue');
        if (database.objectStoreNames.contains('meta')) database.deleteObjectStore('meta');
      } else {
        if (oldVersion < 7 && database.objectStoreNames.contains('queue')) database.deleteObjectStore('queue');
        if (oldVersion < 6 && database.objectStoreNames.contains('queue')) {
          try {
            database.deleteObjectStore('queue');
          } catch {
            /* already gone */
          }
        }
        if (oldVersion < 5 && database.objectStoreNames.contains('queue')) {
          try {
            database.deleteObjectStore('queue');
          } catch {
            /* already gone */
          }
        }
        if (oldVersion < 4 && database.objectStoreNames.contains('queue')) {
          try {
            database.deleteObjectStore('queue');
          } catch {
            /* already gone */
          }
        }
      }
      if (!database.objectStoreNames.contains('meta')) database.createObjectStore('meta');
      if (!database.objectStoreNames.contains('queue')) database.createObjectStore('queue');
      if (oldVersion < 2 && (database.objectStoreNames as unknown as DOMStringList).contains('nsc')) {
        (database as unknown as { deleteObjectStore(name: string): void }).deleteObjectStore('nsc');
      }
      if (oldVersion < 3 && (database.objectStoreNames as unknown as DOMStringList).contains('desk')) {
        (database as unknown as { deleteObjectStore(name: string): void }).deleteObjectStore('desk');
      }
    },
  });
}

export function nscQueueMemGet(queue: NscQueue) {
  return queueMem.get(queueKey(queue)) || null;
}

export async function nscCacheGetQueue(queue: NscQueue): Promise<NscQueueSnap | null> {
  const key = queueKey(queue);
  const mem = queueMem.get(key);
  if (mem) return mem;
  try {
    const handle = await db();
    const row = (await handle.get('queue', key)) || null;
    if (row) queueMem.set(key, row);
    return row;
  } catch {
    return null;
  }
}

export async function nscCachePutQueue(snap: NscQueueSnap) {
  const key = queueKey(snap.queue);
  queueMem.set(key, snap);
  try {
    const handle = await db();
    await handle.put('queue', snap, key);
  } catch {
    /* keep memory */
  }
}

export async function nscCacheGetMeta(): Promise<(NscStamp & { fetchedAt: number }) | null> {
  try {
    const handle = await db();
    return (await handle.get('meta', metaKey())) || null;
  } catch {
    return null;
  }
}

export async function nscCachePutMeta(stamp: NscStamp) {
  try {
    const handle = await db();
    await handle.put('meta', { ...stamp, fetchedAt: Date.now() }, metaKey());
  } catch {
    /* ignore */
  }
}
