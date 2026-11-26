import { AccountExportRateLimitGuard } from "./account-export.rate-limit.js";
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Put,
  UseGuards,
} from "@nestjs/common";

import {
  AccountDeletionRequestSchema,
  ProfileInputSchema,
  type AccountDeletionRequest,
  type AccountDeletionResponse,
  type AccountExport,
  type AccountStatus,
  type PresentProfile,
  type ProfileInput,
  type ProfileState,
} from "@voltonaut/shared";
import { CurrentSession } from "../auth/auth-request.js";
import type { SessionPrincipal } from "../auth/auth-request.js";
import { CLOCK } from "../clock.js";
import type { Clock } from "../clock.js";
import { ZodValidationPipe } from "../pipes/zod-validation.pipe.js";
import { AccountsService } from "./accounts.service.js";
import { AccountDataService } from "./account-data.service.js";
import { ClientOriginGuard } from "../client-origin.guard.js";

@Controller("v1/me")
export class AccountsController {
  public constructor(
    @Inject(AccountsService) private readonly accounts: Readonly<
      Pick<AccountsService, "getProfile" | "putProfile" | "status">
    >,
    @Inject(AccountDataService) private readonly data: Readonly<AccountDataService>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get("account-status")
  @Header("Cache-Control", "no-store")
  public accountStatus(@CurrentSession() session: SessionPrincipal): AccountStatus {
    return this.accounts.status(session.userId);
  }

  @Get("profile")
  public get(@CurrentSession() session: SessionPrincipal): ProfileState {
    return this.accounts.getProfile(session.userId);
  }

  @Put("profile")
  public put(
    @CurrentSession() session: SessionPrincipal,
    @Body(new ZodValidationPipe(ProfileInputSchema)) profile: ProfileInput,
  ): PresentProfile {
    return this.accounts.putProfile(session.userId, profile, this.clock.nowMs());
  }

  @Get("export")
  @Header("Cache-Control", "no-store")
  @UseGuards(AccountExportRateLimitGuard)
  public export(@CurrentSession() session: SessionPrincipal): AccountExport {
    return this.data.exportData(session.userId, this.clock.nowMs());
  }

  @Delete()
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @UseGuards(ClientOriginGuard)
  public delete(
    @CurrentSession() session: SessionPrincipal,
    @Body(new ZodValidationPipe(AccountDeletionRequestSchema)) body: AccountDeletionRequest,
  ): Promise<AccountDeletionResponse> {
    return this.data.deleteAccountAfterRevocation(
      session.userId,
      body.confirmation,
      this.clock.nowMs(),
    );
  }
}
