import * as oidc from "openid-client";
import { z } from "zod";
import { safeOidcUrl } from "../config.js";
import type { AuthConfig } from "../config.js";

export type OidcConfig = Extract<AuthConfig, { mode: "oidc" }>;

const IdentityClaimsSchema = z.object({
  iss: z.string().url(),
  sub: z.string().min(1).max(255),
  email: z.string().trim().toLowerCase().email().max(254),
});

export type IdentityClaims = z.infer<typeof IdentityClaimsSchema>;

export interface OidcChecks {
  readonly state: string;
  readonly nonce: string;
  readonly verifier: string;
}

export class OidcClient {
  private configuration: Promise<oidc.Configuration> | undefined;

  public constructor(private readonly config: OidcConfig) {}

  public async authorizationUrl(checks: OidcChecks): Promise<string> {
    const configuration = await this.getConfiguration();

    const url = oidc.buildAuthorizationUrl(configuration, {
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: "openid email",
      code_challenge_method: "S256",
      code_challenge: await oidc.calculatePKCECodeChallenge(checks.verifier),
      state: checks.state,
      nonce: checks.nonce,
    });

    if (!safeOidcUrl(url.href, this.config.allowLoopbackHttp))
      throw new Error("unsafe authorization endpoint");

    return url.href;
  }

  public async identity(callbackUrl: string, checks: OidcChecks): Promise<IdentityClaims> {
    const tokens = await oidc.authorizationCodeGrant(
      await this.getConfiguration(),
      new URL(callbackUrl),
      {
        expectedState: checks.state,
        expectedNonce: checks.nonce,
        pkceCodeVerifier: checks.verifier,
        idTokenExpected: true,
      },
    );

    return IdentityClaimsSchema.parse(tokens.claims());
  }

  private getConfiguration(): Promise<oidc.Configuration> {
    this.configuration ??= this.discover().catch(() => {
      this.configuration = undefined;
      throw new Error("OIDC provider unavailable");
    });

    return this.configuration;
  }

  private async discover(): Promise<oidc.Configuration> {
    const config = this.config;

    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Implements the library fetch boundary; native request bodies have no readonly view.
    const guardedFetch: oidc.CustomFetch = (url, options: Readonly<oidc.CustomFetchOptions>) => {
      if (!safeOidcUrl(url, config.allowLoopbackHttp)) throw new Error("unsafe OIDC endpoint");

      return fetch(url, { ...options, body: options.body ?? null, redirect: "error" });
    };

    const execute = [oidc.enableNonRepudiationChecks];

    if (config.allowLoopbackHttp) {
      // oxlint-disable-next-line typescript/no-deprecated -- Library marks this API deprecated as a warning; config and guardedFetch restrict it to development/test loopback HTTP.
      execute.push(oidc.allowInsecureRequests);
    }

    const configuration = await oidc.discovery(
      new URL(config.issuer),
      config.clientId,
      { id_token_signed_response_alg: "RS256", [oidc.clockTolerance]: 0 },
      oidc.ClientSecretBasic(config.clientSecret),
      {
        timeout: 2,
        [oidc.customFetch]: guardedFetch,
        execute,
      },
    );

    if (configuration.serverMetadata().issuer !== config.issuer)
      throw new Error("unexpected OIDC issuer");

    return configuration;
  }
}
