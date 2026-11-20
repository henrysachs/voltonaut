import { Inject, Injectable } from "@nestjs/common";

import type { HealthResponse } from "@voltonaut/shared";

import { ApiError } from "../api-error.js";
import { DRIZZLE } from "../database/drizzle.provider.js";
import type { ServerDatabase } from "../database/drizzle.provider.js";
import { SERVER_VERSION } from "../version.js";

@Injectable()
export class HealthService {
  public constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- drizzle's ServerDatabase is a deep-mutable ORM handle; no readonly view exists.
    @Inject(DRIZZLE) private readonly db: ServerDatabase,
  ) {}

  /** 200 with the database probe; 503 error envelope when the probe fails. */
  public getHealth(): HealthResponse {
    try {
      const probe = this.db.$client.prepare("SELECT 1 AS ok").get();

      if (probe === undefined) {
        throw new Error("database probe returned nothing");
      }
    } catch {
      throw new ApiError(503, "internal_error", "database unavailable");
    }

    return {
      status: "ok",
      version: SERVER_VERSION,
      uptimeS: process.uptime(),
    };
  }
}
