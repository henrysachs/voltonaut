import { expect, it } from "vitest";
import { consent, required, accepted, gate } from "./strava.delivery-fixture.spec.js";
import { schedulerFixture } from "./strava.scheduler-fixture.spec.js";
import { encryptTokens } from "./strava.crypto.js";
import { stravaTables } from "../schema.js";
import type { StravaCredentialStore } from "./strava.credential-store.js";
import type { OwnedDelivery } from "./strava.delivery-state.js";
import type { PollResult } from "./strava.upload-provider.js";

function block(credentials: Readonly<StravaCredentialStore>, state: string): void {
  if (state === "uncertain") {
    required(credentials.claimWork("owner", "refresh", 1100));

    return;
  }

  const work = required(credentials.claimWork("owner", "poll", 19000));

  if (state === "reauthorization_required") {
    credentials.credentialFailure(work);
    credentials.releaseWork(work);
  }
}

function processing(job: OwnedDelivery) {
  if (job.progress.kind !== "processing") throw new Error("missing accepted upload");

  return job.progress;
}

function observed(result: PollResult) {
  if (result.kind !== "observed") throw new Error("missing provider evidence");

  return result.state;
}

async function pairedJobs() {
  const state = await schedulerFixture();
  const { a, grant, config } = state;
  a.db.$client
    .prepare("INSERT INTO users VALUES ('healthy', 'healthy@example.test', 0, NULL)")
    .run();
  a.db
    .insert(stravaTables.connections)
    .values({
      userId: "healthy",
      athleteId: "43",
      status: "connected",
      encryptedTokens: encryptTokens(grant.tokens, config.strava.tokenKey, "healthy", "43"),
      accessExpiresAt: 999999,
      scope: "activity:write",
      generation: "generation-b",
    })
    .run();

  const healthyConsent = {
    ...consent,
    rideId: "00000000-0000-4000-8000-000000000002",
    athleteId: "43",
    connectionGeneration: "generation-b",
  };

  const blocked = accepted(a, "owner", consent, 1000);
  accepted(a, "healthy", healthyConsent, 1001);

  return { ...state, healthyConsent, blocked };
}

it.each<{ readonly state: string; readonly credentialState: string }>([
  { state: "uncertain", credentialState: "uncertain" },
  { state: "busy", credentialState: "available" },
  { state: "reauthorization_required", credentialState: "reauthorization_required" },
])(
  "delivers a healthy accepted upload while the oldest account is $state without losing its receipt",
  async ({ state, credentialState }) => {
    const { a, b, reopen, peer, scheduler, healthyConsent, blocked } = await pairedJobs();
    block(b.credentials, state);
    peer.resources.processing = "delivered";

    try {
      await scheduler.tick();
      await scheduler.tick();
      await scheduler.tick();
      expect(peer.resources.pollCalls).toBe(1);
      expect(a.credentials.connection("owner")?.credentialState).toBe(credentialState);
      expect(reopen().jobs.own("healthy", healthyConsent.rideId)?.progress.kind).toBe("delivered");
      const deferred = required(a.jobs.own("owner", consent.rideId));
      expect(deferred.authority).toEqual(blocked.authority);
      expect(deferred.progress).toEqual({ ...blocked.progress, nextPollAtMs: 35000 });
      expect(a.jobs.nextPoll(34999)).toBeUndefined();
      expect(a.jobs.nextPoll(35000)?.deliveryId).toBe(blocked.deliveryId);
      expect(peer.resources.submitCalls).toBe(0);
    } finally {
      await scheduler.onModuleDestroy();
    }
  },
);

