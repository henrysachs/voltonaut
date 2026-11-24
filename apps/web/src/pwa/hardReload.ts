// Must equal SHELL_CACHE_PREFIX; the worker bundle cannot share modules with the app.
export const OWN_CACHE_PREFIX = "voltonaut-shell-";

export interface ShellRegistration {
  readonly scope: string;
  readonly scriptUrl: string | null;
  readonly unregister: () => Promise<boolean>;
}

export interface HardReloadPorts {
  readonly origin: string;
  readonly registrations: () => Promise<readonly ShellRegistration[]>;
  readonly cacheNames: () => Promise<readonly string[]>;
  readonly deleteCache: (name: string) => Promise<boolean>;
  readonly refetchShell: () => Promise<void>;
  readonly reload: () => void;
}

// Resets only Voltonaut's own worker and app-shell caches. localStorage, IndexedDB
// (recordings, account data) and caches of other apps stay untouched.
export async function hardReload(ports: HardReloadPorts): Promise<void> {
  const registrations = await ports.registrations();

  // Other applications under the same origin keep their workers and offline mode.
  const own = registrations.filter(
    (registration) =>
      registration.scope === `${ports.origin}/` &&
      registration.scriptUrl === `${ports.origin}/sw.js`,
  );

  await Promise.all(own.map((registration) => registration.unregister()));

  const names = await ports.cacheNames();

  await Promise.all(
    names
      .filter((name) => name.startsWith(OWN_CACHE_PREFIX))
      .map((name) => ports.deleteCache(name)),
  );

  // Refresh the HTTP-cached document so the reload cannot reuse a stale shell.
  await ports.refetchShell();
  ports.reload();
}

export function browserPorts(): HardReloadPorts {
  return {
    origin: window.location.origin,
    registrations: async () => {
      const found = await navigator.serviceWorker.getRegistrations();

      // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- ServiceWorkerRegistration is a browser-owned handle; only its read members and unregister() are used.
      return found.map((registration) => ({
        scope: registration.scope,
        scriptUrl:
          (registration.active ?? registration.waiting ?? registration.installing)?.scriptURL ??
          null,
        unregister: () => registration.unregister(),
      }));
    },
    cacheNames: () => caches.keys(),
    deleteCache: (name) => caches.delete(name),
    refetchShell: async () => {
      await fetch(window.location.href, { cache: "reload" });
    },
    reload: () => {
      window.location.reload();
    },
  };
}
