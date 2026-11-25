/* oxlint-disable typescript/prefer-readonly-parameter-types -- Public inputs are readonly contracts; Oxlint does not follow cross-module domain aliases. */
import type { RideProgressCheckpoint, VoltsRideRangeReceipt } from "@voltonaut/shared";

import type { ProgressBatch } from "./progressBatch.js";
import type {
  ProgressAccountOwner,
  ProgressBlockCause,
  ProgressJournalOwner,
  ProgressOutboxRow,
} from "./progressOutboxSchema.js";

export {
  PROGRESS_OUTBOX_MAX_ATTEMPTS,
  PROGRESS_OUTBOX_MAX_ROWS,
  ProgressOutboxRowSchema,
} from "./progressOutboxSchema.js";

export { progressPayloadHash } from "./progressOutboxHash.js";

export {
  newProgressOutboxRow,
  progressOutboxKey,
  progressReceiptCoversRow,
} from "./progressOutboxRow.js";

export type {
  NewProgressOutboxRowInput,
  ProgressAccountOwner,
  ProgressBlockCause,
  ProgressBlockedState,
  ProgressJournalOwner,
  ProgressOutboxRow,
  ProgressOutboxState,
  ProgressQueuedState,
  ProgressSendingState,
  ProgressStoredState,
} from "./progressOutboxSchema.js";

export type { ProgressBatch };

export type ProgressBatchPhase = ProgressOutboxRow["phase"];

export type ProgressPendingPageCursor = Readonly<{
  journalId: string;
  startTick: number;
}>;

export type ProgressWriteFence = Readonly<
  ProgressJournalOwner & {
    consentVersion: number;
    sessionGeneration: number;
    signal: Readonly<AbortSignal>;
    current: () => boolean;
  }
>;

export type ProgressMarkSending = Readonly<{
  row: ProgressOutboxRow;
  fence: ProgressWriteFence;
  nowMs: number;
  manual: boolean;
}>;

export type ProgressMarkBlocked = Readonly<{
  row: ProgressOutboxRow;
  fence: ProgressWriteFence;
  cause: ProgressBlockCause;
  attempts: number;
  nowMs: number;
}>;

export type ProgressMarkStored = Readonly<{
  row: ProgressOutboxRow;
  fence: ProgressWriteFence;
  receipt: VoltsRideRangeReceipt;
}>;

export type ProgressAppendResult =
  | { readonly kind: "ignored"; readonly reason: "sim" | "consent" }
  | { readonly kind: "stored"; readonly rows: readonly ProgressOutboxRow[] };

export type ProgressOutboxCounts = Readonly<
  Record<"rows" | "queued" | "sending" | "blocked" | "stored" | "open" | "remaining", number>
>;

export type ProgressOutboxView =
  | { readonly kind: "ready"; readonly counts: ProgressOutboxCounts }
  | { readonly kind: "blocked"; readonly cause: "capacity"; readonly counts: ProgressOutboxCounts };

export interface ProgressOutbox {
  readonly append: (
    fence: Readonly<ProgressWriteFence>,
    checkpoint: Readonly<RideProgressCheckpoint>,
  ) => Promise<ProgressAppendResult>;
  readonly seal: (fence: Readonly<ProgressWriteFence>) => Promise<ProgressOutboxRow | undefined>;
  readonly prepareDelivery: (fence: Readonly<ProgressWriteFence>) => Promise<void>;
  readonly listPending: (
    owner: Readonly<ProgressAccountOwner>,
  ) => Promise<readonly ProgressOutboxRow[]>;
  readonly listPendingPage: (
    owner: Readonly<ProgressAccountOwner>,
    limit: number,
    after?: ProgressPendingPageCursor,
  ) => Promise<readonly ProgressOutboxRow[]>;
  readonly listJournalPending: (
    owner: Readonly<ProgressAccountOwner>,
    journalId: ProgressJournalOwner["journalId"],
  ) => Promise<readonly ProgressOutboxRow[]>;
  readonly nextRetryAt: (
    owner: Readonly<ProgressAccountOwner>,
    afterMs: number,
  ) => Promise<number | undefined>;
  /** Removes every row of one API origin and account after a confirmed server account deletion. */
  readonly purgeOwner: (owner: Readonly<ProgressAccountOwner>) => Promise<void>;
  readonly markSending: (input: Readonly<ProgressMarkSending>) => Promise<ProgressOutboxRow>;
  readonly markStored: (input: Readonly<ProgressMarkStored>) => Promise<ProgressOutboxRow>;
  readonly markBlocked: (input: Readonly<ProgressMarkBlocked>) => Promise<ProgressOutboxRow>;
  readonly requeue: (
    row: Readonly<ProgressOutboxRow>,
    fence: Readonly<ProgressWriteFence>,
    nowMs: number,
  ) => Promise<ProgressOutboxRow>;
  readonly state: (owner: Readonly<ProgressAccountOwner>) => Promise<ProgressOutboxView>;
  readonly view: (owner: Readonly<ProgressAccountOwner>) => Promise<ProgressOutboxView>;
}

export type ProgressOutboxFailure =
  | "capacity"
  | "owner"
  | "conflict"
  | "consent"
  | "session"
  | "corrupt"
  | "missing"
  | "contract"
  | "storage";

export class ProgressOutboxError extends Error {
  constructor(
    override readonly cause: ProgressOutboxFailure,
    message: string,
  ) {
    super(message);
  }
}