it("stops current authorization failures while retaining the accepted receipt", async () => {
  const { a, reopen, peer, grant, config, scheduler } = await schedulerFixture();
  a.db.$client
    .prepare("UPDATE strava_connections SET encrypted_tokens = ? WHERE user_id = 'owner'")
    .run(
      encryptTokens(
        { ...grant.tokens, accessToken: "obsolete-access-token" },
        config.strava.tokenKey,
        "owner",
        "42",
      ),
    );
  const job = accepted(a, "owner", consent, 1000);

  try {
    await scheduler.tick();
    await scheduler.tick();
    expect(peer.resources.pollCalls).toBe(0);
    expect(reopen().credentials.connection("owner")?.credentialState).toBe(
      "reauthorization_required",
    );
    const stopped = required(a.jobs.own("owner", consent.rideId));
    expect(stopped).toMatchObject({
      authority: { kind: "stopped", reason: "credentials" },
      progress: { kind: "processing", issue: "authorization" },
    });
    expect(processing(stopped).receipt).toEqual(processing(job).receipt);
  } finally {
    await scheduler.onModuleDestroy();
  }
});

it("preserves late poll success and stopped authority when deferral races another owner", async () => {
  const { a, b, reopen, peer, grant, provider, scheduler } = await schedulerFixture();
  const job = accepted(a, "owner", consent, 1000);
  const entered = gate();
  const resume = gate();
  peer.resources.processing = "delivered";
  peer.resources.pollGate = { enter: entered.release, wait: resume.wait };

  const pending = provider.poll({
    accessToken: grant.tokens.accessToken,
    receipt: processing(job).receipt,
    signal: AbortSignal.timeout(2000),
    onHeaders: () => {},
  });

  try {
    await entered.wait;
    b.jobs.deferPoll(job, 35000);
    b.jobs.stop("owner", "disconnect", 20000);
    resume.release();
    a.jobs.pollResult(job, observed(await pending), 20000);
    b.jobs.deferPoll(job, 36000);
    expect(reopen().jobs.own("owner", consent.rideId)).toMatchObject({
      authority: { kind: "stopped", reason: "disconnect" },
      progress: { kind: "delivered", receipt: processing(job).receipt },
    });
  } finally {
    resume.release();
    await pending;
    await scheduler.onModuleDestroy();
  }
});

it("does not replace newer poll progress or stopped authority with a stale deferral", async () => {
  const { a, b, peer, grant, provider, scheduler } = await schedulerFixture();
  const job = accepted(a, "owner", consent, 1000);
  peer.resources.processing = "delivered";

  try {
    const result = await provider.poll({
      accessToken: grant.tokens.accessToken,
      receipt: processing(job).receipt,
      signal: AbortSignal.timeout(2000),
      onHeaders: () => {},
    });

    a.jobs.pollResult(job, observed(result), 20000);
    const delivered = a.jobs.own("owner", consent.rideId);
    b.jobs.deferPoll(job, 36000);
    expect(a.jobs.own("owner", consent.rideId)).toEqual(delivered);
    b.jobs.stop("owner", "disconnect", 20000);
    const stopped = a.jobs.own("owner", consent.rideId);
    b.jobs.deferPoll(job, 37000);
    expect(a.jobs.own("owner", consent.rideId)).toEqual(stopped);
  } finally {
    await scheduler.onModuleDestroy();
  }
});

it("bounds Nest shutdown during a gated poll and does no more work after shutdown", async () => {
  const { a, peer, grant, config, scheduler } = await schedulerFixture();
  a.db.$client
    .prepare("UPDATE strava_connections SET encrypted_tokens = ? WHERE user_id = 'owner'")
    .run(encryptTokens(grant.tokens, config.strava.tokenKey, "owner", "42"));
  const job = accepted(a, "owner", consent, 1000);
  const entered = gate();
  const resume = gate();
  peer.resources.pollGate = { enter: entered.release, wait: resume.wait };

  try {
    scheduler.onModuleInit();
    await entered.wait;
    await scheduler.onModuleDestroy();
    await scheduler.tick();
    expect(peer.resources.pollCalls).toBe(1);
    expect(a.jobs.own("owner", consent.rideId)).toMatchObject({
      authority: { kind: "consented" },
      progress: { kind: "processing", receipt: processing(job).receipt },
    });
  } finally {
    resume.release();
    await scheduler.onModuleDestroy();
  }
}, 2500);
