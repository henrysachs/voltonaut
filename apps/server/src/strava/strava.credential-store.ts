import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, lte, sql } from "drizzle-orm";
import { DRIZZLE } from "../database/drizzle.provider.js";
import type { ServerDatabase } from "../database/drizzle.provider.js";
import { STRAVA_TABLES } from "./strava.schema.js";
import type { StravaTables } from "./strava.schema.js";
import type { StravaConnection } from "./strava.store.js";

export type { StravaConnection } from "./strava.store.js";

export type CredentialOperation = NonNullable<StravaConnection["workKind"]>;

function canClaim(row: StravaConnection, operation: CredentialOperation, nowMs: number): boolean {
  if (
    ["uncertain", "refreshing"].includes(row.credentialState) ||
    (row.workOwner !== null && row.workUntil > nowMs)
  )
    return false;

  return operation === "revoke"
    ? row.status === "revocation_pending"
    : row.status === "connected" && row.credentialState === "available";
}

@Injectable()
export class StravaCredentialStore {
  private connectionQuery: ReturnType<StravaCredentialStore["prepareConnection"]> | undefined;
  private recoverQuery: ReturnType<StravaCredentialStore["prepareRecover"]> | undefined;
  private claimQuery: ReturnType<StravaCredentialStore["prepareClaim"]> | undefined;
  private releaseQuery: ReturnType<StravaCredentialStore["prepareRelease"]> | undefined;
  private revocationsQuery: ReturnType<StravaCredentialStore["prepareRevocations"]> | undefined;

