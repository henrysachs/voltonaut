/* oxlint-disable typescript/prefer-readonly-parameter-types -- Schema inputs are readonly contracts; Oxlint does not follow Zod and branded aliases. */
import {
  HealthResponseSchema,
  JournalIdSchema,
  MeResponseSchema,
  ProgressSessionGenerationSchema,
  VoltsRideRangeReceiptSchema,
  type JournalId,
  type ProgressCheckpointBatch,
  type VoltsRideRangeReceipt,
} from "@voltonaut/shared";

import {
  LOCAL_PROGRESS_MAX_CHECKPOINTS,
  LOCAL_PROGRESS_MAX_FACTS,
  LocalProgressBatchSchema,
  progressFactCount,
  progressSimulatedTimeS,
} from "./progressBatch.js";
import { progressPayloadHash } from "./progressOutboxHash.js";
import { rowIssue, type ProgressIssueContext } from "./progressOutboxIssue.js";
import { progressSequenceKey, type ProgressSequenceKey } from "./progressOutboxKeys.js";

export type { ProgressSequenceKey } from "./progressOutboxKeys.js";

export const PROGRESS_OUTBOX_MAX_ROWS = 1200;
export const PROGRESS_OUTBOX_MAX_ATTEMPTS = 5;

export type ProgressQueuedState = Readonly<{
  kind: "queued";
  attempts: number;
  retryAtMs: number;
}>;

export type ProgressSendingState = Readonly<{
  kind: "sending";
  attempts: number;
  retryAtMs: number;
}>;

export type ProgressBlockCause =
  | "retry"
  | "reauth"
  | "forbidden"
  | "missing"
  | "conflict"
  | "contract"
  | "capacity"
  | "consent"
  | "session";

export type ProgressBlockedState = Readonly<{
  kind: "blocked";
  cause: ProgressBlockCause;
  attempts: number;
  retryAtMs: number;
}>;

export type ProgressStoredState = Readonly<{
  kind: "stored";
  attempts: number;
  retryAtMs: number;
  receipt: VoltsRideRangeReceipt;
}>;

export type ProgressOutboxState =
  | ProgressQueuedState
  | ProgressSendingState
  | ProgressBlockedState
  | ProgressStoredState;

export type ProgressOutboxRow = Readonly<{
  apiOrigin: string;
  userId: string;
  journalId: JournalId;
  consentVersion: number;
  sessionGeneration: number;
  revision: string;
  payload: ProgressCheckpointBatch;
  hash: string;
  phase: "open" | "sealed";
  state: ProgressOutboxState;
  startTick: number;
  endTick: number;
  startSequence: number;
  endSequence: number;
  sequences: readonly number[];
  sequenceKeys: readonly ProgressSequenceKey[];
  factCount: number;
  timeS: number;
}>;

export type ProgressAccountOwner = Readonly<{
  apiOrigin: string;
  userId: string;
}>;

export type ProgressJournalOwner = Readonly<{
  apiOrigin: string;
  userId: string;
  journalId: JournalId;
}>;

export type NewProgressOutboxRowInput = Readonly<{
  owner: ProgressJournalOwner;
  consentVersion: number;
  sessionGeneration: number;
  batch: ProgressCheckpointBatch;
  phase?: "open" | "sealed";
  state?: ProgressOutboxState;
}>;

export function progressRowMetadata(
  owner: Readonly<ProgressJournalOwner>,
  payload: Readonly<ProgressCheckpointBatch>,
) {
  const first = payload.checkpoints[0];
  const last = payload.checkpoints.at(-1);

  if (first === undefined || last === undefined)
    throw new Error("Progress batch must contain a checkpoint");

  const normalizedOwner = journalOwnerSchema.parse(owner);

  return Object.freeze({
    startTick: first.startTick,
    endTick: last.endTick,
    startSequence: first.sequence,
    endSequence: last.sequence,
    sequences: Object.freeze(payload.checkpoints.map((checkpoint) => checkpoint.sequence)),
    sequenceKeys: Object.freeze(
      payload.checkpoints.map((checkpoint) =>
        progressSequenceKey(normalizedOwner, checkpoint.sequence),
      ),
    ),
    factCount: progressFactCount(payload),
    timeS: progressSimulatedTimeS(payload),
  });
}

const text = HealthResponseSchema.shape.version;
const integer = HealthResponseSchema.shape.uptimeS.int().max(Number.MAX_SAFE_INTEGER);
const envelope = HealthResponseSchema.pick({});

function literal<T extends string>(value: T) {
  return text.refine((input) => input === value).transform(() => value);
}

const attempt = envelope.extend({
  attempts: integer.max(PROGRESS_OUTBOX_MAX_ATTEMPTS),
  retryAtMs: integer,
});

const immediate = integer.refine((value) => value === 0).transform(() => 0);

const queued = attempt.extend({
  attempts: integer.max(PROGRESS_OUTBOX_MAX_ATTEMPTS - 1),
  kind: literal("queued"),
});

