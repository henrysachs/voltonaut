import { Controller, Get, Inject } from "@nestjs/common";

import type { HealthResponse } from "@voltonaut/shared";

import { Public } from "../auth/auth-request.js";
import { HealthService } from "./health.service.js";

@Controller("healthz")
export class HealthController {
  constructor(@Inject(HealthService) private readonly healthService: Readonly<HealthService>) {}

  @Get()
  @Public()
  getHealth(): HealthResponse {
    return this.healthService.getHealth();
  }
}
