// Must equal SHELL_CACHE_PREFIX; the worker bundle cannot share modules with the app.
export const OWN_CACHE_PREFIX = "voltonaut-shell-";

export interface Unregisterable {
  readonly unregister: () => Promise<boolean>;
}

export interface HardReloadPorts {
  readonly registrations: () => Promise<readonly Unregisterable[]>;
  readonly cacheNames: () => Promise<readonly string[]>;
  readonly deleteCache: (name: string) => Promise<boolean>;
  readonly refetchShell: () => Promise<void>;
  readonly reload: () => void;
}

// Resets only Voltonaut's own worker and app-shell caches. localStorage, IndexedDB
// (recordings, account data) and caches of other apps stay untouched.
export async function hardReload(ports: HardReloadPorts): Promise<void> {
  const registrations = await ports.registrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));

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
    registrations: () => navigator.serviceWorker.getRegistrations(),
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
