import type { ProfileBootstrap } from "../profileBootstrap.js";
import type { OutboxRead } from "./accountOutbox.js";
import type { OutboxItem } from "./accountDataView.js";
import type { LeaseBinding } from "./apiRoute.js";
import { withProfileSelection } from "./profileSelection.js";

interface ProfileApplication {
  readonly lease: LeaseBinding;
  readonly profile: Parameters<ProfileBootstrap["apply"]>[0];
  readonly currentRows: readonly OutboxItem[];
  readonly read: () => Promise<OutboxRead>;
  readonly apply: ProfileBootstrap["apply"];
}

function pendingProfile(rows: readonly Pick<OutboxItem, "kind" | "state">[]): boolean {
  return rows.some((row) => row.kind === "profile" && row.state.kind !== "stored");
}

export function applyAccountProfile(options: ProfileApplication): Promise<"applied" | "pending"> {
  if (pendingProfile(options.currentRows)) return Promise.resolve("pending");
  const signal = AbortSignal.any([options.lease.signal, AbortSignal.timeout(8000)]);
  const current = (): boolean => options.lease.current() && !signal.aborted;

  return withProfileSelection(async () => {
    const outbox = await options.read();

    if (!current() || outbox.kind === "failed")
      throw new Error("Profilvoraussetzungen nicht bestätigt.");

    if (pendingProfile(outbox.rows)) return "pending";
    await options.apply(options.profile, { signal, current });

    return "applied";
  }, signal);
}
