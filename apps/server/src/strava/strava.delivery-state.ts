import { StravaDeliverySchema } from "@voltonaut/shared";
import type {
  StravaConsent,
  StravaDelivery,
  StravaProgress,
  StravaReceipt,
} from "@voltonaut/shared";
import type { StravaConnection } from "./strava.store.js";
import type { StravaTables } from "./strava.schema.js";
import type { ProviderUploadState } from "./strava.upload-provider.js";

export type OwnedDelivery = StravaDelivery & { readonly userId: string };

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
