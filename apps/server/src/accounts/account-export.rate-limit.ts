import type { DynamicModule } from "@nestjs/common";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";

import { ApiError } from "../api-error.js";
import type { ExecutionContextPort, ThrottleDetailPort } from "../api-error.js";
import type { TrackerRequest } from "../auth/auth-request.js";

/**
 * One account export per minute and account (issue #141). The export reads every own ride at
 * once; a repeated request right after the first only loads the server again.
 */
const ACCOUNT_EXPORT_THROTTLER = "account-export";
const ACCOUNT_EXPORT_LIMIT = 1;
const ACCOUNT_EXPORT_TTL_MS = 60_000;

function accountExportTracker(request: TrackerRequest): string {
  if (request.session === undefined) throw new ApiError(401, "unauthorized", "missing session");

  return request.session.userId;
}

export function accountExportThrottlerModule(): DynamicModule {
  return ThrottlerModule.forRoot([
    {
      name: ACCOUNT_EXPORT_THROTTLER,
      limit: ACCOUNT_EXPORT_LIMIT,
      ttl: ACCOUNT_EXPORT_TTL_MS,
      getTracker: accountExportTracker,
    },
  ]);
}

export class AccountExportRateLimitGuard extends ThrottlerGuard {
  protected override throwThrottlingException(
    _context: ExecutionContextPort,
    detail: ThrottleDetailPort,
  ): never {
    const remainingS = detail.isBlocked ? detail.timeToBlockExpire : detail.timeToExpire;

    throw new ApiError(429, "rate_limited", "account export already requested", {
      retryAfterS: Math.max(1, Math.ceil(remainingS)),
    });
  }
}
