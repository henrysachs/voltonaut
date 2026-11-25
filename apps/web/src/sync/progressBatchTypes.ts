/* oxlint-disable typescript/prefer-readonly-parameter-types -- Zod issue paths are mutable at the callback boundary; all domain inputs remain readonly. */
import type { ProgressCheckpointBatch, RideProgressCheckpoint } from "@voltonaut/shared";

export const LOCAL_PROGRESS_MAX_FACTS = 120;
export const LOCAL_PROGRESS_MAX_TIME_S = 6;
export const LOCAL_PROGRESS_MAX_CHECKPOINTS = 120;
export const SERVER_PROGRESS_MAX_BATCHES = 10;
export const SERVER_PROGRESS_MAX_FACTS = 1200;
export const SERVER_PROGRESS_MAX_TIME_S = 60;

export type ProgressBatch = ProgressCheckpointBatch;

export interface ProgressBatchUpdate {
  readonly sealed: readonly ProgressBatch[];
  readonly open: ProgressBatch | undefined;
}

export interface ProgressBatchAppendInput {
  readonly open: ProgressBatch | undefined;
  readonly checkpoint: Readonly<RideProgressCheckpoint>;
  readonly consentVersion: number;
  readonly sessionGeneration: number;
}

export interface ProgressIssueContext {
  readonly addIssue: (issue: {
    readonly code: "custom";
    readonly message: string;
    readonly path: (string | number)[];
  }) => void;
}
