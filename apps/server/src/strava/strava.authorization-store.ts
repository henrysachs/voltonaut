import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { DRIZZLE } from "../database/drizzle.provider.js";
import type { ServerDatabase } from "../database/drizzle.provider.js";
import { STRAVA_TABLES } from "./strava.schema.js";
import type { StravaTables } from "./strava.schema.js";
import type { StravaConnection } from "./strava.store.js";

@Injectable()
export class StravaAuthorizationStore {
  public constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle owns the mutable connection.
    @Inject(DRIZZLE) private readonly db: ServerDatabase,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle metadata passes unchanged through DI.
    @Inject(STRAVA_TABLES) private readonly tables: StravaTables,
  ) {}

  public hint(athleteId: string): void {
    const t = this.tables.connections;
    this.db
      .update(t)
      .set({ authorizationHintRevision: sql`${t.authorizationHintRevision} + 1` })
      .where(and(eq(t.athleteId, athleteId), eq(t.status, "connected")))
      .run();
  }

  public next(nowMs: number): StravaConnection | undefined {
    const t = this.tables.connections;

    return this.db
      .select()
      .from(t)
      .where(
        and(
          eq(t.status, "connected"),
          eq(t.credentialState, "available"),
          or(isNull(t.workOwner), lte(t.workUntil, nowMs)),
          gt(t.authorizationHintRevision, t.authorizationCheckedRevision),
          lte(t.authorizationCheckAfter, nowMs),
        ),
      )
      .orderBy(t.authorizationCheckAfter)
      .limit(1)
      .get();
  }

  public defer(row: StravaConnection, untilMs: number, valid: boolean): void {
    const t = this.tables.connections;

    if (row.workOwner === null || row.workKind !== "poll") return;

    const update = valid
      ? {
          authorizationCheckAfter: untilMs,
          authorizationCheckedRevision: row.authorizationHintRevision,
        }
      : { authorizationCheckAfter: untilMs };

    this.db
      .update(t)
      .set(update)
      .where(
        and(
          eq(t.userId, row.userId),
          eq(t.generation, row.generation),
          eq(t.tokenRevision, row.tokenRevision),
          eq(t.workOwner, row.workOwner),
          eq(t.workKind, "poll"),
          eq(t.status, "connected"),
        ),
      )
      .run();
  }
}
