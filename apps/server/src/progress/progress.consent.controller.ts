import { Body, Controller, Get, Header, Inject, Put, Query, UseGuards } from "@nestjs/common";

import {
  ProgressConsentUpdateSchema,
  ProgressHistoryQuerySchema,
  type ProgressConsentState,
  type ProgressConsentUpdate,
  type ProgressHistoryQuery,
  type ProgressHistoryResponse,
} from "@voltonaut/shared";
import { CurrentSession } from "../auth/auth-request.js";
import type { SessionPrincipal } from "../auth/auth-request.js";
import { ZodValidationPipe } from "../pipes/zod-validation.pipe.js";
import { ProgressConsentService } from "./progress.consent.service.js";
import { ClientOriginGuard } from "../client-origin.guard.js";
import { ProgressAccountDataService } from "./progress.account-data.js";

@Controller("v1/me")
export class ProgressConsentController {
  public constructor(
    @Inject(ProgressConsentService) private readonly progress: Readonly<
      Pick<ProgressConsentService, "state" | "update">
    >,
    @Inject(ProgressAccountDataService) private readonly history: Readonly<
      Pick<ProgressAccountDataService, "historyPage">
    >,
  ) {}

  /** Server-confirmed ride journals, newest first (spec E6-11). */
  @Get("progress-history")
  @Header("Cache-Control", "no-store")
  public historyPage(
    @CurrentSession() session: SessionPrincipal,
    @Query(new ZodValidationPipe(ProgressHistoryQuerySchema)) query: ProgressHistoryQuery,
  ): ProgressHistoryResponse {
    return this.history.historyPage(session.userId, query.before);
  }

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
