import { ThrottlerGuard } from "@nestjs/throttler";

import { ApiError } from "../api-error.js";
import type { ExecutionContextPort, ThrottleDetailPort } from "../api-error.js";
import type { TrackerRequest } from "../auth/auth-request.js";

export const PROGRESS_CHECKPOINT_THROTTLER = "progress-checkpoint-account";
export const PROGRESS_CHECKPOINT_LIMIT = 30;
export const PROGRESS_CHECKPOINT_TTL_MS = 60_000;

export function progressCheckpointTracker(request: TrackerRequest): string {
  if (request.session === undefined) {
    throw new ApiError(401, "unauthorized", "missing session");
  }

  return request.session.userId;
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
