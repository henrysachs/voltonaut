import { fixture } from "./strava.delivery-fixture.spec.js";
import { providerFixture } from "./strava.provider-fixture.spec.js";
import { StravaScheduler } from "./strava.scheduler.js";
import { StravaService } from "./strava.service.js";
import { StravaStore } from "./strava.store.js";
import { StravaDeliveryService } from "./strava.delivery.js";
import { StravaRateStore } from "./strava.rate-store.js";
import { RidesService } from "../rides/rides.service.js";
import { parseServerConfig } from "../config.js";
import { stravaTables, ridesTables } from "../schema.js";

export async function schedulerFixture() {
  const owners = fixture();
  const remote = await providerFixture();

  const config = {
    ...parseServerConfig({ AUTH_MODE: "disabled" }, "test"),
    strava: remote.provider.enabledConfig(),
  };

  const clock = { nowMs: () => 20000 };
  const connections = new StravaStore(owners.a.db, stravaTables);

  const service = new StravaService(
    connections,
    config,
    clock,
    remote.provider,
    owners.a.jobs,
    owners.a.credentials,
  );

  const deliveries = new StravaDeliveryService(
    new RidesService(owners.a.db, ridesTables, config),
    owners.a.jobs,
    connections,
    service,
    clock,
  );

  const scheduler = new StravaScheduler(
    deliveries,
    owners.a.jobs,
    owners.a.credentials,
    remote.provider,
    new StravaRateStore(owners.a.db, stravaTables),
    service,
    clock,
  );

  return { ...owners, ...remote, config, scheduler };
}
