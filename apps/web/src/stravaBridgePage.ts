import { StravaChannelSchema, StravaBridgeMessageSchema } from "@voltonaut/shared";
import { apiOrigin } from "./sync/authOrigin.js";
import { stravaAuthorizationUrl } from "./sync/stravaAuthorizationUrl.js";

const host = document.querySelector("#strava-bridge-status");

const report = (message: string) => {
  if (host !== null) host.textContent = message;
};

try {
  const params = new URLSearchParams(window.location.search);

  const id = StravaChannelSchema.parse(
    params.getAll("channel").length === 1 ? params.get("channel") : undefined,
  );

  window.history.replaceState(null, "", window.location.pathname);
  const channel = new BroadcastChannel(`voltonaut-strava:${id}`);

  const timer = setTimeout(() => {
    channel.close();
    report(
      "Ursprünglicher Tab antwortet nicht. Fenster schließen und dort erneut per Klick starten.",
    );
  }, 10000);

  channel.addEventListener("message", (event: { readonly data: unknown }) => {
    const parsed = StravaBridgeMessageSchema.safeParse(event.data);

    if (!parsed.success || parsed.data.type !== "authorize" || parsed.data.channel !== id) return;

    try {
      const target = stravaAuthorizationUrl(
        parsed.data.authorizationUrl,
        apiOrigin(window.location.origin, import.meta.env["VITE_API_ORIGIN"]),
        window.location.origin,
      );

      clearTimeout(timer);
      channel.close();
      window.location.assign(target);
    } catch {
      clearTimeout(timer);
      channel.close();
      report("Ungültiges Strava-Ziel. Keine Weiterleitung.");
    }
  });
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Native BroadcastChannel is same-origin scoped and has no targetOrigin argument.
  channel.postMessage({ v: 1, type: "ready", channel: id });
} catch {
  report("Kanal fehlt, ist ungültig oder BroadcastChannel gesperrt. Keine Verbindung gestartet.");
}
