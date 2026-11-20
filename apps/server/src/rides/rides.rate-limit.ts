import { ThrottlerGuard } from "@nestjs/throttler";

import { ApiError } from "../api-error.js";
import type { ExecutionContextPort, ThrottleDetailPort } from "../api-error.js";
import type { TrackerRequest } from "../auth/auth-request.js";

export const RIDE_UPLOAD_THROTTLER = "ride-upload-account";

export function rideUploadTracker(request: TrackerRequest): string {
  if (request.session === undefined) {
    throw new ApiError(401, "unauthorized", "missing session");
  }

  return request.session.userId;
}

export class RideUploadRateLimitGuard extends ThrottlerGuard {
  protected override throwThrottlingException(
    _context: ExecutionContextPort,
    detail: ThrottleDetailPort,
  ): never {
    const remainingS = detail.isBlocked ? detail.timeToBlockExpire : detail.timeToExpire;

    throw new ApiError(429, "rate_limited", "too many uploads", {
      retryAfterS: Math.max(1, Math.ceil(remainingS)),
    });
  }
}
