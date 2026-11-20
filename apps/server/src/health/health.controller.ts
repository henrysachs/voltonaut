import type { HealthResponse } from "@voltonaut/shared";
import { Controller, Get, Inject } from "@nestjs/common";

import { HealthService } from "./health.service.js";

@Controller("healthz")
export class HealthController {
  constructor(@Inject(HealthService) private readonly healthService: Readonly<HealthService>) {}

  @Get()
  getHealth(): HealthResponse {
    return this.healthService.getHealth();
  }
}
