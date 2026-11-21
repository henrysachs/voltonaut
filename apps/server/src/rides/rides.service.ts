import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, gt } from "drizzle-orm";

import {
  RideRecordingSchema,
  RideAssessmentSchema,
  RideReceiptSchema,
  RideSummarySchema,
} from "@voltonaut/shared";
import type {
  RideRecording,
  RideDetail,
  RideList,
  RideListQuery,
  RideReceipt,
} from "@voltonaut/shared";
import { ApiError } from "../api-error.js";
import { DRIZZLE } from "../database/drizzle.provider.js";
import type { ServerDatabase } from "../database/drizzle.provider.js";
import { RIDES_TABLES } from "./rides.schema.js";
import type { RidesTables } from "./rides.schema.js";
import { prepareRide, sha256 } from "./rideAdmission.js";
import { SERVER_CONFIG } from "../config.module.js";
import type { ServerConfig } from "../config.js";

function notFound(): never {
  throw new ApiError(404, "not_found", "ride not found");
}

export type OwnStravaSource =
  | {
      readonly kind: "blocked";
      readonly reason:
        | "policy_disabled"
        | "legacy_missing_replay"
        | "incomplete_journal"
        | "unknown_revision"
        | "observation_mismatch"
        | "window_blocked"
        | "export_unavailable";
    }
  | {
      readonly kind: "ready";
      readonly rideId: string;
      readonly payloadHash: string;
      readonly exportHash: string;
      readonly exportVersion: "tcx-1";
      readonly tcx: string;
      readonly assurance: "client_declared";
      readonly policy: "declared_ble_v1";
    };

@Injectable()
export class RidesService {
  public constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle handles contain mutable driver state; retain the ORM type.
    @Inject(DRIZZLE) private readonly db: ServerDatabase,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle tables contain mutable column metadata required by query builders.
    @Inject(RIDES_TABLES) private readonly tables: RidesTables,
    @Inject(SERVER_CONFIG) private readonly config: Pick<ServerConfig, "rideSourcePolicy">,
  ) {}

  public store(userId: string, recording: RideRecording, nowMs: number): RideReceipt {
    const rides = this.tables.rides;
    const payloadJson = JSON.stringify(recording);
    const payloadHash = sha256(payloadJson);
    const existing = this.existingReceipt(userId, recording.rideId, payloadJson, payloadHash);

    if (existing !== undefined) return existing;
    const values = { ...prepareRide(userId, recording, nowMs), payloadJson, payloadHash };

    return this.db.transaction(
      () => {
        this.db.insert(rides).values(values).onConflictDoNothing({ target: rides.id }).run();

        return (
          this.existingReceipt(userId, recording.rideId, payloadJson, payloadHash) ?? notFound()
        );
      },
      { behavior: "immediate" },
    );
  }

  private existingReceipt(
    userId: string,
    rideId: string,
    payloadJson: string,
    payloadHash: string,
  ): RideReceipt | undefined {
    const rides = this.tables.rides;

    const stored = this.db
      .select({
        userId: rides.userId,
        payloadJson: rides.payloadJson,
        payloadHash: rides.payloadHash,
        receiptJson: rides.receiptJson,
      })
      .from(rides)
      .where(eq(rides.id, rideId))
      .get();

    if (stored === undefined) return undefined;

    if (stored.userId !== userId) return notFound();

    if (stored.payloadHash !== payloadHash || stored.payloadJson !== payloadJson) {
      throw new ApiError(409, "ride_id_conflict", "ride ID already stores a different recording");
    }

    return RideReceiptSchema.parse(JSON.parse(stored.receiptJson));
  }

  public loadOwnStravaSource(userId: string, rideId: string): OwnStravaSource {
    const rides = this.tables.rides;

    const stored = this.db
      .select({
        payloadHash: rides.payloadHash,
        assessmentJson: rides.assessmentJson,
        exportTcx: rides.exportTcx,
        exportHash: rides.exportHash,
        exportVersion: rides.exportVersion,
      })
      .from(rides)
      .where(and(eq(rides.id, rideId), eq(rides.userId, userId)))
      .get();

    if (stored === undefined) return notFound();

    if (this.config.rideSourcePolicy === "disabled")
      return { kind: "blocked", reason: "policy_disabled" };
    const assessment = RideAssessmentSchema.parse(JSON.parse(stored.assessmentJson));

    if (assessment.status !== "replayed") return { kind: "blocked", reason: assessment.reason };

    if (
      assessment.source.declaredSource !== "ble" ||
      assessment.source.window.kind !== "continuous"
    )
      return { kind: "blocked", reason: "window_blocked" };

    if (
      stored.exportTcx === null ||
      stored.exportHash === null ||
      stored.exportVersion !== "tcx-1" ||
      sha256(stored.exportTcx) !== stored.exportHash
    )
      return { kind: "blocked", reason: "export_unavailable" };

    return {
      kind: "ready",
      rideId,
      payloadHash: stored.payloadHash,
      exportHash: stored.exportHash,
      exportVersion: "tcx-1",
      tcx: stored.exportTcx,
      assurance: "client_declared",
      policy: "declared_ble_v1",
    };
  }

  public detail(userId: string, rideId: string): RideDetail {
    const rides = this.tables.rides;

    const stored = this.db
      .select({ payloadJson: rides.payloadJson, assessmentJson: rides.assessmentJson })
      .from(rides)
      .where(and(eq(rides.id, rideId), eq(rides.userId, userId)))
      .get();

    if (stored === undefined) {
      return notFound();
    }

    return {
      recording: RideRecordingSchema.parse(JSON.parse(stored.payloadJson)),
      assessment: RideAssessmentSchema.parse(JSON.parse(stored.assessmentJson)),
    };
  }

  public list(userId: string, query: RideListQuery): RideList {
    const rides = this.tables.rides;

    const rows = this.db
      .select({
        rideId: rides.id,
        startedAt: rides.startedAt,
        uploadedAt: rides.uploadedAt,
        durationMs: rides.durationMs,
        distanceM: rides.distanceM,
        source: rides.source,
        assessmentJson: rides.assessmentJson,
      })
      .from(rides)
      .where(
        and(
          eq(rides.userId, userId),
          query.cursor === undefined ? undefined : gt(rides.id, query.cursor),
        ),
      )
      .orderBy(asc(rides.id))
      .limit(query.limit + 1)
      .all();

    const page = rows.slice(0, query.limit);

    return {
      rides: page.map((row) =>
        RideSummarySchema.parse({
          rideId: row.rideId,
          startedAt: row.startedAt,
          uploadedAt: new Date(row.uploadedAt).toISOString(),
          durationMs: row.durationMs,
          distanceM: row.distanceM,
          source: row.source,
          assessment: RideAssessmentSchema.parse(JSON.parse(row.assessmentJson)),
        }),
      ),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.rideId ?? null) : null,
    };
  }
}
