import { Body, Controller, Get, Inject, Put } from "@nestjs/common";

import { ProfileInputSchema } from "@voltonaut/shared";
import type { PresentProfile, ProfileInput, ProfileState } from "@voltonaut/shared";
import { CurrentSession } from "../auth/auth-request.js";
import type { SessionPrincipal } from "../auth/auth-request.js";
import { CLOCK } from "../clock.js";
import type { Clock } from "../clock.js";
import { ZodValidationPipe } from "../pipes/zod-validation.pipe.js";
import { AccountsService } from "./accounts.service.js";

@Controller("v1/me/profile")
export class AccountsController {
  public constructor(
    @Inject(AccountsService) private readonly accounts: Readonly<
      Pick<AccountsService, "getProfile" | "putProfile">
    >,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get()
  public get(@CurrentSession() session: SessionPrincipal): ProfileState {
    return this.accounts.getProfile(session.userId);
  }

  @Put()
  public put(
    @CurrentSession() session: SessionPrincipal,
    @Body(new ZodValidationPipe(ProfileInputSchema)) profile: ProfileInput,
  ): PresentProfile {
    return this.accounts.putProfile(session.userId, profile, this.clock.nowMs());
  }
}
