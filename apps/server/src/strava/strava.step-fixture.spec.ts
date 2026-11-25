import type { fixture } from "./strava.delivery-fixture.spec.js";
import { StravaDeliveryStep } from "./strava.delivery-step.js";
import { StravaService } from "./strava.service.js";
import { StravaStore } from "./strava.store.js";
import { StravaDeliveryService } from "./strava.delivery.js";
import type { StravaProvider } from "./strava.provider.js";
import { RidesService } from "../rides/rides.service.js";
import { stravaTables, ridesTables } from "../schema.js";
import { authorizationFixture } from "./strava.authorization-fixture.spec.js";
import type { Clock } from "../config.module.js";

export type StepOwner = ReturnType<typeof fixture>["a"];

/** Wires one SQLite owner like Nest does, so two owners can race real delivery steps. */
export function stepStack(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Each test owner uses an actual mutable SQLite connection.
  owner: StepOwner,
  provider: Readonly<StravaProvider>,
  config: StepOwner["config"],
  clock: Clock,
) {
  const checks = authorizationFixture(owner, provider, clock);
  const connections = new StravaStore(owner.db, stravaTables);

  const service = new StravaService(
    connections,
    config,
    clock,
    provider,
    owner.jobs,
    owner.credentials,
  );

  const deliveries = new StravaDeliveryService(
    new RidesService(owner.db, ridesTables, config),
    owner.jobs,
    connections,
    service,
    clock,
  );

  const step = new StravaDeliveryStep(
    deliveries,
    owner.jobs,
    owner.credentials,
    checks.authorization,
    checks.hints,
    provider,
    checks.rates,
    clock,
  );

  return { ...checks, service, deliveries, step };
}
