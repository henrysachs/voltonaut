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
import { OidcExchangeRequestSchema } from "@voltonaut/shared";
import type { AuthConfigResponse, OidcExchangeRequest, SessionResponse } from "@voltonaut/shared";
import { ZodValidationPipe } from "../pipes/zod-validation.pipe.js";
import { SERVER_CONFIG } from "../config.module.js";
import type { ServerConfig } from "../config.js";
import { ApiError } from "../api-error.js";
import { Public } from "./auth-request.js";
import { OidcService } from "./oidc.service.js";
import {
  AuthRateLimitGuard,
  MAGIC_LINK_EMAIL_THROTTLER,
  MAGIC_LINK_IP_THROTTLER,
  SESSION_IP_THROTTLER,
} from "./rate-limits.js";

interface RedirectResponse {
  readonly setHeader: (name: string, value: string) => void;
  readonly redirect: (status: number, location: string) => void;
}

@Controller("v1/auth")
@Public()
export class OidcController {
  public constructor(
    @Inject(OidcService) private readonly oidc: Pick<
      OidcService,
      "start" | "callback" | "exchange" | "cookie"
    >,
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
  ) {}

  @Get("config")
  @Header("Cache-Control", "no-store")
  public capability(): AuthConfigResponse {
    return { mode: this.config.auth.mode };
  }

  @Get("oidc/start")
  @Header("Cache-Control", "no-store")
  @Header("Referrer-Policy", "no-referrer")
  @UseGuards(AuthRateLimitGuard)
  @Throttle({ [SESSION_IP_THROTTLER]: {} })
  @SkipThrottle({ [MAGIC_LINK_EMAIL_THROTTLER]: true, [MAGIC_LINK_IP_THROTTLER]: true })
  public async start(
    @Req() req: { readonly originalUrl: string },
    @Res() res: RedirectResponse,
  ): Promise<void> {
    if (req.originalUrl.includes("?"))
      throw new ApiError(422, "validation_failed", "login start accepts no parameters");
    const result = await this.oidc.start();
    res.setHeader("Set-Cookie", result.cookie);
    res.redirect(302, result.location);
  }

  @Get("oidc/callback")
  @Header("Cache-Control", "no-store")
  @Header("Referrer-Policy", "no-referrer")
  @UseGuards(AuthRateLimitGuard)
  @Throttle({ [SESSION_IP_THROTTLER]: {} })
  @SkipThrottle({ [MAGIC_LINK_EMAIL_THROTTLER]: true, [MAGIC_LINK_IP_THROTTLER]: true })
  public async callback(
    @Req() req: { readonly originalUrl: string },
    @Headers("cookie") cookie: string | undefined,
    @Res() res: RedirectResponse,
  ): Promise<void> {
    res.redirect(302, await this.oidc.callback(req.originalUrl, cookie));
  }

  @Post("oidc/exchange")
  @Header("Cache-Control", "no-store")
  @Header("Referrer-Policy", "no-referrer")
  @HttpCode(200)
  @UseGuards(AuthRateLimitGuard)
  @Throttle({ [SESSION_IP_THROTTLER]: {} })
  @SkipThrottle({ [MAGIC_LINK_EMAIL_THROTTLER]: true, [MAGIC_LINK_IP_THROTTLER]: true })
  public exchange(
    @Body(new ZodValidationPipe(OidcExchangeRequestSchema)) body: OidcExchangeRequest,
    @Headers("cookie") cookie: string | undefined,
    @Headers("origin") origin: string | undefined,
    @Headers("user-agent") userAgent: string | undefined,
    @Res({ passthrough: true }) res: RedirectResponse,
  ): SessionResponse {
    if (origin !== this.config.clientOrigin)
      throw new ApiError(401, "invalid_oidc_login", "login origin mismatch");
    const session = this.oidc.exchange(body.code, cookie, userAgent);
    res.setHeader("Set-Cookie", this.oidc.cookie("", true));

    return session;
  }
}
