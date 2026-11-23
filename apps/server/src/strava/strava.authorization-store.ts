import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { DRIZZLE } from "../database/drizzle.provider.js";
import type { ServerDatabase } from "../database/drizzle.provider.js";
import { STRAVA_TABLES } from "./strava.schema.js";
import type { StravaTables } from "./strava.schema.js";
import type { StravaConnection } from "./strava.store.js";

@Injectable()
export class StravaAuthorizationStore {
  private hintQuery: ReturnType<StravaAuthorizationStore["prepareHint"]> | undefined;
  private nextQuery: ReturnType<StravaAuthorizationStore["prepareNext"]> | undefined;
  private validQuery: ReturnType<StravaAuthorizationStore["prepareDefer"]> | undefined;
  private deferredQuery: ReturnType<StravaAuthorizationStore["prepareDefer"]> | undefined;

  public constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle owns the mutable connection.
    @Inject(DRIZZLE) private readonly db: ServerDatabase,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle metadata passes unchanged through DI.
    @Inject(STRAVA_TABLES) private readonly tables: StravaTables,
  ) {}

  public hint(athleteId: string): void {
    (this.hintQuery ??= this.prepareHint()).run({ athleteId });
  }

  private prepareHint() {
    const t = this.tables.connections;

    return this.db
      .update(t)
      .set({ authorizationHintRevision: sql`${t.authorizationHintRevision} + 1` })
      .where(and(eq(t.athleteId, sql.placeholder("athleteId")), eq(t.status, "connected")))
      .prepare();
  }

  public next(nowMs: number): StravaConnection | undefined {
    return (this.nextQuery ??= this.prepareNext()).get({ nowMs });
  }

  private prepareNext() {
    const t = this.tables.connections;

    return this.db
      .select()
      .from(t)
      .where(
        and(
          eq(t.status, "connected"),
          eq(t.credentialState, "available"),
          or(isNull(t.workOwner), lte(t.workUntil, sql.placeholder("nowMs"))),
          gt(t.authorizationHintRevision, t.authorizationCheckedRevision),
          lte(t.authorizationCheckAfter, sql.placeholder("nowMs")),
        ),
      )
      .orderBy(t.authorizationCheckAfter)
      .limit(1)
      .prepare();
  }

  public defer(row: StravaConnection, untilMs: number, valid: boolean): void {
    if (row.workOwner === null || row.workKind !== "poll") return;

    const query = valid
      ? (this.validQuery ??= this.prepareDefer(true))
      : (this.deferredQuery ??= this.prepareDefer(false));

    query.run({
      untilMs,
      authorizationHintRevision: row.authorizationHintRevision,
      userId: row.userId,
      generation: row.generation,
      tokenRevision: row.tokenRevision,
      workOwner: row.workOwner,
    });
  }

  private prepareDefer(valid: boolean) {
    const t = this.tables.connections;

    const update = valid
      ? {
          authorizationCheckAfter: sql`${sql.placeholder("untilMs")}`,
          authorizationCheckedRevision: sql`${sql.placeholder("authorizationHintRevision")}`,
        }
      : { authorizationCheckAfter: sql`${sql.placeholder("untilMs")}` };

    return this.db
      .update(t)
      .set(update)
      .where(
        and(
          eq(t.userId, sql.placeholder("userId")),
          eq(t.generation, sql.placeholder("generation")),
          eq(t.tokenRevision, sql.placeholder("tokenRevision")),
          eq(t.workOwner, sql.placeholder("workOwner")),
          eq(t.workKind, "poll"),
          eq(t.status, "connected"),
        ),
      )
      .prepare();
  }
}
