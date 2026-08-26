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

export function nscStampOf(s: NscStamp | null | undefined) {
  if (!s) return '';
  return `${s.report_date || ''}|${s.updated_at || ''}|${s.pending || 0}|${s.withheld || 0}`;
}

export function nscLiveStamp() {
  return liveStamp;
}

export function nscSetLiveStamp(stamp: string) {
  liveStamp = stamp;
}

async function db() {
  return openDB<NscDB>('dro-ops-nsc', 4, {
    upgrade(database, oldVersion) {
      if (!database.objectStoreNames.contains('meta')) database.createObjectStore('meta');
      // row shape gained agency_name: drop cached queues so they refetch once
      if (oldVersion < 4 && database.objectStoreNames.contains('queue')) database.deleteObjectStore('queue');
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
  return queueMem.get(queue) || null;
}

export async function nscCacheGetQueue(queue: NscQueue): Promise<NscQueueSnap | null> {
  const mem = queueMem.get(queue);
  if (mem) return mem;
  try {
    const handle = await db();
    const row = (await handle.get('queue', queue)) || null;
    if (row) queueMem.set(queue, row);
    return row;
  } catch {
    return null;
  }
}

export async function nscCachePutQueue(snap: NscQueueSnap) {
  queueMem.set(snap.queue, snap);
  try {
    const handle = await db();
    await handle.put('queue', snap, snap.queue);
  } catch {
    /* keep memory */
  }
}

export async function nscCacheGetMeta(): Promise<(NscStamp & { fetchedAt: number }) | null> {
  try {
    const handle = await db();
    return (await handle.get('meta', 'stamp')) || null;
  } catch {
    return null;
  }
}

export async function nscCachePutMeta(stamp: NscStamp) {
  try {
    const handle = await db();
    await handle.put('meta', { ...stamp, fetchedAt: Date.now() }, 'stamp');
  } catch {
    /* ignore */
  }
}
