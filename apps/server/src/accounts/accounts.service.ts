import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";

import { ProfileInputSchema } from "@voltonaut/shared";
import type { PresentProfile, ProfileInput, ProfileState } from "@voltonaut/shared";
import { DRIZZLE } from "../database/drizzle.provider.js";
import type { ServerDatabase } from "../database/drizzle.provider.js";
import { ACCOUNTS_TABLES } from "./accounts.schema.js";
import type { AccountsTables } from "./accounts.schema.js";

@Injectable()
export class AccountsService {
  public constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle handles contain mutable driver state; retain the ORM type.
    @Inject(DRIZZLE) private readonly db: ServerDatabase,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle tables contain mutable column metadata required by query builders.
    @Inject(ACCOUNTS_TABLES) private readonly tables: AccountsTables,
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
}
