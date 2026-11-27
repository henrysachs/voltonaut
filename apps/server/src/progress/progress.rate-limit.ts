import type { DynamicModule } from "@nestjs/common";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";

import { ApiError } from "../api-error.js";
import type { ExecutionContextPort, ThrottleDetailPort } from "../api-error.js";
import type { TrackerRequest } from "../auth/auth-request.js";

const PROGRESS_CHECKPOINT_THROTTLER = "progress-checkpoint-account";
const PROGRESS_CHECKPOINT_LIMIT = 30;
const PROGRESS_CHECKPOINT_TTL_MS = 60_000;

function progressCheckpointTracker(request: TrackerRequest): string {
  if (request.session === undefined) {
    throw new ApiError(401, "unauthorized", "missing session");
  }

  return request.session.userId;
}

export function progressCheckpointThrottlerModule(): DynamicModule {
  return ThrottlerModule.forRoot([
    {
      name: PROGRESS_CHECKPOINT_THROTTLER,
      limit: PROGRESS_CHECKPOINT_LIMIT,
      ttl: PROGRESS_CHECKPOINT_TTL_MS,
      getTracker: progressCheckpointTracker,
    },
  ]);
}

export class ProgressCheckpointRateLimitGuard extends ThrottlerGuard {
  protected override throwThrottlingException(
    _context: ExecutionContextPort,
    detail: ThrottleDetailPort,
  ): never {
    const remainingS = detail.isBlocked ? detail.timeToBlockExpire : detail.timeToExpire;

    throw new ApiError(429, "rate_limited", "too many progress checkpoint requests", {
      retryAfterS: Math.max(1, Math.ceil(remainingS)),
    });
  }
}
