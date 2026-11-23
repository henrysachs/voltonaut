import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import type { AdminUsersQuery } from "@voltonaut/shared";
import { DRIZZLE, type ServerDatabase } from "../database/drizzle.provider.js";
import { users } from "./auth.schema.js";

@Injectable()
export class AuthDirectory {
  constructor(@Inject(DRIZZLE) private readonly db: Pick<ServerDatabase, "select">) {}

  public findActive(userId: string): { readonly id: string; readonly email: string } | undefined {
    return this.db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .get();
  }

  public list(
    query: Readonly<AdminUsersQuery>,
  ): readonly { readonly id: string; readonly email: string }[] {
    return this.db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(
        and(
          isNull(users.deletedAt),
          query.cursor === undefined ? undefined : gt(users.id, query.cursor),
        ),
      )
      .orderBy(asc(users.id))
      .limit(query.limit + 1)
      .all();
  }
}