  public constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle owns the mutable connection.
    @Inject(DRIZZLE) private readonly db: ServerDatabase,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle metadata passes unchanged through DI.
    @Inject(STRAVA_TABLES) private readonly tables: StravaTables,
  ) {}

  public connection(userId: string): StravaConnection | undefined {
    return (this.connectionQuery ??= this.prepareConnection()).get({ userId });
  }

  private prepareConnection() {
    const table = this.tables.connections;

    return this.db
      .select()
      .from(table)
      .where(eq(table.userId, sql.placeholder("userId")))
      .prepare();
  }

  public recover(nowMs: number): void {
    (this.recoverQuery ??= this.prepareRecover()).run({ nowMs });
  }

  private prepareRecover() {
    const table = this.tables.connections;

    return this.db
      .update(table)
      .set({ credentialState: "uncertain" })
      .where(
        and(
          eq(table.workKind, "refresh"),
          lte(table.workUntil, sql.placeholder("nowMs")),
          eq(table.credentialState, "refreshing"),
        ),
      )
      .prepare();
  }

  public claimWork(
    userId: string,
    operation: CredentialOperation,
    nowMs: number,
  ): StravaConnection | undefined {
    return this.db.transaction(
      (): StravaConnection | undefined => {
        this.recover(nowMs);
        const row = this.connection(userId);

        if (row === undefined || !canClaim(row, operation, nowMs)) return undefined;

        return (this.claimQuery ??= this.prepareClaim()).get({
          workOwner: randomUUID(),
          workKind: operation,
          workUntil: nowMs + 10000,
          credentialState: operation === "refresh" ? "refreshing" : row.credentialState,
          userId,
          generation: row.generation,
          tokenRevision: row.tokenRevision,
        });
      },
      { behavior: "immediate" },
    );
  }

  private prepareClaim() {
    const table = this.tables.connections;

    return this.db
      .update(table)
      .set({
        workOwner: sql`${sql.placeholder("workOwner")}`,
        workKind: sql`${sql.placeholder("workKind")}`,
        workUntil: sql`${sql.placeholder("workUntil")}`,
        credentialState: sql`${sql.placeholder("credentialState")}`,
      })
      .where(
        and(
          eq(table.userId, sql.placeholder("userId")),
          eq(table.generation, sql.placeholder("generation")),
          eq(table.tokenRevision, sql.placeholder("tokenRevision")),
        ),
      )
      .returning()
      .prepare();
  }

  public blockAndClaimRevocation(userId: string, nowMs: number): StravaConnection | undefined {
    const { connections, transactions } = this.tables;

    return this.db.transaction(
      () => {
        this.db.delete(transactions).where(eq(transactions.userId, userId)).run();
        this.db
          .update(connections)
          .set({
            status: "revocation_pending",
            handoffHash: null,
            bindingHash: null,
            confirmBy: null,
          })
          .where(eq(connections.userId, userId))
          .run();

        return this.claimWork(userId, "revoke", nowMs);
      },
      { behavior: "immediate" },
    );
  }

  public releaseWork(row: StravaConnection): void {
    if (row.workOwner === null) return;
    (this.releaseQuery ??= this.prepareRelease()).run({
      userId: row.userId,
      generation: row.generation,
      workOwner: row.workOwner,
      tokenRevision: row.tokenRevision,
    });
  }

  private prepareRelease() {
    const table = this.tables.connections;

    return this.db
      .update(table)
      .set({ workOwner: null, workKind: null, workUntil: 0 })
      .where(
        and(
          eq(table.userId, sql.placeholder("userId")),
          eq(table.generation, sql.placeholder("generation")),
          eq(table.workOwner, sql.placeholder("workOwner")),
          eq(table.tokenRevision, sql.placeholder("tokenRevision")),
        ),
      )
      .prepare();
  }

  public revoked(row: StravaConnection): void {
    const table = this.tables.connections;

    if (
      row.workOwner === null ||
      row.credentialState === "uncertain" ||
      row.credentialState === "refreshing"
    )
      return;
    this.db
      .delete(table)
      .where(
        and(
          eq(table.userId, row.userId),
          eq(table.status, "revocation_pending"),
          eq(table.generation, row.generation),
          eq(table.tokenRevision, row.tokenRevision),
          eq(table.workOwner, row.workOwner),
          eq(table.workKind, "revoke"),
          eq(table.credentialState, row.credentialState),
        ),
      )
      .run();
  }

  public finishRefresh(
    row: StravaConnection,
    result:
      | {
          readonly kind: "refreshed";
          readonly encryptedTokens: string;
          readonly accessExpiresAt: number;
        }
      | { readonly kind: "refused" | "unknown" },
  ): boolean {
    const table = this.tables.connections;

    if (row.workOwner === null) return false;

    return (
      this.db
        .update(table)
        .set(
          result.kind === "refreshed"
            ? {
                encryptedTokens: result.encryptedTokens,
                accessExpiresAt: result.accessExpiresAt,
                tokenRevision: row.tokenRevision + 1,
                credentialState: "available",
                workOwner: null,
                workKind: null,
                workUntil: 0,
              }
            : {
                credentialState:
                  result.kind === "unknown" ? "uncertain" : "reauthorization_required",
                workOwner: null,
                workKind: null,
                workUntil: 0,
              },
        )
        .where(
          and(
            eq(table.userId, row.userId),
            eq(table.generation, row.generation),
            eq(table.tokenRevision, row.tokenRevision),
            eq(table.workOwner, row.workOwner),
            eq(table.workKind, "refresh"),
          ),
        )
        .run().changes === 1
    );
  }

  public requestAuthorizationCheck(row: StravaConnection): void {
    const table = this.tables.connections;

    if (
      row.workOwner === null ||
      (row.workKind !== "poll" && row.workKind !== "submit") ||
      row.status !== "connected" ||
      row.credentialState !== "available"
    )
      return;

    this.db
      .update(table)
      .set({ authorizationHintRevision: sql`${table.authorizationHintRevision} + 1` })
      .where(
        and(
          eq(table.userId, row.userId),
          eq(table.generation, row.generation),
          eq(table.tokenRevision, row.tokenRevision),
          eq(table.workOwner, row.workOwner),
          eq(table.workKind, row.workKind),
          eq(table.status, "connected"),
          eq(table.credentialState, "available"),
        ),
      )
      .run();
  }

  public pendingRevocations(): readonly StravaConnection[] {
    return (this.revocationsQuery ??= this.prepareRevocations()).all();
  }

  private prepareRevocations() {
    const table = this.tables.connections;

    return this.db
      .select()
      .from(table)
      .where(eq(table.status, "revocation_pending"))
      .limit(10)
      .prepare();
  }
}
