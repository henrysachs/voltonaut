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
  public constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle owns the mutable connection.
    @Inject(DRIZZLE) private readonly db: ServerDatabase,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle metadata passes unchanged through DI.
    @Inject(STRAVA_TABLES) private readonly tables: StravaTables,
  ) {}

  public connection(userId: string): StravaConnection | undefined {
    const table = this.tables.connections;

    return this.db.select().from(table).where(eq(table.userId, userId)).get();
  }

  public recover(nowMs: number): void {
    const table = this.tables.connections;
    this.db
      .update(table)
      .set({ credentialState: "uncertain" })
      .where(
        and(
          eq(table.workKind, "refresh"),
          lte(table.workUntil, nowMs),
          eq(table.credentialState, "refreshing"),
        ),
      )
      .run();
  }

  public claimWork(
    userId: string,
    operation: CredentialOperation,
    nowMs: number,
  ): StravaConnection | undefined {
    const table = this.tables.connections;

    return this.db.transaction(
      (): StravaConnection | undefined => {
        this.recover(nowMs);
        const row = this.connection(userId);

        if (row === undefined || !canClaim(row, operation, nowMs)) return undefined;

        return this.db
          .update(table)
          .set({
            workOwner: randomUUID(),
            workKind: operation,
            workUntil: nowMs + 10000,
            credentialState: operation === "refresh" ? "refreshing" : row.credentialState,
          })
          .where(
            and(
              eq(table.userId, userId),
              eq(table.generation, row.generation),
              eq(table.tokenRevision, row.tokenRevision),
            ),
          )
          .returning()
          .get();
      },
      { behavior: "immediate" },
    );
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
    const table = this.tables.connections;

    if (row.workOwner === null) return;
    this.db
      .update(table)
      .set({ workOwner: null, workKind: null, workUntil: 0 })
      .where(
        and(
          eq(table.userId, row.userId),
          eq(table.generation, row.generation),
          eq(table.workOwner, row.workOwner),
          eq(table.tokenRevision, row.tokenRevision),
        ),
      )
      .run();
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
    const table = this.tables.connections;

    return this.db
      .select()
      .from(table)
      .where(eq(table.status, "revocation_pending"))
      .limit(10)
      .all();
  }
}
