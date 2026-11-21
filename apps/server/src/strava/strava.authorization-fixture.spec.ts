import { StravaAuthorization } from "./strava.authorization.js";
import { StravaAuthorizationStore } from "./strava.authorization-store.js";
import { StravaRateStore } from "./strava.rate-store.js";
import { stravaTables } from "../schema.js";
import type { StravaCredentialStore } from "./strava.credential-store.js";
import type { StravaDeliveryStore } from "./strava.delivery-store.js";
import type { ServerDatabase } from "../database/drizzle.provider.js";
import type { StravaProvider } from "./strava.provider.js";
import type { Clock } from "../config.module.js";

export function authorizationFixture(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Each test owner uses an actual mutable SQLite connection.
  owner: {
    readonly db: ServerDatabase;
    readonly credentials: Readonly<StravaCredentialStore>;
    readonly jobs: Readonly<StravaDeliveryStore>;
  },
  provider: Readonly<StravaProvider>,
  clock: Clock,
) {
  const rates = new StravaRateStore(owner.db, stravaTables);
  const hints = new StravaAuthorizationStore(owner.db, stravaTables);

  const authorization = new StravaAuthorization(
    owner.credentials,
    owner.jobs,
    hints,
    provider,
    rates,
    clock,
  );

  return { rates, hints, authorization };
}
