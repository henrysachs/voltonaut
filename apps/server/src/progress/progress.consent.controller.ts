import { Body, Controller, Get, Header, Inject, Put, UseGuards } from "@nestjs/common";

import {
  ProgressConsentUpdateSchema,
  type ProgressConsentState,
  type ProgressConsentUpdate,
} from "@voltonaut/shared";
import { CurrentSession } from "../auth/auth-request.js";
import type { SessionPrincipal } from "../auth/auth-request.js";
import { ZodValidationPipe } from "../pipes/zod-validation.pipe.js";
import { ProgressConsentService } from "./progress.consent.service.js";
import { ClientOriginGuard } from "../client-origin.guard.js";

@Controller("v1/me")
export class ProgressConsentController {
  public constructor(
    @Inject(ProgressConsentService) private readonly progress: Readonly<
      Pick<ProgressConsentService, "state" | "update">
    >,
  ) {}

  @Get("progress-consent")
  @Header("Cache-Control", "no-store")
  public state(@CurrentSession() session: SessionPrincipal): ProgressConsentState {
    return this.progress.state(session.userId, 1, session.sessionTokenHash);
  }

  @Put("progress-consent")
  @Header("Cache-Control", "no-store")
  @UseGuards(ClientOriginGuard)
  public update(
    @CurrentSession() session: SessionPrincipal,
    @Body(new ZodValidationPipe(ProgressConsentUpdateSchema)) update: ProgressConsentUpdate,
  ): ProgressConsentState {
    return this.progress.update(
      session.userId,
      session.sessionTokenHash,
      update.sessionGeneration,
      update.enabled,
    );
  }
}
