import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gt, lte, inArray, count, isNull } from "drizzle-orm";
import { SERVER_CONFIG, CLOCK } from "../config.module.js";
import type { ServerConfig, Clock } from "../config.module.js";
import { DRIZZLE } from "../database/drizzle.provider.js";
import type { ServerDatabase } from "../database/drizzle.provider.js";
import { AuthService } from "./auth.service.js";
import { oidcTransactions, oidcHandoffs } from "./auth.schema.js";
import { createToken, hashToken } from "./tokens.js";
import { resolveOidcUser } from "./auth-recreation-guards.js";
import { OidcClient } from "./oidc-client.js";
import type { IdentityClaims, OidcConfig } from "./oidc-client.js";
import {
  ApiError,
  OidcOpaqueSchema,
  invalidOidcLogin,
  oidcBrowserBinding,
  oidcBindingCookie,
} from "./oidc-cookie.js";

export const OIDC_TRANSACTION_TTL_MS = 5 * 60_000;
export const OIDC_HANDOFF_TTL_MS = 60_000;

@Injectable()
export class OidcService {
  private readonly client: OidcClient | undefined;

  public constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle owns the mutable SQLite connection.
    @Inject(DRIZZLE) private readonly db: ServerDatabase,
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuthService) private readonly auth: Pick<AuthService, "issueSession" | "currentUser">,
  ) {
    if (config.auth.mode === "oidc") this.client = new OidcClient(config.auth);
  }

  public cookie(value: string, clear = false): string {
    return oidcBindingCookie(value, this.oidcConfig().redirectUri.startsWith("https:"), clear);
  }

  public async start(): Promise<{ readonly location: string; readonly cookie: string }> {
    const client = this.requireClient();
    const state = createToken();
    const binding = createToken();
    const nonce = createToken();
    const verifier = createToken();
    const nowMs = this.clock.nowMs();
    this.cleanup(nowMs);
    this.db.transaction(
      () => {
        const active = this.db.select({ total: count() }).from(oidcTransactions).get();
        const handoffs = this.db.select({ total: count() }).from(oidcHandoffs).get();

        if ((active?.total ?? 0) + (handoffs?.total ?? 0) >= 1000)
          throw new ApiError(429, "rate_limited", "too many login attempts");
        this.db
          .insert(oidcTransactions)
          .values({
            stateHash: hashToken(state),
            bindingHash: hashToken(binding),
            nonce,
            verifier,
            expiresAt: nowMs + OIDC_TRANSACTION_TTL_MS,
          })
          .run();
      },
      { behavior: "immediate" },
    );

    try {
      return {
        location: await client.authorizationUrl({ state, nonce, verifier }),
        cookie: this.cookie(binding),
      };
    } catch {
      this.db
        .delete(oidcTransactions)
        .where(eq(oidcTransactions.stateHash, hashToken(state)))
        .run();
      throw new ApiError(503, "internal_error", "login provider unavailable");
    }
  }

  public async callback(originalUrl: string, cookie: string | undefined): Promise<string> {
    const client = this.requireClient();
    const { callbackUrl, state, transaction } = this.claimCallback(originalUrl, cookie);

    try {
      const identity = await client
        .identity(callbackUrl, {
          state,
          nonce: transaction.nonce,
          verifier: transaction.verifier,
        })
        .catch(() => {
          throw invalidOidcLogin();
        });

      const nowMs = this.clock.nowMs();

      if (transaction.expiresAt <= nowMs) throw invalidOidcLogin();

      return this.createHandoff(identity, transaction, nowMs);
    } finally {
      this.db
        .delete(oidcTransactions)
        .where(eq(oidcTransactions.stateHash, transaction.stateHash))
        .run();
    }
  }

  private claimCallback(originalUrl: string, cookie: string | undefined) {
    const binding = oidcBrowserBinding(cookie, this.oidcConfig().redirectUri.startsWith("https:"));
    const callback = new URL(this.oidcConfig().redirectUri);
    const incoming = new URL(originalUrl, callback.origin);

    if (incoming.pathname !== callback.pathname) throw invalidOidcLogin();
    callback.search = incoming.search;
    const states = callback.searchParams.getAll("state");
    const state = OidcOpaqueSchema.safeParse(states.length === 1 ? states[0] : undefined);

    if (!state.success) throw invalidOidcLogin();

    const row = this.db
      .update(oidcTransactions)
      .set({ claimedAt: this.clock.nowMs() })
      .where(
        and(
          eq(oidcTransactions.stateHash, hashToken(state.data)),
          eq(oidcTransactions.bindingHash, hashToken(binding)),
          gt(oidcTransactions.expiresAt, this.clock.nowMs()),
          isNull(oidcTransactions.claimedAt),
        ),
      )
      .returning()
      .get();

    if (row === undefined) throw invalidOidcLogin();

    return { callbackUrl: callback.href, state: state.data, transaction: row };
  }

  private createHandoff(
    identity: IdentityClaims,
    transaction: Readonly<typeof oidcTransactions.$inferSelect>,
    nowMs: number,
  ): string {
    const code = createToken();
    this.db.transaction(
      () => {
        const reservation = this.db
          .delete(oidcTransactions)
          .where(
            and(
              eq(oidcTransactions.stateHash, transaction.stateHash),
              gt(oidcTransactions.expiresAt, nowMs),
            ),
          )
          .returning()
          .get();

        if (reservation === undefined) throw invalidOidcLogin();

        const userId = this.identityUser(identity, nowMs);
        this.cleanup(nowMs);
        this.db
          .insert(oidcHandoffs)
          .values({
            codeHash: hashToken(code),
            bindingHash: transaction.bindingHash,
            userId,
            expiresAt: nowMs + OIDC_HANDOFF_TTL_MS,
          })
          .run();
      },
      { behavior: "immediate" },
    );
    const finish = new URL("/auth/finish", this.config.clientOrigin);
    finish.searchParams.set("code", code);

    return finish.href;
  }

  public exchange(
    code: string,
    cookie: string | undefined,
    userAgent: string | undefined,
  ): ReturnType<AuthService["issueSession"]> {
    this.requireClient();
    const binding = oidcBrowserBinding(cookie, this.oidcConfig().redirectUri.startsWith("https:"));
    const nowMs = this.clock.nowMs();

    return this.db.transaction(
      () => {
        const row = this.db
          .delete(oidcHandoffs)
          .where(
            and(
              eq(oidcHandoffs.codeHash, hashToken(code)),
              eq(oidcHandoffs.bindingHash, hashToken(binding)),
              gt(oidcHandoffs.expiresAt, nowMs),
            ),
          )
          .returning()
          .get();

        if (row === undefined) throw invalidOidcLogin();

        return this.auth.issueSession(row.userId, userAgent, nowMs);
      },
      { behavior: "immediate" },
    );
  }

  private identityUser(identity: IdentityClaims, nowMs: number): string {
    return resolveOidcUser(this.db, this.auth, identity, nowMs);
  }

  private cleanup(nowMs: number): void {
    this.db
      .delete(oidcTransactions)
      .where(
        inArray(
          oidcTransactions.stateHash,
          this.db
            .select({ key: oidcTransactions.stateHash })
            .from(oidcTransactions)
            .where(lte(oidcTransactions.expiresAt, nowMs))
            .limit(100),
        ),
      )
      .run();
    this.db
      .delete(oidcHandoffs)
      .where(
        inArray(
          oidcHandoffs.codeHash,
          this.db
            .select({ key: oidcHandoffs.codeHash })
            .from(oidcHandoffs)
            .where(lte(oidcHandoffs.expiresAt, nowMs))
            .limit(100),
        ),
      )
      .run();
  }

  private oidcConfig(): OidcConfig {
    if (this.config.auth.mode !== "oidc")
      throw new ApiError(404, "not_found", "login method unavailable");

    return this.config.auth;
  }

  private requireClient(): OidcClient {
    this.oidcConfig();

    if (this.client === undefined) throw new ApiError(404, "not_found", "login method unavailable");

    return this.client;
  }
}
