import { sql } from "drizzle-orm";
import { StravaDeliverySchema } from "@voltonaut/shared";
import type {
  StravaConsent,
  StravaDelivery,
  StravaProgress,
  StravaReceipt,
} from "@voltonaut/shared";
import type { ServerDatabase } from "../database/drizzle.provider.js";
import type { StravaConnection } from "./strava.store.js";
import type { StravaTables } from "./strava.schema.js";
import type { ProviderUploadState, SubmitResult } from "./strava.upload-provider.js";

export type OwnedDelivery = StravaDelivery & { readonly userId: string };

export type SubmittingDelivery = OwnedDelivery & {
  readonly progress: Extract<StravaProgress, { readonly kind: "submitting" }>;
};

export function parseDelivery(
  row: Readonly<StravaTables["deliveries"]["$inferSelect"]>,
): OwnedDelivery {
  const authority: unknown = JSON.parse(row.authority);
  const progress: unknown = JSON.parse(row.progress);

  return {
    ...StravaDeliverySchema.parse({
      deliveryId: row.deliveryId,
      rideId: row.rideId,
      authority,
      progress,
    }),
    userId: row.userId,
  };
}

export function observedProgress(
  receipt: StravaReceipt,
  state: ProviderUploadState,
  nowMs: number,
): StravaProgress {
  if (state.kind === "delivered")
    return { kind: "delivered", receipt, activityId: state.activityId, confirmedAtMs: nowMs };

  if (state.kind === "error")
    return { kind: "processing_rejected", receipt, reason: "provider_error" };

  return { kind: "processing", receipt, nextPollAtMs: nowMs + 1500, issue: "none" };
}

export function submittedProgress(
  attemptId: string,
  result: SubmitResult,
  nowMs: number,
): StravaProgress {
  if (result.kind === "known") return observedProgress(result.receipt, result.state, nowMs);

  if (result.kind === "refused") return { kind: "submission_rejected", reason: result.reason };

  return { kind: "submission_unknown", attemptId, reason: result.reason };
}

export function canDispatch(
  job: OwnedDelivery,
  work: StravaConnection,
  source: StravaConsent,
  current: StravaConnection | undefined,
  nowMs: number,
): boolean {
  return (
    job.progress.kind === "preparing" &&
    job.progress.leaseUntilMs > nowMs &&
    job.authority.kind === "consented" &&
    JSON.stringify(source) === JSON.stringify(job.authority.consent) &&
    current !== undefined &&
    current.status === "connected" &&
    current.credentialState === "available" &&
    current.generation === source.connectionGeneration &&
    current.tokenRevision === work.tokenRevision &&
    current.workOwner !== null &&
    current.workOwner === work.workOwner &&
    current.workKind === "submit" &&
    current.workUntil > nowMs
  );
}

export type DueDeliveryKind = "prepare" | "recover" | "poll";

export function prepareDueDeliveries(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle owns the mutable connection.
  db: ServerDatabase,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle metadata passes unchanged through DI.
  tables: StravaTables,
  kind: DueDeliveryKind,
) {
  const table = tables.deliveries;
  const nowMs = sql.placeholder("nowMs");
  const progressKind = sql`json_extract(${table.progress}, '$.kind')`;
  const authorityKind = sql`json_extract(${table.authority}, '$.kind')`;

  const conditions = {
    prepare: sql`${authorityKind} = 'consented' AND ((${progressKind} = 'queued' AND json_extract(${table.progress}, '$.notBeforeMs') <= ${nowMs}) OR (${progressKind} = 'preparing' AND json_extract(${table.progress}, '$.leaseUntilMs') <= ${nowMs}))`,
    recover: sql`${progressKind} = 'submitting' AND json_extract(${table.progress}, '$.leaseUntilMs') <= ${nowMs}`,
    poll: sql`${authorityKind} = 'consented' AND ${progressKind} = 'processing' AND json_extract(${table.progress}, '$.nextPollAtMs') <= ${nowMs}`,
  };

  const order = sql`coalesce(json_extract(${table.progress}, '$.notBeforeMs'), json_extract(${table.progress}, '$.leaseUntilMs'), json_extract(${table.progress}, '$.nextPollAtMs'), 0)`;
  const query = db.select().from(table).where(conditions[kind]);

  return query.orderBy(order).limit(100).prepare();
}
