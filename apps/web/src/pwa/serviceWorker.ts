import { createShellWorker } from "./shellWorker.js";
import type { CacheStorageLike } from "./shellWorker.js";

// The build plugin in vite.config.ts replaces both placeholders with the release version
// and the comma-separated list of precached files. Without the plugin (dev, tests) the
// worker only knows the placeholders and is never registered.
const BUILD_VERSION = "__VOLTONAUT_VERSION__";
const BUILD_PRECACHE = "__VOLTONAUT_PRECACHE__";
const SKIP_WAITING = "voltonaut:skip-waiting";

// oxlint-disable typescript/prefer-readonly-parameter-types -- Service worker events are browser-owned mutable objects.
interface WorkerEvent {
  readonly waitUntil: (work: Promise<unknown>) => void;
}

interface FetchWorkerEvent {
  readonly request: Request;
  readonly respondWith: (response: Promise<Response>) => void;
}

interface MessageWorkerEvent {
  readonly data: string | undefined;
}

interface WorkerScope {
  readonly addEventListener: {
    (type: "install" | "activate", listener: (event: WorkerEvent) => void): void;
    (type: "fetch", listener: (event: FetchWorkerEvent) => void): void;
    (type: "message", listener: (event: MessageWorkerEvent) => void): void;
  };
  readonly skipWaiting: () => Promise<void>;
  readonly location: { readonly origin: string };
  readonly caches: CacheStorageLike;
}

// The DOM lib has no worker scope; this module only ever runs as a service worker.
declare const self: WorkerScope;

const worker = createShellWorker(
  self.caches,
  (request) => fetch(request),
  self.location.origin,
  BUILD_VERSION,
  BUILD_PRECACHE.split(","),
);

// No automatic skipWaiting: an update waits until the page asks for it, because a reload
// discards the running recording.
self.addEventListener("install", (event) => {
  event.waitUntil(worker.install());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(worker.activate());
});

self.addEventListener("fetch", (event) => {
  const response = worker.respond(event.request);

  if (response !== null) event.respondWith(response);
});

self.addEventListener("message", (event) => {
  if (event.data === SKIP_WAITING) void self.skipWaiting();
});
