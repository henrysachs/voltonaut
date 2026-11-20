import { Inject, Injectable } from "@nestjs/common";
import { and, count, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import { DRIZZLE } from "../database/drizzle.provider.js";
import type { ServerDatabase } from "../database/drizzle.provider.js";
import { STRAVA_TABLES } from "./strava.schema.js";
import type { StravaTables } from "./strava.schema.js";
import { invalidStrava, stravaConflict, stravaCapacityExceeded } from "./strava.provider.js";
import { decryptTokens } from "./strava.crypto.js";

type NewTransaction = Readonly<StravaTables["transactions"]["$inferInsert"]>;

type NewConnection = Readonly<StravaTables["connections"]["$inferInsert"]>;

type Connection = Readonly<StravaTables["connections"]["$inferSelect"]>;

@Injectable()
export class StravaStore {
  public constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle owns the mutable SQLite connection.
    @Inject(DRIZZLE) private readonly db: ServerDatabase,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle metadata is passed unchanged through DI.
    @Inject(STRAVA_TABLES) private readonly tables: StravaTables,
  ) {}

  public connection(userId: string) {
    const table = this.tables.connections;

    return this.db.select().from(table).where(eq(table.userId, userId)).get();
  }

  public start(row: NewTransaction, nowMs: number): void {
    const { transactions, connections } = this.tables;
    this.db
      .delete(transactions)
      .where(
        inArray(
          transactions.stateHash,
          this.db
            .select({ key: transactions.stateHash })
            .from(transactions)
            .where(lte(transactions.expiresAt, nowMs))
            .limit(100),
        ),
      )
      .run();
    this.db.transaction(
      () => {
        if (
          this.connection(row.userId) !== undefined ||
          this.db.select().from(transactions).where(eq(transactions.userId, row.userId)).get() !==
            undefined
        )
          throw stravaConflict();
        const active = this.db.select({ total: count() }).from(transactions).get();

        const pending = this.db
          .select({ total: count() })
          .from(connections)
          .where(eq(connections.status, "pending"))
          .get();

        if ((active?.total ?? 0) + (pending?.total ?? 0) >= 1000) throw stravaCapacityExceeded();
        this.db.insert(transactions).values(row).run();
      },
      { behavior: "immediate" },
    );
  }

  public claim(stateHash: string, bindingHash: string, nowMs: number) {
    const table = this.tables.transactions;

    const row = this.db
      .update(table)
      .set({ claimedAt: nowMs })
      .where(
        and(
          eq(table.stateHash, stateHash),
          eq(table.bindingHash, bindingHash),
          gt(table.expiresAt, nowMs),
          isNull(table.claimedAt),
        ),
      )
      .returning()
      .get();

    if (row === undefined) throw invalidStrava();

    return row;
  }

  public releaseTransaction(stateHash: string): void {
    const table = this.tables.transactions;
    this.db.delete(table).where(eq(table.stateHash, stateHash)).run();
  }

  public pending(stateHash: string, connection: NewConnection, nowMs: number): void {
    const { transactions, connections } = this.tables;
    this.db.transaction(
      () => {
        const row = this.db
          .delete(transactions)
          .where(and(eq(transactions.stateHash, stateHash), gt(transactions.expiresAt, nowMs)))
          .returning()
          .get();

        if (row === undefined) throw invalidStrava();

        if (
          this.db
            .select()
            .from(connections)
            .where(
              or(
                eq(connections.athleteId, connection.athleteId),
                eq(connections.userId, connection.userId),
              ),
            )
            .get() !== undefined
        )
          throw stravaConflict();
        this.db.insert(connections).values(connection).run();
      },
      { behavior: "immediate" },
    );
  }

  public confirm(
    userId: string,
    handoffHash: string,
    bindingHash: string,
    nowMs: number,
    key: string,
  ): void {
    const table = this.tables.connections;
    this.db.transaction(
      () => {
        const row = this.db
          .select()
          .from(table)
          .where(
            and(
              eq(table.userId, userId),
              eq(table.status, "pending"),
              eq(table.handoffHash, handoffHash),
              eq(table.bindingHash, bindingHash),
              gt(table.confirmBy, nowMs),
            ),
          )
          .get();

        if (row === undefined) throw invalidStrava();

        try {
          decryptTokens(row.encryptedTokens, key, userId, row.athleteId);
        } catch {
          throw invalidStrava();
        }

        this.db
          .update(table)
          .set({ status: "connected", handoffHash: null, bindingHash: null, confirmBy: null })
          .where(eq(table.userId, userId))
          .run();
      },
      { behavior: "immediate" },
    );
  }

  public blockAndClaimRevocation(userId: string, nowMs: number) {
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

        return this.db
          .update(connections)
          .set({ revokeLeaseUntil: nowMs + 10_000 })
          .where(and(eq(connections.userId, userId), lte(connections.revokeLeaseUntil, nowMs)))
          .returning()
          .get();
      },
      { behavior: "immediate" },
    );
  }

  public revoked(row: Connection): void {
    const table = this.tables.connections;
    this.db
      .delete(table)
      .where(
        and(
          eq(table.userId, row.userId),
          eq(table.encryptedTokens, row.encryptedTokens),
          eq(table.status, "revocation_pending"),
          eq(table.revokeLeaseUntil, row.revokeLeaseUntil),
        ),
      )
      .run();
  }

  public releaseRevocation(row: Connection): void {
    const table = this.tables.connections;
    this.db
      .update(table)
      .set({ revokeLeaseUntil: 0 })
      .where(
        and(
          eq(table.userId, row.userId),
          eq(table.encryptedTokens, row.encryptedTokens),
          eq(table.revokeLeaseUntil, row.revokeLeaseUntil),
        ),
      )
      .run();
  }
}
