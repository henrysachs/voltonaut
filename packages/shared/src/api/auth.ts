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

export const AuthConfigResponseSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("disabled") }).strict(),
  z.object({ mode: z.literal("oidc") }).strict(),
  z.object({ mode: z.literal("magic-link") }).strict(),
]);

export type AuthConfigResponse = z.infer<typeof AuthConfigResponseSchema>;

export const OidcExchangeRequestSchema = z
  .object({ code: z.string().regex(/^[A-Za-z0-9_-]{43}$/u) })
  .strict();

export type OidcExchangeRequest = z.infer<typeof OidcExchangeRequestSchema>;

export const MeResponseSchema = z.object({ user: UserSchema });

export type MeResponse = z.infer<typeof MeResponseSchema>;
