import { openDB, type DBSchema } from 'idb';

export type NscFollowup = {
  id: string;
  text: string;
  at: string;
};

interface FollowupDB extends DBSchema {
  notes: {
    key: string;
    value: { application_no: string; username: string; items: NscFollowup[]; updated_at: string };
  };
}

let boundUser = '';

function noteKey(applicationNo: string, username = boundUser) {
  return `${String(username || '').trim().toLowerCase()}|${String(applicationNo || '').trim()}`;
}

async function db() {
  return openDB<FollowupDB>('dro-ops-nsc-followups', 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains('notes')) database.createObjectStore('notes');
    },
  });
}

/** Bind notes to the signed-in user so another login cannot see them. */
export function nscFollowupsBindUser(username: string | null | undefined) {
  boundUser = String(username || '').trim().toLowerCase();
}

export async function nscFollowupsList(applicationNo: string): Promise<NscFollowup[]> {
  const app = String(applicationNo || '').trim();
  if (!app || !boundUser) return [];
  try {
    const handle = await db();
    const row = await handle.get('notes', noteKey(app));
    return Array.isArray(row?.items) ? row!.items : [];
  } catch {
    return [];
  }
}

export type NscFollowupMeta = { count: number; latest: string; preview: string };

/** Index of all local follow-up cases for the signed-in user. */
export async function nscFollowupsIndex(): Promise<Map<string, NscFollowupMeta>> {
  const out = new Map<string, NscFollowupMeta>();
  if (!boundUser) return out;
  try {
    const handle = await db();
    const rows = await handle.getAll('notes');
    const prefix = `${boundUser}|`;
    for (const row of rows) {
      if (!row || String(row.username || '').toLowerCase() !== boundUser) continue;
      const app = String(row.application_no || '').trim();
      if (!app) continue;
      const items = Array.isArray(row.items) ? row.items : [];
      if (!items.length) continue;
      const latest = items[0]?.at || row.updated_at || '';
      out.set(app, {
        count: items.length,
        latest,
        preview: String(items[0]?.text || '').trim().slice(0, 120),
      });
    }
    // also catch orphaned keys that still use the username|app form
    if (!out.size) {
      const keys = await handle.getAllKeys('notes');
      for (const key of keys) {
        if (!String(key).startsWith(prefix)) continue;
        const app = String(key).slice(prefix.length);
        const row = await handle.get('notes', key);
        const items = Array.isArray(row?.items) ? row!.items : [];
        if (!app || !items.length) continue;
        out.set(app, {
          count: items.length,
          latest: items[0]?.at || row?.updated_at || '',
          preview: String(items[0]?.text || '').trim().slice(0, 120),
        });
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}

export async function nscFollowupsAdd(applicationNo: string, text: string): Promise<NscFollowup[]> {
  const app = String(applicationNo || '').trim();
  const body = String(text || '').trim();
  if (!app || !boundUser || !body) return nscFollowupsList(app);
  const item: NscFollowup = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text: body.slice(0, 2000),
    at: new Date().toISOString(),
  };
  const prev = await nscFollowupsList(app);
  const items = [item, ...prev];
  try {
    const handle = await db();
    await handle.put(
      'notes',
      { application_no: app, username: boundUser, items, updated_at: item.at },
      noteKey(app)
    );
  } catch {
    /* ignore */
  }
  return items;
}

export async function nscFollowupsRemove(applicationNo: string, id: string): Promise<NscFollowup[]> {
  const app = String(applicationNo || '').trim();
  if (!app || !boundUser) return [];
  const prev = await nscFollowupsList(app);
  const items = prev.filter((n) => n.id !== id);
  try {
    const handle = await db();
    if (!items.length) await handle.delete('notes', noteKey(app));
    else {
      await handle.put(
        'notes',
        { application_no: app, username: boundUser, items, updated_at: new Date().toISOString() },
        noteKey(app)
      );
    }
  } catch {
    /* ignore */
  }
  return items;
}

/** Drop notes for applications that are no longer in pending/withheld on this device. */
export async function nscFollowupsPrune(aliveApps: Iterable<string>) {
  if (!boundUser) return;
  const keep = new Set([...aliveApps].map((a) => String(a || '').trim()).filter(Boolean));
  try {
    const handle = await db();
    const keys = await handle.getAllKeys('notes');
    const prefix = `${boundUser}|`;
    for (const key of keys) {
      if (!String(key).startsWith(prefix)) continue;
      const app = String(key).slice(prefix.length);
      if (!keep.has(app)) await handle.delete('notes', key);
    }
  } catch {
    /* ignore */
  }
}

export function nscFollowupsClearUser() {
  boundUser = '';
}
