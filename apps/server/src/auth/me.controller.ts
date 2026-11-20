import { Controller, Get, Inject, Header } from "@nestjs/common";
import type { MeResponse } from "@voltonaut/shared";
import { AuthService } from "./auth.service.js";
import { CurrentSession } from "./auth-request.js";
import type { SessionPrincipal } from "./auth-request.js";

@Controller("v1/me")
export class MeController {
  public constructor(
    @Inject(AuthService) private readonly auth: Pick<AuthService, "currentUser">,
  ) {}

  @Get()
  @Header("Cache-Control", "no-store")
  public me(@CurrentSession() session: SessionPrincipal): MeResponse {
    return { user: this.auth.currentUser(session.userId) };
  }
}
