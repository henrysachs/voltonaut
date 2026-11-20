import {
  Body,
  Controller,
  Get,
  Post,
  Inject,
  Headers,
  Header,
  Req,
  Res,
  HttpCode,
  UseGuards,
} from "@nestjs/common";
import { SkipThrottle, Throttle } from "@nestjs/throttler";
import {
  StravaStartRequestSchema,
  StravaConfirmRequestSchema,
  StravaDisconnectRequestSchema,
} from "@voltonaut/shared";
import type {
  StravaStartRequest,
  StravaConfirmRequest,
  StravaDisconnectRequest,
  StravaStatus,
  StravaStartResponse,
} from "@voltonaut/shared";
import { ZodValidationPipe } from "../pipes/zod-validation.pipe.js";
import { CurrentSession, Public } from "../auth/auth-request.js";
import type { SessionPrincipal } from "../auth/auth-request.js";
import {
  AuthRateLimitGuard,
  MAGIC_LINK_EMAIL_THROTTLER,
  MAGIC_LINK_IP_THROTTLER,
  SESSION_IP_THROTTLER,
} from "../auth/rate-limits.js";
import { StravaService } from "./strava.service.js";
import { StravaOriginGuard } from "./strava.browser.js";

interface StravaResponse {
  readonly setHeader: (name: string, value: string) => void;
  readonly redirect: (status: number, location: string) => void;
}

@Controller("v1/strava")
@UseGuards(AuthRateLimitGuard)
@Throttle({ [SESSION_IP_THROTTLER]: {} })
@SkipThrottle({ [MAGIC_LINK_EMAIL_THROTTLER]: true, [MAGIC_LINK_IP_THROTTLER]: true })
export class StravaController {
  public constructor(@Inject(StravaService) private readonly strava: Readonly<StravaService>) {}

  @Get("connection")
  @Header("Cache-Control", "no-store")
  public status(@CurrentSession() session: SessionPrincipal): StravaStatus {
    return this.strava.status(session.userId);
  }

  @Post("connect-start")
  @Header("Cache-Control", "no-store")
  @Header("Referrer-Policy", "no-referrer")
  @HttpCode(200)
  @UseGuards(StravaOriginGuard)
  public start(
    @CurrentSession() session: SessionPrincipal,
    @Body(new ZodValidationPipe(StravaStartRequestSchema)) _body: StravaStartRequest,
    @Res({ passthrough: true }) res: StravaResponse,
  ): StravaStartResponse {
    const result = this.strava.start(session.userId);
    res.setHeader("Set-Cookie", result.cookie);

    return { authorizationUrl: result.authorizationUrl };
  }

  @Get("callback")
  @Header("Cache-Control", "no-store")
  @Header("Referrer-Policy", "no-referrer")
  @Public()
  public async callback(
    @Req() req: { readonly originalUrl: string },
    @Headers("cookie") cookie: string | undefined,
    @Res() res: StravaResponse,
  ): Promise<void> {
    res.redirect(302, await this.strava.callback(req.originalUrl, cookie));
  }

  @Post("confirm")
  @Header("Cache-Control", "no-store")
  @HttpCode(200)
  @UseGuards(StravaOriginGuard)
  public confirm(
    @CurrentSession() session: SessionPrincipal,
    @Body(new ZodValidationPipe(StravaConfirmRequestSchema)) body: StravaConfirmRequest,
    @Headers("cookie") cookie: string | undefined,
  ): StravaStatus {
    return this.strava.confirm(session.userId, body.code, cookie);
  }

  @Post("disconnect")
  @Header("Cache-Control", "no-store")
  @HttpCode(200)
  @UseGuards(StravaOriginGuard)
  public disconnect(
    @CurrentSession() session: SessionPrincipal,
    @Body(new ZodValidationPipe(StravaDisconnectRequestSchema)) _body: StravaDisconnectRequest,
  ): Promise<StravaStatus> {
    return this.strava.disconnect(session.userId);
  }
}
