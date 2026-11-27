import { Inject, Injectable } from "@nestjs/common";
import type { CanActivate } from "@nestjs/common";
import { z } from "zod";
import { SERVER_CONFIG } from "../config.module.js";
import type { ServerConfig } from "../config.js";
import type { ExecutionContextPort } from "../api-error.js";
import { invalidStrava, hasWriteScope } from "./strava.provider.js";

const StravaOpaqueSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const COOKIE_NAME = "voltonaut-strava";

export function stravaCallbackUrl(originalUrl: string, redirectUri: string) {
  const url = new URL(originalUrl, redirectUri);

  const single = (name: string) => {
    const values = url.searchParams.getAll(name);

    return values.length === 1 ? values[0] : undefined;
  };

  const state = StravaOpaqueSchema.safeParse(single("state"));

  if (!state.success || url.pathname !== "/v1/strava/callback") throw invalidStrava();

  return {
    state: state.data,
    denied: single("error") === "access_denied",
    authorization: () => {
      const code = z
        .string()
        .min(1)
        .max(2048)
        .regex(/^[\u0021-\u007E]+$/u)
        .safeParse(single("code"));

      const scope = z.string().max(1024).safeParse(single("scope"));

      if (
        url.searchParams.has("error") ||
        !code.success ||
        !scope.success ||
        !hasWriteScope(scope.data)
      )
        throw invalidStrava();

      return code.data;
    },
  };
}

export function stravaBinding(cookie: string | undefined): string {
  const prefix = `${COOKIE_NAME}=`;

  const values = (cookie ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(prefix));

  const binding = StravaOpaqueSchema.safeParse(
    values.length === 1 ? values[0]?.slice(prefix.length) : undefined,
  );

  if (!binding.success) throw invalidStrava();

  return binding.data;
}

export function stravaCookie(value: string, secure: boolean, clear = false): string {
  return `${COOKIE_NAME}=${value}; Path=/v1/strava; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 360}${secure ? "; Secure" : ""}`;
}

@Injectable()
export class StravaOriginGuard implements CanActivate {
  public constructor(@Inject(SERVER_CONFIG) private readonly config: ServerConfig) {}
  public canActivate(context: ExecutionContextPort): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ readonly headers: { readonly origin?: string } }>();

    if (request.headers.origin !== this.config.clientOrigin) throw invalidStrava();

    return true;
  }
}
