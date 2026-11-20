import { Module } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import type { ThrottlerOptions } from "@nestjs/throttler";

import type { ServerConfig } from "../config.js";
import { SERVER_CONFIG } from "../config.module.js";
import { MailModule } from "../mail/mail.module.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import {
  MAGIC_LINK_EMAIL_THROTTLER,
  MAGIC_LINK_IP_THROTTLER,
  SESSION_IP_THROTTLER,
  ipTracker,
  magicLinkEmailTracker,
} from "./rate-limits.js";

const HOUR_MS = 60 * 60_000;
const MINUTE_MS = 60_000;

function authThrottlers(config: ServerConfig): ThrottlerOptions[] {
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

@Module({
  imports: [
    MailModule,
    ThrottlerModule.forRootAsync({
      inject: [SERVER_CONFIG],
      useFactory: (config: ServerConfig) => ({ throttlers: authThrottlers(config) }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
// oxlint-disable-next-line typescript/no-extraneous-class -- Nest modules are empty decorated classes; the framework reads the decorator, not class members.
export class AuthModule {}
