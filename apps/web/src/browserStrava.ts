import type { AccountScope } from "./sync/accountScope.js";
import type { StravaLease } from "./sync/stravaBridge.js";
import type { AccountSync } from "./sync/accountSync.js";
import { StravaSync } from "./sync/stravaSync.js";
import { browserStravaPopup } from "./sync/stravaBridge.js";
import { mountStravaPanel } from "./ui/stravaPanel.js";

export async function setupBrowserStrava(
  scope: AccountScope<StravaLease>,
  accounts: Readonly<Promise<Readonly<AccountSync>>>,
): Promise<void> {
  const sync = new StravaSync(scope, browserStravaPopup());
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
