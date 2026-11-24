import { describe, expect, it } from "vitest";

import { createShellWorker } from "./shellWorker.js";
import type { CacheLike, CacheStorageLike } from "./shellWorker.js";

// oxlint-disable typescript/prefer-readonly-parameter-types -- Request, Response and the in-memory cache are mutable Fetch API fakes.
const ORIGIN = "https://app.example";
const SHELL_CACHE = "voltonaut-shell-v2";

interface MemoryCache extends CacheLike {
  readonly entries: Map<string, Response>;
}

function pathOf(request: Request | string): string {
  return new URL(request instanceof Request ? request.url : request, ORIGIN).pathname;
}

function createMemoryCache(): MemoryCache {
  const entries = new Map<string, Response>();

  return {
    entries,
    addAll: async (requests) => {
      await Promise.resolve();

      for (const request of requests) entries.set(pathOf(request), new Response(request.url));
    },
    match: async (request) => {
      await Promise.resolve();

      return entries.get(pathOf(request))?.clone();
    },
    put: async (request, response) => {
      await Promise.resolve();
      entries.set(pathOf(request), response);
    },
  };
}

function createMemoryStorage() {
  const caches = new Map<string, MemoryCache>();

  const storage: CacheStorageLike = {
    open: async (name) => {
      await Promise.resolve();
      const cache = caches.get(name) ?? createMemoryCache();
      caches.set(name, cache);

      return cache;
    },
    keys: async () => {
      await Promise.resolve();

      return [...caches.keys()];
    },
    delete: async (name) => {
      await Promise.resolve();

      return caches.delete(name);
    },
  };

  return { caches, storage };
}

function setup(online: boolean) {
  const { caches, storage } = createMemoryStorage();
  const fetched: string[] = [];

  const network = async (request: Request): Promise<Response> => {
    await Promise.resolve();
    fetched.push(request.url);

    if (!online) throw new TypeError("offline");

    // Node cannot create "basic" responses; the Fetch API returns them for same-origin requests.
    return Object.defineProperty(new Response(`network:${request.url}`), "type", {
      value: "basic",
    });
  };

  const worker = createShellWorker(storage, network, ORIGIN, "v2", ["/", "/assets/app.js"]);

  return { caches, fetched, worker };
}

function navigation(url: string): Request {
  return Object.defineProperty(new Request(url), "mode", { value: "navigate" });
}

function cachedPaths(caches: ReadonlyMap<string, MemoryCache>): readonly string[] {
  return [...(caches.get(SHELL_CACHE)?.entries.keys() ?? [])].toSorted();
}

async function text(response: Promise<Response> | null): Promise<string> {
  return (await response)?.text() ?? "";
}

describe("shell worker lifecycle", () => {
  it("precaches the shell and drops caches of older versions on activate", async () => {
    const { caches, worker } = setup(true);
    caches.set("voltonaut-shell-v1", createMemoryCache());
    caches.set("unrelated-cache", createMemoryCache());

    await worker.install();
    await worker.activate();

    expect([...caches.keys()].toSorted()).toEqual(["unrelated-cache", SHELL_CACHE]);
  });
});

describe("shell worker offline", () => {
  it("answers navigations with the cached shell without the network", async () => {
    const { worker, fetched } = setup(false);
    await worker.install();

    expect(await text(worker.respond(navigation(`${ORIGIN}/?sim=1`)))).toBe(`${ORIGIN}/`);
    expect(await text(worker.respond(new Request(`${ORIGIN}/assets/app.js`)))).toBe(
      `${ORIGIN}/assets/app.js`,
    );
    expect(fetched).toEqual([]);
  });

  it("fails offline for files that were never cached", async () => {
    const { worker } = setup(false);
    await worker.install();

    await expect(worker.respond(new Request(`${ORIGIN}/assets/model.glb`))).rejects.toThrow(
      "offline",
    );
  });
});

describe("shell worker caching", () => {
  it("stores later same-origin assets in the versioned cache", async () => {
    const { caches, worker } = setup(true);
    await worker.install();

    expect(await text(worker.respond(new Request(`${ORIGIN}/assets/model.glb`)))).toContain(
      "network:",
    );
    expect(caches.get(SHELL_CACHE)?.entries.has("/assets/model.glb")).toBe(true);
  });

  it("never answers or caches API, cross-origin or non-GET traffic", async () => {
    const { caches, worker } = setup(true);
    await worker.install();

    const untouched = [
      new Request("https://api.example/v1/rides"),
      new Request(`${ORIGIN}/v1/auth/session`),
      new Request(`${ORIGIN}/assets/x.js?token=abc`),
      new Request(`${ORIGIN}/assets/x.js`, { method: "POST" }),
    ].map((request) => worker.respond(request));

    expect(untouched).toEqual([null, null, null, null]);
    expect(cachedPaths(caches)).toEqual(["/", "/assets/app.js"]);
  });
});
