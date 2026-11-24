import { classifyRequest, SHELL_CACHE_PREFIX, shellCacheName } from "./cachePolicy.js";

// oxlint-disable typescript/prefer-readonly-parameter-types -- Fetch API objects (Request, Response, Cache) are browser-owned mutable handles.
export interface CacheLike {
  readonly addAll: (requests: readonly Request[]) => Promise<void>;
  readonly match: (
    request: Request | string,
    options?: { readonly ignoreSearch: boolean },
  ) => Promise<Response | undefined>;
  readonly put: (request: Request, response: Response) => Promise<void>;
}

export interface CacheStorageLike {
  readonly open: (name: string) => Promise<CacheLike>;
  readonly keys: () => Promise<readonly string[]>;
  readonly delete: (name: string) => Promise<boolean>;
}

export type Network = (request: Request) => Promise<Response>;

export interface ShellWorker {
  readonly install: () => Promise<void>;
  readonly activate: () => Promise<void>;
  /** Null means: not ours, let the browser use the network untouched. */
  readonly respond: (request: Request) => Promise<Response> | null;
}

const OFFLINE_STATUS = 503;

function offlineResponse(): Response {
  return new Response("Voltonaut ist offline und diese Seite ist nicht zwischengespeichert.", {
    status: OFFLINE_STATUS,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

async function respondStatic(
  cache: CacheLike,
  network: Network,
  request: Request,
): Promise<Response> {
  const hit = await cache.match(request);

  if (hit !== undefined) return hit;

  const response = await network(request);

  if (response.ok && response.type === "basic") await cache.put(request, response.clone());

  return response;
}

async function respondNavigation(
  cache: CacheLike,
  network: Network,
  request: Request,
): Promise<Response> {
  const shell = await cache.match("/", { ignoreSearch: true });

  if (shell !== undefined) return shell;

  try {
    return await network(request);
  } catch {
    return offlineResponse();
  }
}

export function createShellWorker(
  storage: CacheStorageLike,
  network: Network,
  origin: string,
  version: string,
  precache: readonly string[],
): ShellWorker {
  const cacheName = shellCacheName(version);

  return {
    install: async () => {
      const cache = await storage.open(cacheName);

      await cache.addAll(
        precache.map((path) => new Request(new URL(path, origin), { cache: "reload" })),
      );
    },
    activate: async () => {
      const names = await storage.keys();

      await Promise.all(
        names
          .filter((name) => name.startsWith(SHELL_CACHE_PREFIX) && name !== cacheName)
          .map((name) => storage.delete(name)),
      );
    },
    respond: (request) => {
      const kind = classifyRequest(request.method, request.url, origin, request.mode);

      if (kind === "network") return null;

      const open = storage.open(cacheName);

      return open.then((cache) =>
        kind === "navigation"
          ? respondNavigation(cache, network, request)
          : respondStatic(cache, network, request),
      );
    },
  };
}
