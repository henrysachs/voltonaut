import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gt, isNull } from "drizzle-orm/sql/expressions";

import type { SessionResponse, User } from "@voltonaut/shared";

import { SERVER_CONFIG, type ServerConfig } from "../config.module.js";
import { ApiError } from "../api-error.js";
import { DRIZZLE, type ServerDatabase } from "../database/drizzle.provider.js";
import { MAIL_SENDER, type MailSender } from "../mail/mail-sender.js";
import type { SessionPrincipal } from "./auth-request.js";
import { loginTokens, sessions, users, type UsersRow } from "./auth.schema.js";
import { createToken, hashDeletedEmail, hashToken } from "./tokens.js";

/** Magic links stay valid for 15 minutes and work exactly once (docs/08 §Betrieb). */
export const LOGIN_TOKEN_TTL_MS = 15 * 60_000;

@Injectable()
export class AuthService {
  public constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- drizzle's ServerDatabase is a deep-mutable ORM handle; no readonly view exists.
    @Inject(DRIZZLE) private readonly db: ServerDatabase,
    @Inject(MAIL_SENDER) private readonly mail: Readonly<MailSender> | null,
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
  ) {}

  /**
   * Creates a one-time login token and mails the magic link. Unknown and deleted
   * addresses receive the same response; a deleted address never creates an account.
   */
  public async requestMagicLink(email: string, nowMs: number): Promise<void> {
    this.requireMagicLink();

    if (this.mail === null) throw new ApiError(503, "internal_error", "mail delivery unavailable");
    const token = createToken();

    this.db
      .insert(loginTokens)
      .values({
        tokenHash: hashToken(token),
        email,
        expiresAt: nowMs + LOGIN_TOKEN_TTL_MS,
        usedAt: null,
      })
      .run();

    try {
      await this.mail.sendMagicLink(email, `${this.config.mail.clientOrigin}/#login=${token}`);
    } catch {
      this.db
        .delete(loginTokens)
        .where(eq(loginTokens.tokenHash, hashToken(token)))
        .run();
      throw new ApiError(503, "internal_error", "mail delivery unavailable");
    } finally {
      if (this.deletedEmail(email))
        this.db
          .delete(loginTokens)
          .where(eq(loginTokens.tokenHash, hashToken(token)))
          .run();
    }
  }

  /** Exchanges a fresh login token for a session; creates the account on first use. */
  public createSession(
    loginToken: string,
    userAgent: string | undefined,
    nowMs: number,
  ): SessionResponse {
    this.requireMagicLink();
    const tokenHash = hashToken(loginToken);

    return this.db.transaction(
      () => {
        const row = this.db
          .update(loginTokens)
          .set({ usedAt: nowMs })
          .where(
            and(
              eq(loginTokens.tokenHash, tokenHash),
              isNull(loginTokens.usedAt),
              gt(loginTokens.expiresAt, nowMs),
            ),
          )
          .returning()
          .get();

        if (row === undefined) {
          throw new ApiError(
            401,
            "invalid_login_token",
            "login token is unknown, used, or expired",
          );
        }

        const user = this.ensureUser(row.email, nowMs);

        return this.issueSession(user.id, userAgent, nowMs);
      },
      { behavior: "immediate" },
    );
  }

  /**
   * Resolves a bearer session and slides its TTL (30 days, `last_seen_at`
   * updated on every authenticated request). Returns undefined when the token
   * is unknown or expired.
   */
  public validateSession(sessionToken: string, nowMs: number): SessionPrincipal | undefined {
    if (this.config.auth.mode === "disabled") return undefined;
    const tokenHash = hashToken(sessionToken);

    const row = this.db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.tokenHash, tokenHash))
      .get();

    if (row === undefined || row.session.expiresAt <= nowMs || row.user.deletedAt !== null) {
      return undefined;
    }

    this.db
      .update(sessions)
      .set({ lastSeenAt: nowMs, expiresAt: nowMs + this.sessionTtlMs() })
      .where(eq(sessions.tokenHash, tokenHash))
      .run();

    return { userId: row.user.id, email: row.user.email, sessionTokenHash: tokenHash };
  }

  /** Deletes the session row behind this token; the token is invalid afterwards. */
  public logout(sessionTokenHash: string): void {
    this.db.delete(sessions).where(eq(sessions.tokenHash, sessionTokenHash)).run();
  }

  public currentUser(userId: string): User {
    const row = this.db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .get();

    if (row === undefined) throw new ApiError(401, "unauthorized", "invalid session token");

    return userFromRow(row);
  }

  public issueSession(
    userId: string,
    userAgent: string | undefined,
    nowMs: number,
  ): SessionResponse {
    if (this.config.auth.mode === "disabled")
      throw new ApiError(401, "unauthorized", "login disabled");
    const user = this.currentUser(userId);
    const sessionToken = createToken();
    this.db
      .insert(sessions)
      .values({
        tokenHash: hashToken(sessionToken),
        userId,
        createdAt: nowMs,
        lastSeenAt: nowMs,
        expiresAt: nowMs + this.sessionTtlMs(),
        userAgent: userAgent?.slice(0, 512) ?? null,
      })
      .run();

    return { sessionToken, user };
  }

  private requireMagicLink(): void {
    if (this.config.auth.mode !== "magic-link")
      throw new ApiError(404, "not_found", "login method unavailable");
  }

  private deletedEmail(email: string): boolean {
    return isDeletedEmail(this.db, this.config.auth.tombstoneHmacKey, email);
  }

  private ensureUser(email: string, nowMs: number): UsersRow {
    if (this.deletedEmail(email)) {
      throw new ApiError(401, "invalid_login_token", "login token is unknown, used, or expired");
    }

    const existing = this.db.select().from(users).where(eq(users.email, email)).get();

    if (existing !== undefined) {
      if (existing.deletedAt !== null) {
        throw new ApiError(401, "invalid_login_token", "login token is unknown, used, or expired");
      }

      return existing;
    }

    const created: UsersRow = {
      id: crypto.randomUUID(),
      email,
      createdAt: nowMs,
      deletedAt: null,
      deletedEmailHash: null,
    };

    this.db.insert(users).values(created).run();

    return created;
  }

  private sessionTtlMs(): number {
    return this.config.session.ttlDays * 24 * 60 * 60_000;
  }
}

/** Whether a deleted account's keyed email tombstone blocks this address. */
export function isDeletedEmail(
  db: Readonly<Pick<ServerDatabase, "select">>,
  hmacKey: string,
  email: string,
): boolean {
  return (
    db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.deletedEmailHash, hashDeletedEmail(hmacKey, email)))
      .get() !== undefined
  );
}

function userFromRow(row: UsersRow): User {
  return { id: row.id, email: row.email, createdAt: new Date(row.createdAt).toISOString() };
}

export interface AuthServicePort {
  readonly currentUser: (userId: string) => User;
  readonly requestMagicLink: (email: string, nowMs: number) => Promise<void>;
  readonly createSession: (
    loginToken: string,
    userAgent: string | undefined,
    nowMs: number,
  ) => SessionResponse;
  readonly validateSession: (sessionToken: string, nowMs: number) => SessionPrincipal | undefined;
  readonly logout: (sessionTokenHash: string) => void;
}
