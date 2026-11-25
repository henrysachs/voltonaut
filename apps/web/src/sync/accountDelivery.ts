import {
  OutboxRowSchema,
  type AccountOutbox,
  type OutboxRow,
  retryState,
} from "./accountOutbox.js";
import type { ProfilePort, RidePort } from "./accountPorts.js";
import { PrivateRequestError, type LeaseBinding } from "./apiRoute.js";

/** Delivering an outbox row writes either the profile or one ride, nothing else. */
export type DeliveryLease = LeaseBinding & {
  readonly profile: Pick<ProfilePort, "save">;
  readonly rides: Pick<RidePort, "upload">;
};

type AccountReceipt = Awaited<ReturnType<ProfilePort["save"] | RidePort["upload"]>>;

type DeliveryResult = "continue" | "reauth";

async function persistFailure(database: AccountOutbox, row: OutboxRow): Promise<DeliveryResult> {
  const reauth = row.state.kind === "blocked" && row.state.cause === "reauth";

  try {
    await database.update(row);
  } catch {
    if (!reauth) throw new Error("Warteschlangenstatus nicht dauerhaft bestätigt.");
  }

  return reauth ? "reauth" : "continue";
}

function confirmStoredRow(row: OutboxRow, receipt: AccountReceipt, attempts: number): OutboxRow {
  const profileMatches =
    "profile" in receipt && JSON.stringify(receipt.profile) === JSON.stringify(row.payload);

  if (row.kind === "profile" && !profileMatches) throw new PrivateRequestError("contract");

  const parsed = OutboxRowSchema.safeParse({
    ...row,
    state: { kind: "stored", attempts, retryAtMs: 0, receipt },
  });

  if (!parsed.success) throw new PrivateRequestError("contract");

  return parsed.data;
}

export async function deliverAccountRow(
  lease: DeliveryLease,
  database: AccountOutbox,
  row: OutboxRow,
  nowMs: () => number,
  mode: "manual" | "resume" = "resume",
): Promise<DeliveryResult> {
  if (!lease.current() || row.apiOrigin !== lease.apiOrigin || row.userId !== lease.userId)
    return "continue";

  const reauthenticated = row.state.kind === "blocked" && row.state.cause === "reauth";

  if (row.state.kind === "stored" || (row.state.retryAtMs > nowMs() && !reauthenticated))
    return "continue";

  const restart = mode === "manual" && row.state.kind === "blocked" && row.state.cause === "retry";

  if (row.state.kind === "blocked" && row.state.cause !== "reauth" && !restart) return "continue";
  const attempts = restart ? 1 : Math.min(5, row.state.attempts + 1);

  const sending = {
    ...row,
    state: { kind: "sending", attempts, retryAtMs: 0 },
  } satisfies OutboxRow;

  await database.update(sending);

  if (!lease.current()) return "continue";

  try {
    const receipt =
      row.kind === "ride"
        ? await lease.rides.upload(row.payload)
        : await lease.profile.save(row.payload);

    const stored = confirmStoredRow(row, receipt, attempts);

    if (lease.current()) await database.update(stored);

    return "continue";
  } catch (error) {
    if (!lease.current()) return "continue";
    const cause = error instanceof PrivateRequestError ? error.cause : "retry";

    if (cause === "superseded") return "continue";

    return persistFailure(database, { ...row, state: retryState(attempts, cause, nowMs()) });
  }
}
