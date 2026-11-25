/* oxlint-disable typescript/prefer-readonly-parameter-types -- Row inputs are readonly contracts; Oxlint does not follow imported aliases. */
import type { VoltsRideRangeReceipt } from "@voltonaut/shared";

import { progressPayloadHash } from "./progressOutboxHash.js";
import {
  ProgressOutboxRowSchema,
  progressRowMetadata,
  type NewProgressOutboxRowInput,
  type ProgressOutboxRow,
} from "./progressOutboxSchema.js";

function buildProgressOutboxRow(input: Readonly<NewProgressOutboxRowInput>): ProgressOutboxRow {
  const { owner, consentVersion, sessionGeneration, batch, phase = "sealed" } = input;
  const state = input.state ?? { kind: "queued", attempts: 0, retryAtMs: 0 };

  return Object.freeze({
    apiOrigin: owner.apiOrigin,
    userId: owner.userId,
    journalId: owner.journalId,
    consentVersion,
    sessionGeneration,
    revision: crypto.randomUUID(),
    payload: batch,
    hash: progressPayloadHash(batch),
    phase,
    state,
    ...progressRowMetadata(owner, batch),
  });
}

export function newProgressOutboxRow(
  input: Readonly<NewProgressOutboxRowInput>,
): ProgressOutboxRow {
  return ProgressOutboxRowSchema.parse(buildProgressOutboxRow(input));
}

/** Creates a row from normalized inputs and an already validated local batch. */
export function newValidatedProgressOutboxRow(
  input: Readonly<NewProgressOutboxRowInput>,
): ProgressOutboxRow {
  return buildProgressOutboxRow(input);
}

export function progressOutboxKey(
  row: Readonly<ProgressOutboxRow>,
): readonly [string, string, string, number] {
  return [row.apiOrigin, row.userId, row.journalId, row.startTick];
}

export function progressReceiptCoversRow(
  receipt: Readonly<VoltsRideRangeReceipt>,
  row: Readonly<ProgressOutboxRow>,
): boolean {
  return (
    receipt.journalId === row.journalId &&
    receipt.startTick <= row.startTick &&
    receipt.endTick >= row.endTick
  );
}
