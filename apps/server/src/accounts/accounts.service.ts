import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";

import {
  AccountStatusSchema,
  ProfileInputSchema,
  type AccountStatus,
  type AdminUsers,
  type AdminUsersQuery,
  type Authorization,
  type Membership,
} from "@voltonaut/shared";
import type { PresentProfile, ProfileInput, ProfileState } from "@voltonaut/shared";
import { DRIZZLE } from "../database/drizzle.provider.js";
import type { ServerDatabase } from "../database/drizzle.provider.js";
import { ACCOUNTS_TABLES } from "./accounts.schema.js";
import type { AccountsTables } from "./accounts.schema.js";
import { ApiError } from "../api-error.js";
import { AuthDirectory } from "../auth/auth-directory.js";

@Injectable()
export class AccountsService {
  public constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle handles contain mutable driver state; retain the ORM type.
    @Inject(DRIZZLE) private readonly db: ServerDatabase,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle tables contain mutable column metadata required by query builders.
    @Inject(ACCOUNTS_TABLES) private readonly tables: AccountsTables,
    @Inject(AuthDirectory) private readonly directory: Readonly<AuthDirectory>,
  ) {}

  public getProfile(userId: string): ProfileState {
    const profiles = this.tables.profiles;
    const row = this.db.select().from(profiles).where(eq(profiles.userId, userId)).get();

    return row === undefined
      ? { status: "missing" }
      : {
          status: "present",
          profile: ProfileInputSchema.parse(JSON.parse(row.profileJson)),
          updatedAt: new Date(row.updatedAt).toISOString(),
        };
  }

  public putProfile(userId: string, profile: ProfileInput, nowMs: number): PresentProfile {
    const profiles = this.tables.profiles;
    const values = { userId, profileJson: JSON.stringify(profile), updatedAt: nowMs };
    this.db
      .insert(profiles)
      .values(values)
      .onConflictDoUpdate({
        target: profiles.userId,
        set: { profileJson: values.profileJson, updatedAt: nowMs },
      })
      .run();

    return { status: "present", profile, updatedAt: new Date(nowMs).toISOString() };
  }

  public status(userId: string): AccountStatus {
    this.requireUser(userId);
    const table = this.tables.accountStatus;
    const row = this.db.select().from(table).where(eq(table.userId, userId)).get();

    return AccountStatusSchema.parse({
      membership: { tier: row?.tier ?? "normal", vip: row?.vip ?? false },
      authorization: { role: row?.role ?? "user" },
    });
  }

  public requireAdmin(userId: string): void {
    if (this.status(userId).authorization.role !== "admin")
      throw new ApiError(403, "forbidden", "administrator required");
  }

  public list(query: Readonly<AdminUsersQuery>): AdminUsers {
    const rows = this.directory.list(query);
    const page = rows.slice(0, query.limit);

    return {
      users: page.map((row) => {
        const profile = this.getProfile(row.id);

        return {
          ...row,
          displayName: profile.status === "present" ? profile.profile.displayName : null,
          membership: this.status(row.id).membership,
        };
      }),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  public setMembership(
    actorId: string,
    userId: string,
    membership: Readonly<Membership>,
  ): AccountStatus {
    return this.db.transaction(
      () => {
        this.requireAdmin(actorId);
        this.requireUser(userId);
        const table = this.tables.accountStatus;
        this.db
          .insert(table)
          .values({ userId, ...membership })
          .onConflictDoUpdate({ target: table.userId, set: membership })
          .run();

        return this.status(userId);
      },
      { behavior: "immediate" },
    );
  }

  public deleteOwn(userId: string): void {
    this.db.delete(this.tables.profiles).where(eq(this.tables.profiles.userId, userId)).run();
    this.db
      .delete(this.tables.accountStatus)
      .where(eq(this.tables.accountStatus.userId, userId))
      .run();
  }

  public setRole(userId: string, authorization: Readonly<Authorization>): AccountStatus {
    return this.db.transaction(
      () => {
        this.requireUser(userId);
        const table = this.tables.accountStatus;
        this.db
          .insert(table)
          .values({ userId, ...authorization })
          .onConflictDoUpdate({ target: table.userId, set: authorization })
          .run();

        return this.status(userId);
      },
      { behavior: "immediate" },
    );
  }

  private requireUser(userId: string): void {
    if (this.directory.findActive(userId) === undefined)
      throw new ApiError(404, "not_found", "account not found");
  }
}
