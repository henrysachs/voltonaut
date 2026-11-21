import type { ApplicationSession } from "./sync/applicationSession.js";
import type { AccountSync } from "./sync/accountSync.js";
import { StravaSync } from "./sync/stravaSync.js";
import { browserStravaPopup } from "./sync/stravaBridge.js";
import { mountStravaPanel } from "./ui/stravaPanel.js";

export async function setupBrowserStrava(
  session: Readonly<Pick<ApplicationSession, "authorize" | "subscribe">>,
  accounts: Readonly<Promise<Readonly<AccountSync>>>,
): Promise<void> {
  if (document.querySelector("#strava-panel") === null) {
    const host = document.createElement("section");
    host.id = "strava-panel";
    document.querySelector("#account-panel")?.after(host);
  }

  const sync = new StravaSync(session, browserStravaPopup());
  const mirror = await accounts;
  const unmount = mountStravaPanel(sync, mirror);
  window.addEventListener(
    "pagehide",
    () => {
      unmount();
      sync.dispose();
    },
    { once: true },
  );
}
