import { registerSW } from 'virtual:pwa-register';

let registration: ServiceWorkerRegistration | undefined;

export function checkForAppUpdate() {
  void registration?.update();
}

/**
 * A tab that stays open across a deploy still runs the old JS, which then
 * requests deleted hashed files. Ask the SW to update whenever the user
 * comes back to the tab; autoUpdate reloads once the new worker takes over.
 */
export function registerPwa() {
  registerSW({
    immediate: true,
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
    },
  });
}
