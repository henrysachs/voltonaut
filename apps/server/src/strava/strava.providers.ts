import { SERVER_CONFIG } from "../config.module.js";
import type { ServerConfig } from "../config.module.js";
import { StravaService } from "./strava.service.js";
import { StravaStore } from "./strava.store.js";
import { StravaProvider } from "./strava.provider.js";
import { StravaOriginGuard } from "./strava.browser.js";
import { StravaDeliveryStore } from "./strava.delivery-store.js";
import { StravaDeliveryService } from "./strava.delivery.js";
import { STRAVA_SCHEDULER_PROVIDERS } from "./strava.scheduler.js";
import { StravaRateStore } from "./strava.rate-store.js";
import { STRAVA_AUTHORIZATION_PROVIDERS } from "./strava.authorization.js";

export const STRAVA_PROVIDERS = [
  StravaService,
  StravaStore,
  ...STRAVA_AUTHORIZATION_PROVIDERS,
  StravaDeliveryStore,
  StravaDeliveryService,
  ...STRAVA_SCHEDULER_PROVIDERS,
  StravaRateStore,
  StravaOriginGuard,
  {
    provide: StravaProvider,
    inject: [SERVER_CONFIG],
    useFactory: (config: ServerConfig) => new StravaProvider(config.strava),
  },
];
