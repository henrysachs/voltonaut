import { Inject, Injectable } from "@nestjs/common";
import { STRAVA_NOTICE_REVISION } from "@voltonaut/shared";
import type {
  StravaConsent,
  StravaDelivery,
  StravaRideView,
  StravaStatus,
} from "@voltonaut/shared";
import { ApiError } from "../api-error.js";
import { CLOCK } from "../config.module.js";
import type { Clock } from "../config.module.js";
import { RidesService } from "../rides/rides.service.js";
import { StravaDeliveryStore } from "./strava.delivery-store.js";
import { StravaStore } from "./strava.store.js";
import { StravaService } from "./strava.service.js";

function publicDelivery(delivery: StravaDelivery): StravaDelivery {
  return {
    deliveryId: delivery.deliveryId,
    rideId: delivery.rideId,
    authority: delivery.authority,
    progress: delivery.progress,
  };
}

function connectionBlock(
  status: StravaStatus,
): Extract<StravaRideView, { readonly kind: "blocked" }> | undefined {
  switch (status.status) {
    case "disabled":
      return { kind: "blocked", reason: "connection_disabled" };
    case "disconnected":
      return { kind: "blocked", reason: "connection_missing" };
    case "pending":
    case "confirmation_expired":
      return { kind: "blocked", reason: "confirmation_required" };
    case "credentials_unavailable":
    case "credentials_uncertain":
    case "reauthorization_required":
    case "revocation_pending":
    case "refreshing":
      return { kind: "blocked", reason: status.status };
    case "connected":
      return undefined;
    default: {
      const exhaustive: never = status;

      return exhaustive;
    }
  }
}

@Injectable()
export class StravaDeliveryService {
  public constructor(
    @Inject(RidesService) private readonly rides: Readonly<RidesService>,
    @Inject(StravaDeliveryStore) private readonly jobs: Readonly<StravaDeliveryStore>,
    @Inject(StravaStore) private readonly connections: Readonly<StravaStore>,
    @Inject(StravaService) private readonly strava: Readonly<StravaService>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public source(userId: string, rideId: string) {
    return this.rides.loadOwnStravaSource(userId, rideId);
  }

  public offer(
    userId: string,
    rideId: string,
  ): Exclude<StravaRideView, { readonly kind: "delivery" }> {
    const source = this.source(userId, rideId);

    if (source.kind === "blocked")
      return {
        kind: "blocked",
        reason:
          source.reason === "policy_disabled"
            ? "source_policy_disabled"
            : source.reason === "window_blocked"
              ? "window_source"
              : "not_replayed",
      };
    const blocked = connectionBlock(this.strava.status(userId));

    if (blocked !== undefined) return blocked;
    const row = this.connections.connection(userId);

    if (row === undefined) return { kind: "blocked", reason: "connection_missing" };

    return {
      kind: "offer",
      assurance: "client_declared",
      consent: {
        rideId: source.rideId,
        payloadHash: source.payloadHash,
        exportHash: source.exportHash,
        exportVersion: source.exportVersion,
        connectionGeneration: row.generation,
        athleteId: row.athleteId,
        sourcePolicy: source.policy,
        noticeRevision: STRAVA_NOTICE_REVISION,
      },
    };
  }

  public view(userId: string, rideId: string): StravaRideView {
    this.source(userId, rideId);
    const delivery = this.jobs.own(userId, rideId);

    if (delivery !== undefined) return { kind: "delivery", delivery: publicDelivery(delivery) };

    return this.offer(userId, rideId);
  }

  public request(userId: string, rideId: string, consent: StravaConsent): StravaDelivery {
    this.source(userId, rideId);
    const existing = this.jobs.own(userId, rideId);

    if (existing !== undefined) return publicDelivery(existing);
    const offer = this.offer(userId, rideId);

    if (offer.kind !== "offer" || JSON.stringify(offer.consent) !== JSON.stringify(consent))
      throw new ApiError(409, "strava_connection_conflict", "reload the upload offer");

    return publicDelivery(this.jobs.enqueue(userId, consent, this.clock.nowMs()));
  }
}
