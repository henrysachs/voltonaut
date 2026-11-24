import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Res,
  UseGuards,
} from "@nestjs/common";
import { SkipThrottle, Throttle } from "@nestjs/throttler";
import { OidcExchangeRequestSchema } from "@voltonaut/shared";
import type {
  LinkedIdentitiesResponse,
  OidcExchangeRequest,
  OidcLinkStartResponse,
} from "@voltonaut/shared";
import { ZodValidationPipe } from "../pipes/zod-validation.pipe.js";
import { CurrentSession } from "./auth-request.js";
import type { SessionPrincipal } from "./auth-request.js";
import { OidcService } from "./oidc.service.js";
import { OidcLinkService } from "./oidc-link.service.js";
import {
  AuthRateLimitGuard,
  MAGIC_LINK_EMAIL_THROTTLER,
  MAGIC_LINK_IP_THROTTLER,
  SESSION_IP_THROTTLER,
} from "./rate-limits.js";

interface CookieResponse {
  readonly setHeader: (name: string, value: string) => void;
}

/** Authenticated routes that connect further login providers to the signed-in account. */
@Controller("v1/auth")
export class OidcLinkController {
  public constructor(
    @Inject(OidcService) private readonly oidc: Pick<OidcService, "start" | "cookie">,
    @Inject(OidcLinkService)
    private readonly links: Pick<
      OidcLinkService,
      "complete" | "identities" | "requireClientOrigin"
    >,
  ) {}

  @Post("oidc/:provider/link")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @Header("Referrer-Policy", "no-referrer")
  @UseGuards(AuthRateLimitGuard)
  @Throttle({ [SESSION_IP_THROTTLER]: {} })
  @SkipThrottle({ [MAGIC_LINK_EMAIL_THROTTLER]: true, [MAGIC_LINK_IP_THROTTLER]: true })
  public async startLink(
    @Param("provider") provider: string,
    @CurrentSession() session: SessionPrincipal,
    @Headers("origin") origin: string | undefined,
    @Res({ passthrough: true }) res: CookieResponse,
  ): Promise<OidcLinkStartResponse> {
    this.links.requireClientOrigin(origin);

    const started = await this.oidc.start(provider, {
      userId: session.userId,
      sessionHash: session.sessionTokenHash,
    });

    res.setHeader("Set-Cookie", started.cookie);

    return { location: started.location };
  }

  @Get("identities")
  @Header("Cache-Control", "no-store")
  public identities(@CurrentSession() session: SessionPrincipal): LinkedIdentitiesResponse {
    return this.links.identities(session.userId);
  }

  @Post("identities")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @Header("Referrer-Policy", "no-referrer")
  @UseGuards(AuthRateLimitGuard)
  @Throttle({ [SESSION_IP_THROTTLER]: {} })
  @SkipThrottle({ [MAGIC_LINK_EMAIL_THROTTLER]: true, [MAGIC_LINK_IP_THROTTLER]: true })
  public completeLink(
    @Body(new ZodValidationPipe(OidcExchangeRequestSchema)) body: OidcExchangeRequest,
    @CurrentSession() session: SessionPrincipal,
    @Headers("cookie") cookie: string | undefined,
    @Headers("origin") origin: string | undefined,
    @Res({ passthrough: true }) res: CookieResponse,
  ): LinkedIdentitiesResponse {
    this.links.requireClientOrigin(origin);
    const identities = this.links.complete(body.code, cookie, session);
    res.setHeader("Set-Cookie", this.oidc.cookie("", true));

    return identities;
  }
}
