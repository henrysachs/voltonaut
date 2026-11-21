const loopback = (hostname: string) => ["127.0.0.1", "localhost", "[::1]"].includes(hostname);

export function stravaAuthorizationUrl(raw: string, apiOrigin: string, webOrigin: string): string {
  const url = new URL(raw);
  const web = new URL(webOrigin);
  const real = url.origin === "https://www.strava.com";
  const local = loopback(web.hostname) && loopback(url.hostname) && url.protocol === "http:";

  const allowed = [
    "client_id",
    "redirect_uri",
    "response_type",
    "approval_prompt",
    "scope",
    "state",
  ];

  if (
    (!real && !local) ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    url.pathname !== "/oauth/authorize" ||
    [...url.searchParams.keys()].some((key) => !allowed.includes(key)) ||
    allowed.some((key) => url.searchParams.getAll(key).length !== 1) ||
    url.searchParams.get("redirect_uri") !== `${apiOrigin}/v1/strava/callback` ||
    url.searchParams.get("response_type") !== "code" ||
    url.searchParams.get("scope") !== "activity:write" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(url.searchParams.get("state") ?? "")
  )
    throw new Error("invalid authorization route");

  return url.href;
}
