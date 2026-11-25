import { fixture } from "./strava.delivery-fixture.spec.js";
import { providerFixture } from "./strava.provider-fixture.spec.js";
import { StravaScheduler } from "./strava.scheduler.js";
import { stepStack } from "./strava.step-fixture.spec.js";
import type { StepOwner } from "./strava.step-fixture.spec.js";
import { RidesService } from "../rides/rides.service.js";
import { stravaTables, ridesTables } from "../schema.js";
import { PolicyProvider } from "./strava.authorization-fixture.spec.js";
import { encryptTokens } from "./strava.crypto.js";
import { warmupReplay } from "../testing/replay.spec.js";

export async function schedulerFixture(authorizationTransport: "http" | "in_process" = "http") {
  const owners = fixture();
  const remote = await providerFixture();

  const policy = new PolicyProvider(remote.provider, remote.grant.tokens, remote.peer.control);
  const provider = authorizationTransport === "in_process" ? policy : remote.provider;

  const config = {
    ...owners.a.config,
    rideSourcePolicy: "declared_ble_v1",
    strava: remote.provider.enabledConfig(),
  } satisfies StepOwner["config"];

  const time = { nowMs: 20000 };
  const clock = { nowMs: () => time.nowMs };
  const stack = stepStack(owners.a, provider, config, clock);
  const scheduler = new StravaScheduler(stack.step, stack.service);

  return { ...owners, ...remote, ...stack, provider, time, clock, config, scheduler, policy };
}

/** A stored replayed ride with an accepted upload offer, plus a second owner's delivery step. */
export async function uploadFixture() {
  const state = await schedulerFixture();
  const { a, b, reopen, grant, config, provider, clock, deliveries, time } = state;
  a.db.$client
    .prepare("UPDATE strava_connections SET encrypted_tokens = ? WHERE user_id = 'owner'")
    .run(encryptTokens(grant.tokens, config.strava.tokenKey, "owner", "42"));
  const ride = warmupReplay();
  new RidesService(a.db, ridesTables, config).store("owner", ride, time.nowMs);
  const offer = deliveries.offer("owner", ride.rideId);
  const source = deliveries.source("owner", ride.rideId);

  if (offer.kind !== "offer" || source.kind !== "ready") throw new Error("missing upload offer");
  a.jobs.enqueue("owner", offer.consent, time.nowMs);

  return {
    ...state,
    rideId: ride.rideId,
    tcx: source.tcx,
    peerStep: stepStack(b, provider, config, clock).step,
    budget: () => reopen().db.select().from(stravaTables.rateBudget).get(),
  };
}
