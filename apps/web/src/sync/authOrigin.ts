export const CANONICAL_AUTH_ORIGIN = "https://voltonaut.stammkneipe.dev";

export function parseApiOrigin(value: string): string {
  const url = new URL(value);
  const allowedProtocol = ["http:", "https:"].includes(url.protocol);

  if (
    !allowedProtocol ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    (value !== url.origin && value !== `${url.origin}/`)
  ) {
    throw new Error("API-Origin ungültig. Gastbetrieb bleibt verfügbar.");
  }

  return url.origin;
}

export function apiOrigin(webOrigin: string, configured?: string): string {
  if (configured !== undefined) return parseApiOrigin(configured);
  const web = new URL(webOrigin);

  if (["localhost", "127.0.0.1", "[::1]"].includes(web.hostname)) {
    web.port = "3000";

    return web.origin;
  }

  return "https://api.voltonaut.stammkneipe.dev";
}

export function isPreviewOrigin(origin: string): boolean {
  return new URL(origin).hostname.endsWith(".pages.dev");
}
