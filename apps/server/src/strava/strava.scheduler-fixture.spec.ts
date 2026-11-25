import { fixture } from "./strava.delivery-fixture.spec.js";
import { providerFixture } from "./strava.provider-fixture.spec.js";
import { StravaScheduler } from "./strava.scheduler.js";
import { StravaService } from "./strava.service.js";
import { StravaStore } from "./strava.store.js";
import { StravaDeliveryService } from "./strava.delivery.js";
import { RidesService } from "../rides/rides.service.js";
import { stravaTables, ridesTables } from "../schema.js";
import { authorizationFixture, PolicyProvider } from "./strava.authorization-fixture.spec.js";

export async function schedulerFixture(authorizationTransport: "http" | "in_process" = "http") {
  const owners = fixture();
  const remote = await providerFixture();

  const policy = new PolicyProvider(remote.provider, remote.grant.tokens, remote.peer.control);
  const provider = authorizationTransport === "in_process" ? policy : remote.provider;

  const config = {
    ...owners.a.config,
    strava: remote.provider.enabledConfig(),
  };

  const time = { nowMs: 20000 };
  const clock = { nowMs: () => time.nowMs };
  const checks = authorizationFixture(owners.a, provider, clock);
  const connections = new StravaStore(owners.a.db, stravaTables);

  const service = new StravaService(
    connections,
    config,
    clock,
    provider,
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
    provider,
    checks.rates,
    service,
    clock,
    checks.authorization,
  );

  return { ...owners, ...remote, ...checks, provider, time, config, scheduler, policy };
}
