import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";

import { RideUploadSchema, RideIdSchema, RideListQuerySchema } from "@voltonaut/shared";
import type {
  RideUpload,
  RideDetail,
  RideList,
  RideListQuery,
  RideReceipt,
} from "@voltonaut/shared";
import { CurrentSession } from "../auth/auth-request.js";
import type { SessionPrincipal } from "../auth/auth-request.js";
import { CLOCK } from "../clock.js";
import type { Clock } from "../clock.js";
import { ZodValidationPipe } from "../pipes/zod-validation.pipe.js";
import { RideUploadRateLimitGuard } from "./rides.rate-limit.js";
import { RideUploadMediaTypeGuard } from "./rides.media-type.guard.js";
import { RidesService } from "./rides.service.js";

@Controller("v2/rides")
export class RidesController {
  public constructor(
    @Inject(RidesService) private readonly rides: Readonly<
      Pick<RidesService, "store" | "detail" | "list">
    >,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Post()
  @HttpCode(200)
  @UseGuards(RideUploadRateLimitGuard, RideUploadMediaTypeGuard)
  public upload(
    @CurrentSession() session: SessionPrincipal,
    @Body(new ZodValidationPipe(RideUploadSchema)) recording: RideUpload,
  ): RideReceipt {
    return this.rides.store(session.userId, recording, this.clock.nowMs());
  }

  @Get()
  public list(
    @CurrentSession() session: SessionPrincipal,
    @Query(new ZodValidationPipe(RideListQuerySchema)) query: RideListQuery,
  ): RideList {
    return this.rides.list(session.userId, query);
  }

  @Get(":rideId")
  public detail(
    @CurrentSession() session: SessionPrincipal,
    @Param("rideId", new ZodValidationPipe(RideIdSchema)) rideId: string,
  ): RideDetail {
    return this.rides.detail(session.userId, rideId);
  }
}
