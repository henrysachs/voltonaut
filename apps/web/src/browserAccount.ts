import { ApplicationSession } from "./sync/applicationSession.js";
import { apiOrigin, CANONICAL_AUTH_ORIGIN, isPreviewOrigin } from "./sync/authOrigin.js";
import { handoffErrorText, takeAuthHandoff } from "./sync/authHandoff.js";
import { authTransport } from "./sync/authTransport.js";
import { sessionPersistence } from "./sync/sessionPersistence.js";
import { mountAccountPanels, resumeIdentityLink } from "./browserAccountPanels.js";
import { privateAuthTransport } from "./sync/privateAuthTransport.js";
import type { ProfileBootstrap } from "./profileBootstrap.js";
import { setupBrowserAccountData } from "./browserAccountData.js";
import { setupBrowserStrava } from "./browserStrava.js";

declare global {
  interface ImportMeta {
    readonly env: { readonly VITE_API_ORIGIN?: string; readonly PROD?: boolean };
  }
}

export function setupBrowserAccount(
  profile: () => Promise<ProfileBootstrap>,
):
  | Readonly<Pick<ApplicationSession, "authorize" | "subscribe" | "endAfterAccountDeletion">>
  | undefined {
  const handoff = takeAuthHandoff(window.location.href, (path) => {
    window.history.replaceState(null, "", path);
  });

  const host = document.querySelector("#account-panel");

  if (isPreviewOrigin(window.location.origin)) {
    const link = document.createElement("a");
    link.href = CANONICAL_AUTH_ORIGIN;
    link.textContent = "Zum Anmelden die kanonische Voltonaut-Seite öffnen";
    host?.append(link);

    return undefined;
  }

  try {
    const origin = apiOrigin(window.location.origin, import.meta.env["VITE_API_ORIGIN"]);
    const transport = authTransport(origin);

    const session = new ApplicationSession({
      transport,
      privateTransport: privateAuthTransport(origin),
      persistence: sessionPersistence(origin, () => window.localStorage),
      navigate: (providerId) => {
        window.location.assign(`${origin}/v1/auth/oidc/${encodeURIComponent(providerId)}/start`);
      },
    });

    const links = mountAccountPanels(session, transport);
    const accounts = setupBrowserAccountData(session, profile);
    void setupBrowserStrava(session, accounts);

    if (handoff.kind === "code") void session.exchange(handoff.code);
    else if (handoff.kind === "link") void resumeIdentityLink(session, links, handoff.code);
    else if (handoff.kind === "none") void session.restore();
    else if (handoff.kind === "error") host?.append(handoffErrorText(handoff.error));
    else host?.append("Ungültige Anmeldung. Übergabe fehlt oder ist mehrfach vorhanden.");

    return session;
  } catch {
    host?.append("Anmeldung nicht konfiguriert. Gastbetrieb bleibt verfügbar.");

    return undefined;
  }
}
