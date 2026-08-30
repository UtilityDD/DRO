/** One reload per tab after a deploy left this session pointing at deleted Vite chunks. */
const FLAG = 'dro.chunk-reload';
let reloading = false;

export function isChunkLoadError(err: unknown): boolean {
  const name = err instanceof Error ? err.name : '';
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return (
    name === 'ChunkLoadError' ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /Loading chunk [\w.-]+ failed/i.test(msg)
  );
}

function alreadyReloaded(): boolean {
  try {
    return sessionStorage.getItem(FLAG) === '1';
  } catch {
    return false;
  }
}

function markReloading() {
  try {
    sessionStorage.setItem(FLAG, '1');
  } catch {
    /* private mode */
  }
}

function reloadNow() {
  if (reloading) return;
  reloading = true;
  window.location.reload();
}

/** Ask the installed service worker to pick up a new deploy, then reload. */
async function updateWorkersThenReload() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.race([
        Promise.all(regs.map((r) => r.update().catch(() => undefined))),
        new Promise((resolve) => window.setTimeout(resolve, 1200)),
      ]);
    }
  } catch {
    /* ignore — still reload so index.html can point at the new hashes */
  }
  reloadNow();
}

/** Reload once. Returns true if a reload was triggered. */
export function reloadOnceForStaleChunk(): boolean {
  if (reloading || alreadyReloaded()) return false;
  markReloading();
  void updateWorkersThenReload();
  return true;
}

export function recoverIfChunkError(err: unknown): boolean {
  if (!isChunkLoadError(err)) return false;
  return reloadOnceForStaleChunk();
}

export function clearChunkReloadFlag() {
  try {
    sessionStorage.removeItem(FLAG);
  } catch {
    /* ignore */
  }
}
