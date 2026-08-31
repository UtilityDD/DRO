import { registerSW } from 'virtual:pwa-register';

let registration: ServiceWorkerRegistration | undefined;
let hadController = false;

export function checkForAppUpdate() {
  void registration?.update();
}

/** Force waiting worker to activate, then reload (Power Map route entry). */
export async function activateWaitingWorkerAndReload(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;
  const reg =
    registration ?? (await navigator.serviceWorker.getRegistration().catch(() => undefined));
  const waiting = reg?.waiting;
  if (!waiting) return false;
  await new Promise<void>((resolve) => {
    const onChange = () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onChange);
      resolve();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onChange);
    waiting.postMessage({ type: 'SKIP_WAITING' });
    window.setTimeout(resolve, 2500);
  });
  window.location.reload();
  return true;
}

/**
 * A tab that stays open across a deploy still runs the old JS. Poll for updates
 * and reload when a new service worker is ready (autoUpdate + skipWaiting).
 */
export function registerPwa() {
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    hadController = true;
  }

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      void updateSW(true);
    },
    onRegisteredSW(_url, reg) {
      registration = reg ?? undefined;
      if (!reg) return;
      const check = () => {
        void reg.update();
      };
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
      window.addEventListener('focus', check);
      void reg.update();
    },
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) {
        hadController = true;
        return;
      }
      window.location.reload();
    });
  }
}
