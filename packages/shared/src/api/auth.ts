import { z } from "zod";

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  createdAt: z.string().datetime(),
});

export type User = z.infer<typeof UserSchema>;

/** `POST /v1/auth/magic-link` request body. */
export const MagicLinkRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
});

export type MagicLinkRequest = z.infer<typeof MagicLinkRequestSchema>;

/** `POST /v1/auth/session` request body: the raw login token from the magic link. */
export const SessionRequestSchema = z.object({
  loginToken: z.string().min(1).max(256),
});

export type SessionRequest = z.infer<typeof SessionRequestSchema>;

/** `POST /v1/auth/session` response. */
export const SessionResponseSchema = z.object({
  sessionToken: z.string().min(43),
  user: UserSchema,
});

export type SessionResponse = z.infer<typeof SessionResponseSchema>;

export const OidcProviderChoiceSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/u),
    displayName: z.string().min(1).max(40),
  })
  .strict();

export type OidcProviderChoice = z.infer<typeof OidcProviderChoiceSchema>;

export const AuthConfigResponseSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("disabled") }).strict(),
  z
    .object({
      mode: z.literal("oidc"),
      providers: z.array(OidcProviderChoiceSchema).min(1),
    })
    .strict(),
  z.object({ mode: z.literal("magic-link") }).strict(),
]);

export type AuthConfigResponse = z.infer<typeof AuthConfigResponseSchema>;

export const OidcExchangeRequestSchema = z
  .object({ code: z.string().regex(/^[A-Za-z0-9_-]{43}$/u) })
  .strict();

/** Failures the browser callback reports to the client as `/auth/finish?error=<code>`. */
export const OidcFinishErrorSchema = z.enum(["identity_conflict", "email_not_verified"]);

export type OidcFinishError = z.infer<typeof OidcFinishErrorSchema>;

export type OidcExchangeRequest = z.infer<typeof OidcExchangeRequestSchema>;

/** `POST /v1/auth/oidc/:provider/link` response: where the browser continues the fresh login. */
export const OidcLinkStartResponseSchema = z.object({ location: z.string().url() }).strict();

export type OidcLinkStartResponse = z.infer<typeof OidcLinkStartResponseSchema>;

/** A login identity connected to the signed-in account; the provider subject stays private. */
export const LinkedIdentitySchema = z
  .object({
    providerId: OidcProviderChoiceSchema.shape.id.nullable(),
    displayName: z.string().min(1).max(255),
  })
  .strict();

export type LinkedIdentity = z.infer<typeof LinkedIdentitySchema>;

/** `GET /v1/auth/identities` and `POST /v1/auth/identities` response. */
export const LinkedIdentitiesResponseSchema = z
  .object({ identities: z.array(LinkedIdentitySchema) })
  .strict();

export type LinkedIdentitiesResponse = z.infer<typeof LinkedIdentitiesResponseSchema>;

export const MeResponseSchema = z.object({ user: UserSchema });

export type MeResponse = z.infer<typeof MeResponseSchema>;
