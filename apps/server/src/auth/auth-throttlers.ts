import type { ThrottlerOptions } from "@nestjs/throttler";
import type { ServerConfig } from "../config.module.js";
import {
  MAGIC_LINK_EMAIL_THROTTLER,
  MAGIC_LINK_IP_THROTTLER,
  SESSION_IP_THROTTLER,
  ipTracker,
  magicLinkEmailTracker,
} from "./rate-limits.js";

const HOUR_MS = 60 * 60_000;
const MINUTE_MS = 60_000;

export function authThrottlers(config: Readonly<ServerConfig>): ThrottlerOptions[] {
  const throttling = config.throttling;

  return [
    {
      name: MAGIC_LINK_EMAIL_THROTTLER,
      limit: throttling.magicLinkEmailPerHour,
      ttl: HOUR_MS,
      getTracker: magicLinkEmailTracker,
    },
    {
      name: MAGIC_LINK_IP_THROTTLER,
      limit: throttling.magicLinkIpPerHour,
      ttl: HOUR_MS,
      getTracker: ipTracker,
    },
    {
      name: SESSION_IP_THROTTLER,
      limit: throttling.sessionIpPerMin,
      ttl: MINUTE_MS,
      getTracker: ipTracker,
    },
  ];
}