const sending = attempt.extend({
  attempts: integer.min(1),
  kind: literal("sending"),
  retryAtMs: immediate,
});

const blockCause = literal("retry")
  .or(literal("reauth"))
  .or(literal("forbidden"))
  .or(literal("missing"))
  .or(literal("conflict"))
  .or(literal("contract"))
  .or(literal("capacity"))
  .or(literal("consent"))
  .or(literal("session"));

const blocked = attempt.extend({
  attempts: integer.min(1),
  kind: literal("blocked"),
  cause: blockCause,
});

const stored = attempt.extend({
  attempts: integer.min(1),
  kind: literal("stored"),
  retryAtMs: immediate,
  receipt: VoltsRideRangeReceiptSchema,
});

const journalOwnerSchema = envelope.extend({
  apiOrigin: text
    .url()
    .max(512)
    .refine((value) => new URL(value).origin === value)
    .transform((value) => new URL(value).origin),
  userId: MeResponseSchema.shape.user.shape.id.transform((value) => value.toLowerCase()),
  journalId: JournalIdSchema,
});

const sequenceKeySchema = text
  .or(integer)
  .array()
  .length(4)
  .readonly()
  .transform((value) => {
    const owner = journalOwnerSchema.parse({
      apiOrigin: journalOwnerSchema.shape.apiOrigin.parse(value[0]),
      userId: journalOwnerSchema.shape.userId.parse(value[1]),
      journalId: journalOwnerSchema.shape.journalId.parse(value[2]),
    });

    return progressSequenceKey(owner, integer.parse(value[3]));
  });

const ownership = journalOwnerSchema.extend({
  consentVersion: integer.positive(),
  sessionGeneration: ProgressSessionGenerationSchema,
  revision: text.uuid(),
  payload: LocalProgressBatchSchema,
  hash: text.regex(/^[0-9a-f]{16}$/u),
  phase: literal("open").or(literal("sealed")),
  state: queued.or(sending).or(blocked).or(stored),
  startTick: integer,
  endTick: integer,
  startSequence: integer,
  endSequence: integer,
  sequences: integer.array().max(LOCAL_PROGRESS_MAX_CHECKPOINTS).readonly(),
  sequenceKeys: sequenceKeySchema.array().max(LOCAL_PROGRESS_MAX_CHECKPOINTS).readonly(),
  factCount: integer.max(LOCAL_PROGRESS_MAX_FACTS),
  timeS: HealthResponseSchema.shape.uptimeS,
});

function validateOwnership(
  row: Readonly<ProgressOutboxRow>,
  ctx: Readonly<ProgressIssueContext>,
): void {
  const first = row.payload.checkpoints[0];

  if (
    first === undefined ||
    first.journalId !== row.journalId ||
    row.payload.consentVersion !== row.consentVersion ||
    row.payload.sessionGeneration !== row.sessionGeneration
  ) {
    rowIssue(ctx, "Progress row ownership must match its immutable batch", ["payload"]);
  }
}

export const ProgressOutboxRowSchema = ownership
  .strict()
  .readonly()
  .superRefine((row: Readonly<ProgressOutboxRow>, ctx: Readonly<ProgressIssueContext>) => {
    validateOwnership(row, ctx);

    if (
      row.state.kind === "blocked" &&
      row.state.cause === "retry" &&
      row.state.attempts !== PROGRESS_OUTBOX_MAX_ATTEMPTS
    ) {
      rowIssue(ctx, "Retry-blocked progress batch must have exhausted five attempts", [
        "state",
        "attempts",
      ]);
    }

    if (
      row.state.kind === "stored" &&
      (row.state.receipt.journalId !== row.journalId ||
        row.state.receipt.startTick > row.startTick ||
        row.state.receipt.endTick < row.endTick)
    ) {
      rowIssue(ctx, "Progress receipt must cover its immutable batch range", ["state", "receipt"]);
    }

    const metadata = progressRowMetadata(row, row.payload);

    if (
      row.startTick !== metadata.startTick ||
      row.endTick !== metadata.endTick ||
      row.startSequence !== metadata.startSequence ||
      row.endSequence !== metadata.endSequence ||
      row.factCount !== metadata.factCount ||
      row.timeS !== metadata.timeS ||
      JSON.stringify(row.sequences) !== JSON.stringify(metadata.sequences)
    ) {
      rowIssue(ctx, "Progress row metadata does not match its payload", ["metadata"]);
    }

    if (JSON.stringify(row.sequenceKeys) !== JSON.stringify(metadata.sequenceKeys)) {
      rowIssue(ctx, "Progress sequence keys do not match their owner and payload", [
        "sequenceKeys",
      ]);
    }

    if (row.hash !== progressPayloadHash(row.payload)) {
      rowIssue(ctx, "Progress payload hash does not match", ["hash"]);
    }
  });
