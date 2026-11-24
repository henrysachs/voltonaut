import { Inject, Injectable } from "@nestjs/common";
import { SERVER_CONFIG, CLOCK } from "../config.module.js";
import type { ServerConfig, Clock } from "../config.module.js";
import type { OidcProviderConfig } from "../oidc-config.js";
import { DRIZZLE } from "../database/drizzle.provider.js";
import type { ServerDatabase } from "../database/drizzle.provider.js";
import { ApiError } from "../api-error.js";
import { AuthService } from "./auth.service.js";
import { createToken, hashToken } from "./tokens.js";
import { OidcClient } from "./oidc-client.js";
import {
  OidcOpaqueSchema,
  invalidOidcLogin,
  oidcBrowserBinding,
  oidcBindingCookie,
  oidcFinishError,
} from "./oidc-cookie.js";
import {
  claimTransaction,
  cleanupOidcRows,
  deleteTransaction,
  insertTransaction,
  replaceTransactionByHandoff,
  takeHandoff,
} from "./oidc-store.js";

@Injectable()
export class OidcService {
  private readonly clients = new Map<string, OidcClient>();

  public constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle owns the mutable SQLite connection.
    @Inject(DRIZZLE) private readonly db: ServerDatabase,
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuthService) private readonly auth: Pick<AuthService, "issueSession" | "currentUser">,
  ) {
    if (config.auth.mode === "oidc") {
      for (const provider of config.auth.providers)
        this.clients.set(
          provider.id,
          new OidcClient({ provider, allowLoopbackHttp: config.auth.allowLoopbackHttp }),
        );
    }
  }

  public cookie(value: string, clear = false): string {
    return oidcBindingCookie(value, this.secure(), clear);
  }

  public async start(
    providerId: string,
  ): Promise<{ readonly location: string; readonly cookie: string }> {
    const client = this.requireClient(providerId);
    const state = createToken();
    const binding = createToken();
    const nonce = createToken();
    const verifier = createToken();
    const nowMs = this.clock.nowMs();
    cleanupOidcRows(this.db, nowMs);
    insertTransaction(this.db, { state, binding, provider: providerId, nonce, verifier }, nowMs);

    try {
      return {
        location: await client.authorizationUrl({ state, nonce, verifier }),
        cookie: this.cookie(binding),
      };
    } catch {
      deleteTransaction(this.db, hashToken(state));
      throw new ApiError(503, "internal_error", "login provider unavailable");
    }
  }

  public async callback(
    providerId: string,
    originalUrl: string,
    cookie: string | undefined,
  ): Promise<string> {
    const client = this.requireClient(providerId);
    const provider = this.providerConfig(providerId);
    const claimed = this.claimCallback(provider, originalUrl, cookie);
    const { transaction } = claimed;

    try {
      const identity = await client
        .identity(claimed.callbackUrl, {
          state: claimed.state,
          nonce: transaction.nonce,
          verifier: transaction.verifier,
        })
        .catch(() => {
          throw invalidOidcLogin();
        });

      if (provider.requireEmailVerified && identity.email_verified !== true)
        throw new ApiError(
          403,
          "email_not_verified",
          "the login provider did not verify the email address",
        );

      const nowMs = this.clock.nowMs();

      if (transaction.expiresAt <= nowMs) throw invalidOidcLogin();
      const code = createToken();
      replaceTransactionByHandoff(this.db, this.auth, { identity, transaction, code }, nowMs);

      return this.finishUrl("code", code);
    } catch (error) {
      const finishError = error instanceof ApiError ? oidcFinishError(error.code) : undefined;

      if (finishError !== undefined) return this.finishUrl("error", finishError);

      throw error;
    } finally {
      deleteTransaction(this.db, transaction.stateHash);
    }
  }

  public exchange(
    code: string,
    cookie: string | undefined,
    userAgent: string | undefined,
  ): ReturnType<AuthService["issueSession"]> {
    this.oidcProviders();
    const binding = oidcBrowserBinding(cookie, this.secure());
    const nowMs = this.clock.nowMs();

    return this.db.transaction(
      () => {
        const userId = takeHandoff(this.db, { code, binding }, nowMs);

        if (userId === undefined) throw invalidOidcLogin();

        return this.auth.issueSession(userId, userAgent, nowMs);
      },
      { behavior: "immediate" },
    );
  }

  private claimCallback(
    provider: Readonly<OidcProviderConfig>,
    originalUrl: string,
    cookie: string | undefined,
  ) {
    const binding = oidcBrowserBinding(cookie, this.secure());
    const callback = new URL(provider.redirectUri);
    const incoming = new URL(originalUrl, callback.origin);

    if (incoming.pathname !== callback.pathname) throw invalidOidcLogin();
    callback.search = incoming.search;
    const states = callback.searchParams.getAll("state");
    const state = OidcOpaqueSchema.safeParse(states.length === 1 ? states[0] : undefined);

    if (!state.success) throw invalidOidcLogin();

    const transaction = claimTransaction(
      this.db,
      { state: state.data, binding, provider: provider.id },
      this.clock.nowMs(),
    );

    if (transaction === undefined) throw invalidOidcLogin();

    return { callbackUrl: callback.href, state: state.data, transaction };
  }

  private finishUrl(key: "code" | "error", value: string): string {
    const finish = new URL("/auth/finish", this.config.clientOrigin);
    finish.searchParams.set(key, value);

    return finish.href;
  }

  private oidcProviders(): readonly OidcProviderConfig[] {
    if (this.config.auth.mode !== "oidc")
      throw new ApiError(404, "not_found", "login method unavailable");

    return this.config.auth.providers;
  }

  private providerConfig(providerId: string): OidcProviderConfig {
    const provider = this.oidcProviders().find((candidate) => candidate.id === providerId);

    if (provider === undefined) throw new ApiError(404, "not_found", "login method unavailable");

    return provider;
  }

  private secure(): boolean {
    return this.oidcProviders().every((provider) => provider.redirectUri.startsWith("https:"));
  }

  private requireClient(providerId: string): OidcClient {
    const client = this.clients.get(providerId);

    if (client === undefined) throw new ApiError(404, "not_found", "login method unavailable");

    return client;
  }
}
