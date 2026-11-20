import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UseGuards,
} from "@nestjs/common";
import { SkipThrottle, Throttle } from "@nestjs/throttler";

import type { MagicLinkRequest, SessionRequest, SessionResponse } from "@voltonaut/shared";
import { MagicLinkRequestSchema, SessionRequestSchema } from "@voltonaut/shared";

import { ZodValidationPipe } from "../pipes/zod-validation.pipe.js";
import { CLOCK } from "../clock.js";
import type { Clock } from "../clock.js";
import type { SessionPrincipal } from "./auth-request.js";
import { CurrentSession, Public } from "./auth-request.js";
import { AuthService } from "./auth.service.js";
import type { AuthServicePort } from "./auth.service.js";
import {
  MAGIC_LINK_EMAIL_THROTTLER,
  MAGIC_LINK_IP_THROTTLER,
  SESSION_IP_THROTTLER,
  AuthRateLimitGuard,
} from "./rate-limits.js";

@Controller("v1/auth")
export class AuthController {
  public constructor(
    @Inject(AuthService) private readonly authService: AuthServicePort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Always 204, regardless of whether the address is known (no enumeration).
   * Rate limits: per email and per IP (values from config).
   */
  @Post("magic-link")
  @Public()
  @UseGuards(AuthRateLimitGuard)
  @Throttle({ [MAGIC_LINK_EMAIL_THROTTLER]: {}, [MAGIC_LINK_IP_THROTTLER]: {} })
  @SkipThrottle({ [SESSION_IP_THROTTLER]: true })
  @HttpCode(HttpStatus.NO_CONTENT)
  public async requestMagicLink(
    @Body(new ZodValidationPipe(MagicLinkRequestSchema)) body: MagicLinkRequest,
  ): Promise<void> {
    await this.authService.requestMagicLink(body.email, this.clock.nowMs());
  }

  @Post("session")
  @Public()
  @UseGuards(AuthRateLimitGuard)
  @Throttle({ [SESSION_IP_THROTTLER]: {} })
  @SkipThrottle({ [MAGIC_LINK_EMAIL_THROTTLER]: true, [MAGIC_LINK_IP_THROTTLER]: true })
  @HttpCode(HttpStatus.OK)
  public createSession(
    @Body(new ZodValidationPipe(SessionRequestSchema)) body: SessionRequest,
    @Headers("user-agent") userAgent: string | undefined,
  ): SessionResponse {
    return this.authService.createSession(body.loginToken, userAgent, this.clock.nowMs());
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  public logout(@CurrentSession() session: SessionPrincipal): void {
    this.authService.logout(session.sessionTokenHash);
  }
}
