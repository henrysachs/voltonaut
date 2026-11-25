import type { ProgressCheckpointBatch, RideProgressCheckpoint } from "@voltonaut/shared";

import {
  SERVER_PROGRESS_MAX_BATCHES,
  SERVER_PROGRESS_MAX_FACTS,
  SERVER_PROGRESS_MAX_TIME_S,
  type ProgressBatch,
} from "./progressBatchTypes.js";
import {
  LocalProgressBatchSchema,
  PROGRESS_TIME_EPSILON_S,
  ServerProgressBatchSchema,
  assertProgressCheckpointContinuation,
  progressFactCount,
  progressSimulatedTimeS,
} from "./progressBatchSchema.js";

class ProgressGroupBuilder {
  readonly #first: ProgressBatch;
  readonly #groups: ProgressCheckpointBatch[] = [];
  #checkpoints: RideProgressCheckpoint[] = [];
  #factCount = 0;
  #batchCount = 0;
  #previous: RideProgressCheckpoint | undefined;

  constructor(first: ProgressBatch) {
    this.#first = first;
  }

  add(batch: ProgressBatch): void {
    if (batch.consentVersion !== this.#first.consentVersion) {
      throw new Error("Progress batches must retain one consent version");
    }

    const first = batch.checkpoints[0];

    if (first === undefined) throw new Error("Progress batch must contain a checkpoint");
    this.assertContinuation(first);

    const candidate = ServerProgressBatchSchema.safeParse({
      consentVersion: this.#first.consentVersion,
      sessionGeneration: this.#first.sessionGeneration,
      checkpoints: [...this.#checkpoints, ...batch.checkpoints],
    });

    if (
      !candidate.success ||
      this.#batchCount + 1 > SERVER_PROGRESS_MAX_BATCHES ||
      this.#factCount + progressFactCount(batch) > SERVER_PROGRESS_MAX_FACTS ||
      (candidate.success &&
        progressSimulatedTimeS(candidate.data) >
          SERVER_PROGRESS_MAX_TIME_S + PROGRESS_TIME_EPSILON_S)
    ) {
      this.flush();
    }

    for (const checkpoint of batch.checkpoints) this.#checkpoints.push(checkpoint);
    this.#factCount += progressFactCount(batch);
    this.#batchCount += 1;
    this.#previous = batch.checkpoints.at(-1);
  }

  finish(): readonly ProgressCheckpointBatch[] {
    this.flush();

    return Object.freeze(this.#groups);
  }

  private assertContinuation(first: RideProgressCheckpoint): void {
    if (this.#previous === undefined) return;

    assertProgressCheckpointContinuation(
      this.#previous,
      first,
      this.#first.consentVersion,
      this.#first.sessionGeneration,
    );
  }

  private flush(): void {
    if (this.#checkpoints.length === 0) return;

    this.#groups.push(
      ServerProgressBatchSchema.parse({
        consentVersion: this.#first.consentVersion,
        sessionGeneration: this.#first.sessionGeneration,
        checkpoints: this.#checkpoints,
      }),
    );
    this.#checkpoints = [];
    this.#factCount = 0;
    this.#batchCount = 0;
  }
}

export function groupProgressBatches(
  batches: readonly ProgressBatch[],
): readonly ProgressCheckpointBatch[] {
  const parsed = batches.map((batch) => LocalProgressBatchSchema.parse(batch));
  const first = parsed[0];

  if (first === undefined) return [];
  const builder = new ProgressGroupBuilder(first);

  for (const batch of parsed) builder.add(batch);

  return builder.finish();
}
