import { Controller, Get } from "@nestjs/common";
import type { HealthResponse } from "@voltonaut/shared";

import type { HealthService } from "./health.service.js";

@Controller("healthz")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  getHealth(): HealthResponse {
    return this.healthService.getHealth();
  }
}
