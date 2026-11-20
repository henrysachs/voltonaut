import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, gt } from "drizzle-orm";
import { createHash } from "node:crypto";

import {
  CompletedLocalRideSchema,
  RideAssessmentSchema,
  RideReceiptSchema,
  RideSummarySchema,
} from "@voltonaut/shared";
import type {
  CompletedLocalRide,
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

function notFound(): never {
  throw new ApiError(404, "not_found", "ride not found");
}

function storedRide(userId: string, recording: CompletedLocalRide, nowMs: number) {
  const payloadJson = JSON.stringify(recording);
  const payloadHash = createHash("sha256").update(payloadJson).digest("hex");

  const assessment = {
    status: "unverified",
    reason: "legacy_missing_replay",
  } satisfies RideReceipt["assessment"];

  const receipt: RideReceipt = { rideId: recording.rideId, storage: "stored", assessment };
  const last = recording.samples.at(-1);

  if (last === undefined) {
    throw new ApiError(422, "validation_failed", "recording has no samples");
  }

  return {
    id: recording.rideId,
    userId,
    payloadJson,
    payloadHash,
    receiptJson: JSON.stringify(receipt),
    assessmentJson: JSON.stringify(assessment),
    startedAt: recording.startedAt,
    uploadedAt: nowMs,
    durationMs: last.elapsedMs,
    distanceM: last.distanceM,
    source: recording.metadata.source,
  };
}

@Injectable()
export class RidesService {
  public constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle handles contain mutable driver state; retain the ORM type.
    @Inject(DRIZZLE) private readonly db: ServerDatabase,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle tables contain mutable column metadata required by query builders.
    @Inject(RIDES_TABLES) private readonly tables: RidesTables,
  ) {}

  public store(userId: string, recording: CompletedLocalRide, nowMs: number): RideReceipt {
    const rides = this.tables.rides;
    const values = storedRide(userId, recording, nowMs);

    return this.db.transaction(
      () => {
        this.db.insert(rides).values(values).onConflictDoNothing({ target: rides.id }).run();

        const stored = this.db
          .select({
            payloadJson: rides.payloadJson,
            payloadHash: rides.payloadHash,
            receiptJson: rides.receiptJson,
          })
          .from(rides)
          .where(and(eq(rides.id, recording.rideId), eq(rides.userId, userId)))
          .get();

        if (stored === undefined) {
          return notFound();
        }

        if (
          stored.payloadHash !== values.payloadHash ||
          stored.payloadJson !== values.payloadJson
        ) {
          throw new ApiError(
            409,
            "ride_id_conflict",
            "ride ID already stores a different recording",
          );
        }

        return RideReceiptSchema.parse(JSON.parse(stored.receiptJson));
      },
      { behavior: "immediate" },
    );
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
      recording: CompletedLocalRideSchema.parse(JSON.parse(stored.payloadJson)),
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
