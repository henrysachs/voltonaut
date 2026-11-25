import { Body, Controller, Header, HttpCode, Inject, Post, UseGuards } from "@nestjs/common";

import {
  ProgressCheckpointBatchSchema,
  type ProgressCheckpointBatch,
  type ProgressRangeResponse,
} from "@voltonaut/shared";

import { CurrentSession } from "../auth/auth-request.js";
import type { SessionPrincipal } from "../auth/auth-request.js";
import { CLOCK } from "../clock.js";
import type { Clock } from "../clock.js";
import { ZodValidationPipe } from "../pipes/zod-validation.pipe.js";
import { ProgressCheckpointRateLimitGuard } from "./progress.rate-limit.js";
import { ProgressService } from "./progress.service.js";

@Controller("v1/progress")
export class ProgressController {
  public constructor(
    @Inject(ProgressService) private readonly progress: Readonly<Pick<ProgressService, "accept">>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Post("checkpoints")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @UseGuards(ProgressCheckpointRateLimitGuard)
  public checkpoints(
    @CurrentSession() session: SessionPrincipal,
    @Body(new ZodValidationPipe(ProgressCheckpointBatchSchema)) batch: ProgressCheckpointBatch,
  ): ProgressRangeResponse {
    return { range: this.progress.accept(session, batch, this.clock.nowMs()) };
  }
}
