import { Module } from "@nestjs/common";
import type { DynamicModule } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import { SERVER_CONFIG } from "../config.module.js";
import type { ServerConfig } from "../config.module.js";
import { SESSION_IP_THROTTLER, ipTracker } from "../auth/rate-limits.js";
import { STRAVA_TABLES } from "./strava.schema.js";
import type { StravaTables } from "./strava.schema.js";
import { StravaController } from "./strava.controller.js";
import { STRAVA_PROVIDERS } from "./strava.providers.js";
import { StravaWebhookController } from "./strava.webhook.js";

@Module({})
// oxlint-disable-next-line typescript/no-extraneous-class -- Nest dynamic module owns the registration factory.
export class StravaModule {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle metadata is passed unchanged through DI.
  public static register(tables: StravaTables, ridesModule: DynamicModule): DynamicModule {
    return {
      module: StravaModule,
      imports: [
        ridesModule,
        ThrottlerModule.forRootAsync({
          inject: [SERVER_CONFIG],
          useFactory: (config: ServerConfig) => ({
            throttlers: [
              {
                name: SESSION_IP_THROTTLER,
                limit: config.throttling.sessionIpPerMin,
                ttl: 60_000,
                getTracker: ipTracker,
              },
            ],
          }),
        }),
      ],
      controllers: [StravaController, StravaWebhookController],
      providers: [...STRAVA_PROVIDERS, { provide: STRAVA_TABLES, useValue: tables }],
    };
  }
}
