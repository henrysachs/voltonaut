import { z } from "zod";
import { ApiError } from "../api-error.js";

export const OidcOpaqueSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);

export function invalidOidcLogin(): ApiError {
  return new ApiError(401, "invalid_oidc_login", "login is invalid, used, or expired");
}

export function oidcCookieName(secure: boolean): string {
  return secure ? "__Host-voltonaut-oidc" : "voltonaut-oidc";
}

export function oidcBrowserBinding(cookie: string | undefined, secure: boolean): string {
  const prefix = `${oidcCookieName(secure)}=`;

  const values = (cookie ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(prefix));

  const parsed = OidcOpaqueSchema.safeParse(
    values.length === 1 ? values[0]?.slice(prefix.length) : undefined,
  );

  if (!parsed.success) throw invalidOidcLogin();

  return parsed.data;
}

export function oidcBindingCookie(value: string, secure: boolean, clear: boolean): string {
  return `${oidcCookieName(secure)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 360}${secure ? "; Secure" : ""}`;
}
