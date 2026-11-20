import type { ProfileBootstrap } from "./profileBootstrap.js";
import type { ApplicationSession } from "./sync/applicationSession.js";
import { AccountSync } from "./sync/accountSync.js";
import { openAccountOutbox } from "./sync/accountOutboxDatabase.js";
import { openRideDatabase } from "./sync/rideDatabase.js";
import { mountAccountDataPanel } from "./ui/accountDataPanel.js";

function lazyResource<T>(open: () => Promise<T>): () => Promise<T> {
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

export async function setupBrowserAccountData(
  session: Readonly<Pick<ApplicationSession, "authorize" | "subscribe">>,
  profile: () => Promise<ProfileBootstrap>,
): Promise<void> {
  const localProfile = await profile();
  const outbox = lazyResource(openAccountOutbox);
  const archive = lazyResource(() => openRideDatabase(indexedDB));

  const sync = new AccountSync({
    session,
    profile: localProfile,
    outbox,
    archive: async () => (await archive()).list(),
    nowMs: Date.now,
  });

  mountAccountDataPanel(sync);
  window.addEventListener("online", () => {
    void sync.retry("resume");
  });
}
