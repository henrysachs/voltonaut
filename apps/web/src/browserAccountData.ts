import type { ProfileBootstrap } from "./profileBootstrap.js";
import type { ApplicationSession } from "./sync/applicationSession.js";
import { AccountSync } from "./sync/accountSync.js";
import { openAccountOutbox } from "./sync/accountOutboxDatabase.js";
import { openRideDatabase } from "./sync/rideDatabase.js";
import { accountDeletionIntents } from "./sync/accountDeletion.js";
import { mountAccountDataPanel } from "./ui/accountDataPanel.js";
import type { ProgressOutbox } from "./sync/progressOutbox.js";
import type { AccountScope } from "./sync/accountScope.js";
import type { AccountLease } from "./sync/privateAuthTransport.js";

export function lazyResource<T>(open: () => Promise<T>): () => Promise<T> {
  let resource: Promise<T> | undefined;

  return () => {
    resource ??= Promise.resolve()
      .then(open)
      .catch((error: Readonly<Error>) => {
        resource = undefined;
        throw error;
      });

    return resource;
  };
}

interface AccountDataRoot {
  readonly scope: AccountScope<AccountLease>;
  readonly session: Readonly<Pick<ApplicationSession, "endAfterAccountDeletion">>;
}

export async function setupBrowserAccountData(
  root: AccountDataRoot,
  profile: () => Promise<ProfileBootstrap>,
  progressOutbox: () => Promise<Pick<ProgressOutbox, "purgeOwner">>,
): Promise<AccountSync> {
  const localProfile = await profile();
  const outbox = lazyResource(openAccountOutbox);
  const archive = lazyResource(() => openRideDatabase(indexedDB));

  const sync = new AccountSync({
    scope: root.scope,
    session: root.session,
    profile: localProfile,
    outbox,
    progressOutbox,
    archive: async () => (await archive()).list(),
    deletions: accountDeletionIntents(() => window.localStorage),
    nowMs: Date.now,
  });

  mountAccountDataPanel(sync);
  window.addEventListener("online", () => {
    void sync.retry("resume");
  });

  return sync;
}
