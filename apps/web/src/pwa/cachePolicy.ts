export const SHELL_CACHE_PREFIX = "voltonaut-shell-";
export const SKIP_WAITING_MESSAGE = "voltonaut:skip-waiting";

export type RequestKind = "navigation" | "static" | "network";

const STATIC_PREFIXES: readonly string[] = ["/assets/", "/icons/"];
const STATIC_PATHS = new Set(["/manifest.webmanifest"]);
const SHELL_PATHS = new Set(["/", "/index.html"]);

export function shellCacheName(version: string): string {
  return `${SHELL_CACHE_PREFIX}${version}`;
}

// Allowlist, not blocklist: only same-origin GET requests for the game shell and its
// immutable static files are ever answered from the cache. Everything else (API origin,
// auth callbacks, Strava pages, debug pages, anything with credentials) goes to the
// network untouched, so sessions, tokens, rides, heart rate and checkpoints never
// reach the Cache Storage.
export function classifyRequest(
  method: string,
  url: string,
  origin: string,
  mode: string,
): RequestKind {
  const target = new URL(url);

  if (method !== "GET" || target.origin !== origin) return "network";

  if (mode === "navigate") return SHELL_PATHS.has(target.pathname) ? "navigation" : "network";

  if (target.search !== "") return "network";

  const isStatic =
    STATIC_PATHS.has(target.pathname) ||
    STATIC_PREFIXES.some((prefix) => target.pathname.startsWith(prefix));

  return isStatic ? "static" : "network";
}
