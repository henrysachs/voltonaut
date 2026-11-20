import { Injectable } from "@nestjs/common";
import type { HealthResponse } from "@voltonaut/shared";

import { SERVER_VERSION } from "../version.js";

@Injectable()
export class HealthService {
  getHealth(): HealthResponse {
    return {
      status: "ok",
      version: SERVER_VERSION,
      uptimeS: process.uptime(),
    };
  }
}
