import { Controller, Get, Header, Inject } from "@nestjs/common";

import type { VoltsBalanceResponse } from "@voltonaut/shared";
import { CurrentSession } from "../auth/auth-request.js";
import type { SessionPrincipal } from "../auth/auth-request.js";
import { EconomyService } from "./economy.service.js";

@Controller("v1/me")
export class EconomyController {
  public constructor(
    @Inject(EconomyService) private readonly economy: Readonly<Pick<EconomyService, "balance">>,
  ) {}

  @Get("volts")
  @Header("Cache-Control", "no-store")
  public balance(@CurrentSession() session: SessionPrincipal): VoltsBalanceResponse {
    return { voltsBalance: this.economy.balance(session.userId) };
  }
}
