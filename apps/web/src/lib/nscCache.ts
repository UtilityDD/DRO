import { openDB, type DBSchema } from 'idb';
import type { NscRow } from './nsc';

type Snap = {
  reportDate: string | null;
  fetchedAt: number;
  rows: NscRow[];
};

interface NscDB extends DBSchema {
  nsc: {
    key: string;
    value: Snap;
  };
}

async function db() {
  return openDB<NscDB>('dro-ops-nsc', 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains('nsc')) database.createObjectStore('nsc');
    },
  });
}

export async function nscCachePut(reportDate: string | null, rows: NscRow[]) {
  const handle = await db();
  await handle.put('nsc', { reportDate, fetchedAt: Date.now(), rows }, 'snapshot');
}

export async function nscCacheGet(): Promise<Snap | null> {
  try {
    const handle = await db();
    return (await handle.get('nsc', 'snapshot')) || null;
  } catch {
    return null;
  }
}
