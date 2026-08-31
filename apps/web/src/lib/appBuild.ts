/** Injected at build time (see vite.config.ts → __DRO_BUILD_ID__). */

export function droBuildId(): string {
  return typeof __DRO_BUILD_ID__ !== 'undefined' ? __DRO_BUILD_ID__ : 'dev';
}

const BUILD_KEY = 'dro.app.build';
const RELOAD_KEY = 'dro.app.build-reload';

/** Short label for the desk toolbar (7-char SHA or dev). */
export function droBuildLabel(): string {
  const id = droBuildId();
  return id.length > 10 ? id.slice(0, 7) : id;
}

/**
 * After a deploy, the first navigation with new index.html should adopt the new
 * build id. If localStorage still holds an older id, reload once so lazy chunks
 * (Power Map) cannot keep running stale JS beside fresh shell assets.
 */
export function adoptFreshBuildOnce(): boolean {
  if (!import.meta.env.PROD) return false;
  const current = droBuildId();
  try {
    const stored = localStorage.getItem(BUILD_KEY);
    if (!stored) {
      localStorage.setItem(BUILD_KEY, current);
      return false;
    }
    if (stored === current) return false;
    if (sessionStorage.getItem(RELOAD_KEY) === current) return false;
    localStorage.setItem(BUILD_KEY, current);
    sessionStorage.setItem(RELOAD_KEY, current);
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}
