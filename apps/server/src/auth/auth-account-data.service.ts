import { Inject, Injectable } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import type { ServerConfig } from "../config.module.js";
import { SERVER_CONFIG } from "../config.module.js";
import { DRIZZLE } from "../database/drizzle.provider.js";
import type { ServerDatabase } from "../database/drizzle.provider.js";
import { AuthService } from "./auth.service.js";
import {
  authIdentities,
  authIdentityTombstones,
  loginTokens,
  oidcHandoffs,
  oidcTransactions,
  sessions,
  users,
} from "./auth.schema.js";
import { deletedAccountEmail, hashDeletedEmail, hashIdentity } from "./tokens.js";

@Injectable()
export class AuthAccountDataService {
  public constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle owns the mutable SQLite connection.
    @Inject(DRIZZLE) private readonly db: ServerDatabase,
    @Inject(AuthService) private readonly auth: Readonly<Pick<AuthService, "currentUser">>,
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
  ) {}

  public currentUser(userId: string) {
    return this.auth.currentUser(userId);
  }

  public exportOwn(
    userId: string,
  ): readonly { readonly issuer: string; readonly subject: string }[] {
    return this.db
      .select({ issuer: authIdentities.issuer, subject: authIdentities.subject })
      .from(authIdentities)
      .where(eq(authIdentities.userId, userId))
      .orderBy(asc(authIdentities.issuer), asc(authIdentities.subject))
      .all();
  }

  public deleteAccount(userId: string, nowMs: number): void {
    this.db.transaction(
      () => {
        const user = this.auth.currentUser(userId);

        const identities = this.db
          .select({ issuer: authIdentities.issuer, subject: authIdentities.subject })
          .from(authIdentities)
          .where(eq(authIdentities.userId, userId))
          .all();

        for (const identity of identities) {
          this.db
            .insert(authIdentityTombstones)
            .values({
              identityHash: hashIdentity(
                this.config.auth.tombstoneHmacKey,
                identity.issuer,
                identity.subject,
              ),
            })
            .onConflictDoNothing()
            .run();
        }

        this.db.delete(oidcTransactions).where(eq(oidcTransactions.linkUserId, userId)).run();
        this.db.delete(oidcHandoffs).where(eq(oidcHandoffs.userId, userId)).run();
        this.db.delete(authIdentities).where(eq(authIdentities.userId, userId)).run();
        this.db.delete(sessions).where(eq(sessions.userId, userId)).run();
        this.db.delete(loginTokens).where(eq(loginTokens.email, user.email)).run();
        this.db
          .update(users)
          .set({
            email: deletedAccountEmail(userId),
            deletedAt: nowMs,
            deletedEmailHash: hashDeletedEmail(this.config.auth.tombstoneHmacKey, user.email),
          })
          .where(eq(users.id, userId))
          .run();
      },
      { behavior: "immediate" },
    );
  }
}
