/* oxlint-disable eslint/max-dependencies -- This composition root wires the existing account panels plus the independent progress sync and outbox. */
import { ApplicationSession } from "./sync/applicationSession.js";
import { apiOrigin, CANONICAL_AUTH_ORIGIN, isPreviewOrigin } from "./sync/authOrigin.js";
import { handoffErrorText, takeAuthHandoff } from "./sync/authHandoff.js";
import { authTransport } from "./sync/authTransport.js";
import { sessionPersistence } from "./sync/sessionPersistence.js";
import { mountAccountPanels, resumeIdentityLink } from "./browserAccountPanels.js";
import { privateAuthTransport } from "./sync/privateAuthTransport.js";
import type { ProfileBootstrap } from "./profileBootstrap.js";
import { lazyResource, setupBrowserAccountData } from "./browserAccountData.js";
import { setupBrowserStrava } from "./browserStrava.js";
import { ProgressSync } from "./sync/progressSync.js";
import { openProgressOutboxDatabase } from "./sync/progressOutboxDatabase.js";
import type { ProgressOutbox } from "./sync/progressOutbox.js";
import { mountProgressPanel } from "./ui/progressPanel.js";
import { sessionAccountScope, type AccountScope } from "./sync/accountScope.js";
import type { AccountLease } from "./sync/privateAuthTransport.js";
import { GarageLoadout } from "./sync/garageLoadout.js";
import { GarageShop } from "./sync/garageShop.js";
import { AccountAdministration } from "./sync/accountAdministration.js";
import { mountAccountMembershipPanel } from "./ui/accountMembershipPanel.js";
import type { AuthTransport } from "./sync/authTransport.js";

declare global {
  interface ImportMeta {
    readonly env: { readonly VITE_API_ORIGIN?: string; readonly PROD?: boolean };
  }
}

export interface BrowserAccount {
  readonly session: Readonly<
    Pick<ApplicationSession, "authorize" | "subscribe" | "endAfterAccountDeletion">
  >;
  readonly accounts: Readonly<
    Promise<Readonly<Awaited<ReturnType<typeof setupBrowserAccountData>>>>
  >;
  readonly progress: ProgressSync;
  readonly shop: GarageShop;
  /** Server-confirmed equipment for garage and ride (spec E7-05). */
  readonly loadout: GarageLoadout;
}

function setupProgress(
  scope: AccountScope<AccountLease>,
  outbox: () => Promise<ProgressOutbox>,
): ProgressSync {
  const progress = new ProgressSync({ scope, outbox });
  mountProgressPanel(progress);
  window.addEventListener("online", () => {
    void progress.retry("resume");
  });
  window.addEventListener("pagehide", () => {
    void progress.retry("resume");
  });

  return progress;
}

/** Every account feature follows one scope instead of the session itself. */
function setupAccountFeatures(
  session: Readonly<ApplicationSession>,
  transport: AuthTransport,
  profile: () => Promise<ProfileBootstrap>,
) {
  const scope = sessionAccountScope(session);
  const links = mountAccountPanels(session, scope, transport);
  const progressOutbox = lazyResource(() => openProgressOutboxDatabase());
  const shop = new GarageShop(scope);
  const loadout = new GarageLoadout(scope);
  const accounts = setupBrowserAccountData({ scope, session }, profile, progressOutbox);
  mountAccountMembershipPanel(new AccountAdministration(scope));
  void setupBrowserStrava(scope, accounts);
  const progress = setupProgress(scope, progressOutbox);
  window.addEventListener("online", () => {
    void shop.retry();
    void loadout.retry();
  });

  return { links, accounts, progress, shop, loadout };
}

export function setupBrowserAccount(
  profile: () => Promise<ProfileBootstrap>,
): BrowserAccount | undefined {
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

    const { links, accounts, progress, shop, loadout } = setupAccountFeatures(
      session,
      transport,
      profile,
    );

    if (handoff.kind === "code") void session.exchange(handoff.code);
    else if (handoff.kind === "link") void resumeIdentityLink(session, links, handoff.code);
    else if (handoff.kind === "none") void session.restore();
    else if (handoff.kind === "error") host?.append(handoffErrorText(handoff.error));
    else host?.append("Ungültige Anmeldung. Übergabe fehlt oder ist mehrfach vorhanden.");

    return { session, accounts, progress, shop, loadout };
  } catch {
    host?.append("Anmeldung nicht konfiguriert. Gastbetrieb bleibt verfügbar.");

    return undefined;
  }
}
