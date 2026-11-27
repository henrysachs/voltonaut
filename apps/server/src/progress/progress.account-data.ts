import { Inject, Injectable } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";

import {
  ProgressAccountExportSchema,
  RideProgressPhysicsSchema,
  type ProgressAccountExport,
} from "@voltonaut/shared";
import { DRIZZLE, type ServerDatabase } from "../database/drizzle.provider.js";
import { ProgressRangeStore } from "./progress.range-store.js";
import { storedRideReference } from "./progress.reference.js";
import {
  PROGRESS_TABLES,
  type ProgressConsentRow,
  type ProgressTables,
  type RideProgressJournalRow,
  type RideProgressRangeRow,
} from "./progress.schema.js";
import { progressError } from "./progress.validation.js";

function storedPhysics(physicsJson: string) {
  try {
    return RideProgressPhysicsSchema.parse(JSON.parse(physicsJson));
  } catch {
    throw progressError(500, "internal_error", "corrupt progress journal physics");
  }
}

function exportConsent(consent: Readonly<ProgressConsentRow> | undefined) {
  return consent === undefined
    ? { status: "missing" }
    : {
        status: "present",
        version: consent.version,
        enabled: consent.enabled,
        sessionGeneration: consent.sessionGeneration,
        updatedAt: new Date(consent.updatedAt).toISOString(),
      };
}

/** Account export/deletion port for progress tables; progress stays the only owner of them. */
@Injectable()
export class ProgressAccountDataService {
  private readonly store: ProgressRangeStore;

  public constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle handles contain mutable driver state; retain the ORM type.
    @Inject(DRIZZLE) private readonly db: ServerDatabase,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle tables contain mutable column metadata required by query builders.
    @Inject(PROGRESS_TABLES) private readonly tables: ProgressTables,
  ) {
    this.store = new ProgressRangeStore(db, tables);
  }

  public exportOwn(userId: string): ProgressAccountExport {
    return ProgressAccountExportSchema.parse({
      consent: exportConsent(this.store.consent(userId)),
      journals: this.journalRows(userId).map((row) => this.exportJournal(row)),
      ranges: this.rangeRows(userId).map((row) => this.exportRange(row)),
    });
  }

  public deleteOwn(userId: string): void {
    const { progressConsents, rideProgressJournals, rideProgressRanges } = this.tables;

    this.db.delete(rideProgressRanges).where(eq(rideProgressRanges.userId, userId)).run();
    this.db.delete(rideProgressJournals).where(eq(rideProgressJournals.userId, userId)).run();
    this.db.delete(progressConsents).where(eq(progressConsents.userId, userId)).run();
  }

  private journalRows(userId: string): readonly RideProgressJournalRow[] {
    const journals = this.tables.rideProgressJournals;

    return this.db
      .select()
      .from(journals)
      .where(eq(journals.userId, userId))
      .orderBy(asc(journals.createdAt), asc(journals.journalId))
      .all();
  }

  private rangeRows(userId: string): readonly RideProgressRangeRow[] {
    const ranges = this.tables.rideProgressRanges;

    return this.db
      .select()
      .from(ranges)
      .where(eq(ranges.userId, userId))
      .orderBy(asc(ranges.journalId), asc(ranges.startTick))
      .all();
  }

  private exportJournal(row: Readonly<RideProgressJournalRow>) {
    return {
      journalId: row.journalId,
      sessionGeneration: row.sessionGeneration,
      consentVersion: row.consentVersion,
      source: row.source,
      clockScale: row.clockScale,
      physicsRevision: row.physicsRevision,
      ...storedRideReference(row),
      physics: storedPhysics(row.physicsJson),
      startedAtMs: row.startedAtMs,
      lastEndTick: row.lastEndTick,
      lastSequence: row.lastSequence,
      lastEndedAtMs: row.lastEndedAtMs,
      lastRewardDay: row.lastRewardDay,
      cumulativeFacts: this.store.facts(row),
      createdAt: new Date(row.createdAt).toISOString(),
    };
  }

  private exportRange(row: Readonly<RideProgressRangeRow>) {
    return {
      id: row.id,
      journalId: row.journalId,
      startTick: row.startTick,
      endTick: row.endTick,
      payloadHash: row.payloadHash,
      payload: this.store.payload(row),
      cumulativeFacts: this.store.rangeFacts(row),
      receipt: this.store.receipt(row),
      createdAt: new Date(row.createdAt).toISOString(),
    };
  }
}
