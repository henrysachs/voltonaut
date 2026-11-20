import { Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { errorEnvelope } from "@voltonaut/shared";

import { Inject } from "@nestjs/common";
import { CLOCK } from "../clock.js";
import type { Clock } from "../clock.js";
import { AuthService } from "./auth.service.js";
import type { AuthServicePort } from "./auth.service.js";
import type { AuthenticatedRequest } from "./auth-request.js";
import { IS_PUBLIC_KEY } from "./auth-request.js";
import { bearerTokenFromHeaders } from "./auth-request.js";

interface ReflectorPort {
  readonly getAllAndOverride: (
    metadataKey: string,
    levels: readonly object[],
  ) => boolean | undefined;
}

interface GuardContext {
  readonly getHandler: () => object;
  readonly getClass: () => object;
  readonly switchToHttp: () => { readonly getRequest: () => AuthenticatedRequest };
}

/**
 * Global bearer guard. Protects every /v1 route except those marked with
 * `@Public()`; attaches the session principal for controllers and the
 * per-account rate-limit trackers.
 */
@Injectable()
export class AuthGuard {
  public constructor(
    @Inject(Reflector) private readonly reflector: ReflectorPort,
    @Inject(AuthService) private readonly authService: AuthServicePort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public canActivate(context: GuardContext): boolean {
    const isPublic = this.reflector.getAllAndOverride(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic === true) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const token = bearerTokenFromHeaders(request.headers);
    const principal = this.authService.validateSession(token, this.clock.nowMs());

    if (principal === undefined) {
      throw new UnauthorizedException(errorEnvelope("unauthorized", "invalid session token"));
    }

    request.session = principal;

    return true;
  }
}
