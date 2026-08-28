const KEY = 'dro.atc.targetHistory.v1';
const MAX = 80;

export type SavedAtcTarget = {
  id: string;
  savedAt: string;
  asOf: string;
  horizon: string;
  format: 'IA' | 'IB';
  scope: 'region' | 'division';
  parentCode: string;
  parentName: string;
  targetAtc: number;
  predictedAtc: number;
  currentAtc: number;
};

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function loadTargetHistory(): SavedAtcTarget[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x) => x && typeof x.id === 'string' && typeof x.savedAt === 'string' && Number.isFinite(Number(x.targetAtc))
    ) as SavedAtcTarget[];
  } catch {
    return [];
  }
}

export function appendTargetHistory(entry: Omit<SavedAtcTarget, 'id' | 'savedAt'>): SavedAtcTarget[] {
  const next: SavedAtcTarget = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: new Date().toISOString(),
  };
  const list = [next, ...loadTargetHistory()].slice(0, MAX);
  if (canUseStorage()) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(list));
    } catch {
      /* quota */
    }
  }
  return list;
}

export function removeTargetHistory(id: string): SavedAtcTarget[] {
  const list = loadTargetHistory().filter((x) => x.id !== id);
  if (canUseStorage()) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(list));
    } catch {
      /* quota */
    }
  }
  return list;
}

export function formatSavedAt(iso: string) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
