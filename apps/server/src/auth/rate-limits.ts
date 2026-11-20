import { ApiError } from "../api-error.js";
import type { ExecutionContextPort, ThrottleDetailPort } from "../api-error.js";
import { ThrottlerGuard } from "@nestjs/throttler";
import { z } from "zod";

import { MagicLinkRequestSchema } from "@voltonaut/shared";
import type { TrackerRequest } from "./auth-request.js";

/**
 * Auth rate limits (spec AK9): magic-link 5/h per email AND 10/h per IP,
 * session 10/min per IP. In-memory storage; one process is enough (ADR-004).
 * The named throttlers and their values come from the server config; routes
 * select which apply via @Throttle/@SkipThrottle.
 */
export const MAGIC_LINK_EMAIL_THROTTLER = "magic-link-email";
export const MAGIC_LINK_IP_THROTTLER = "magic-link-ip";
export const SESSION_IP_THROTTLER = "session-ip";

function isNonEmptyString(value: unknown): value is string {
  return z.string().min(1).safeParse(value).success;
}

/** Tracker per email; invalid bodies collapse into one bucket. */
export function magicLinkEmailTracker(req: TrackerRequest): string {
  const parsed = MagicLinkRequestSchema.safeParse(req.body);

  return parsed.success ? parsed.data.email : "invalid-email";
}

/** Tracker per client IP (express resolves X-Forwarded-For behind the proxy). */
export function ipTracker(req: TrackerRequest): string {
  return isNonEmptyString(req.ip) ? req.ip : "unknown-ip";
}

export class AuthRateLimitGuard extends ThrottlerGuard {
  protected override throwThrottlingException(
    _context: ExecutionContextPort,
    detail: ThrottleDetailPort,
  ): never {
    const remainingS = detail.isBlocked ? detail.timeToBlockExpire : detail.timeToExpire;

    throw new ApiError(429, "rate_limited", "too many requests", {
      retryAfterS: Math.max(1, Math.ceil(remainingS)),
    });
  }
}
