import type { ExecutionContextPort } from "../api-error.js";
import { SetMetadata, UnauthorizedException, createParamDecorator } from "@nestjs/common";

import { errorEnvelope } from "@voltonaut/shared";
import { z } from "zod";

/** Principal the auth guard attaches to every authenticated request. */
export interface SessionPrincipal {
  readonly userId: string;
  readonly email: string;
  readonly sessionTokenHash: string;
}

/** Shape of the request object after the auth guard has run. */
export interface AuthenticatedRequest {
  readonly headers: AuthorizationHeaders;
  session?: SessionPrincipal;
}

export interface TrackerRequest {
  readonly ip?: unknown;
  readonly body?: unknown;
  readonly session?: SessionPrincipal;
}

export const IS_PUBLIC_KEY = "voltonaut:isPublicRoute";

/** Marks a route as reachable without a bearer session. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

const NonEmptyStringSchema = z.string().min(1);

function isNonEmptyString(value: unknown): value is string {
  return NonEmptyStringSchema.safeParse(value).success;
}

export interface AuthorizationHeaders {
  readonly authorization?: unknown;
}

/** Extracts `Bearer <token>` from the authorization header, if well-formed. */
export function bearerTokenFromHeaders(headers: AuthorizationHeaders): string {
  const header = headers.authorization;

  if (!isNonEmptyString(header) || !header.startsWith("Bearer ")) {
    throw new UnauthorizedException(errorEnvelope("unauthorized", "missing bearer token"));
  }

  const token = header.slice("Bearer ".length);

  if (!isNonEmptyString(token)) {
    throw new UnauthorizedException(errorEnvelope("unauthorized", "missing bearer token"));
  }

  return token;
}

/** Controller parameter that yields the authenticated session principal. */
export const CurrentSession = createParamDecorator(
  (_data: void, context: ExecutionContextPort): SessionPrincipal => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const session = request.session;

    if (session === undefined) {
      throw new UnauthorizedException(errorEnvelope("unauthorized", "missing session"));
    }

    return session;
  },
);
