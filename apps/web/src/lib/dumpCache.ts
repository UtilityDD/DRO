import { openDB, type DBSchema } from 'idb';

/**
 * Versioned desk dumps (ATC, later Disco / grievances / …).
 * A dump is reused until its version changes — usually one upload a day.
 */

export type DumpSnap<T> = {
  dataset: string;
  version: string;
  data: T;
  fetchedAt: number;
};

interface DumpDB extends DBSchema {
  dumps: { key: string; value: DumpSnap<unknown> };
}

const mem = new Map<string, DumpSnap<unknown>>();
let cacheUser = '';

function dumpKey(dataset: string) {
  return cacheUser ? `${cacheUser}|${dataset}` : dataset;
}

export function dumpBindUser(username: string | null | undefined) {
  const next = String(username || '').trim().toLowerCase();
  if (next === cacheUser) return;
  cacheUser = next;
  mem.clear();
}

export function dumpClear() {
  mem.clear();
  cacheUser = '';
  void dropStores();
}

async function dropStores() {
  try {
    const handle = await db();
    await handle.clear('dumps');
  } catch {
    /* ignore */
  }
}

async function db() {
  return openDB<DumpDB>('dro-ops-dumps', 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains('dumps')) database.createObjectStore('dumps');
    },
  });
}

export function dumpMemGet<T>(dataset: string): DumpSnap<T> | null {
  return (mem.get(dumpKey(dataset)) as DumpSnap<T> | undefined) || null;
}

export async function dumpGet<T>(dataset: string): Promise<DumpSnap<T> | null> {
  const key = dumpKey(dataset);
  const hit = mem.get(key) as DumpSnap<T> | undefined;
  if (hit) return hit;
  try {
    const handle = await db();
    const row = ((await handle.get('dumps', key)) as DumpSnap<T> | undefined) || null;
    if (row) mem.set(key, row);
    return row;
  } catch {
    return null;
  }
}

export async function dumpPut<T>(dataset: string, version: string, data: T): Promise<DumpSnap<T>> {
  const snap: DumpSnap<T> = { dataset, version, data, fetchedAt: Date.now() };
  const key = dumpKey(dataset);
  mem.set(key, snap);
  try {
    const handle = await db();
    await handle.put('dumps', snap, key);
  } catch {
    /* memory only */
  }
  return snap;
}
