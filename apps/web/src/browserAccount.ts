import { ApplicationSession } from "./sync/applicationSession.js";
import { apiOrigin, CANONICAL_AUTH_ORIGIN, isPreviewOrigin } from "./sync/authOrigin.js";
import { takeAuthHandoff } from "./sync/authHandoff.js";
import { authTransport } from "./sync/authTransport.js";
import { sessionPersistence } from "./sync/sessionPersistence.js";
import { mountAccountPanel } from "./ui/accountPanel.js";

declare global {
  interface ImportMeta {
    readonly env: { readonly VITE_API_ORIGIN?: string };
  }
}

export function setupBrowserAccount(): void {
  const handoff = takeAuthHandoff(window.location.href, (path) => {
    window.history.replaceState(null, "", path);
  });

  const host = document.querySelector("#account-panel");

  if (isPreviewOrigin(window.location.origin)) {
    const link = document.createElement("a");
    link.href = CANONICAL_AUTH_ORIGIN;
    link.textContent = "Zum Anmelden die kanonische Voltonaut-Seite öffnen";
    host?.append(link);

    return;
  }

  try {
    const origin = apiOrigin(window.location.origin, import.meta.env["VITE_API_ORIGIN"]);

    const session = new ApplicationSession({
      transport: authTransport(origin),
      persistence: sessionPersistence(origin, () => window.localStorage),
      navigate: () => {
        window.location.assign(`${origin}/v1/auth/oidc/start`);
      },
    });

    mountAccountPanel(session);

    if (handoff.kind === "code") void session.exchange(handoff.code);
    else if (handoff.kind === "none") void session.restore();
    else host?.append("Ungültige Anmeldung. Übergabe fehlt oder ist mehrfach vorhanden.");
  } catch {
    host?.append("Anmeldung nicht konfiguriert. Gastbetrieb bleibt verfügbar.");
  }
}
