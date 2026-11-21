import { expect, it } from "vitest";
import { consent, required, accepted, gate } from "./strava.delivery-fixture.spec.js";
import { schedulerFixture } from "./strava.scheduler-fixture.spec.js";
import { encryptTokens } from "./strava.crypto.js";
import type { RefreshResult } from "./strava.upload-provider.js";

function refreshed(result: RefreshResult) {
  if (result.kind !== "refreshed") throw new Error("missing rotation response");

  return result;
}

async function gatedRotation() {
  const state = await schedulerFixture();
  const { a, b, peer, grant, config, scheduler, provider } = state;
  a.db.$client
    .prepare("UPDATE strava_connections SET encrypted_tokens = ? WHERE user_id = 'owner'")
    .run(encryptTokens(grant.tokens, config.strava.tokenKey, "owner", "42"));
  accepted(a, "owner", consent, 1000);
  const pollEntered = gate();
  const pollResume = gate();
  const refreshEntered = gate();
  const refreshResume = gate();
  peer.resources.processing = "authorization";
  peer.resources.pollGate = { enter: pollEntered.release, wait: pollResume.wait };
  peer.resources.refreshGate = { enter: refreshEntered.release, wait: refreshResume.wait };
  const pendingPoll = scheduler.tick();
  await pollEntered.wait;
  const rotating = required(b.credentials.claimWork("owner", "refresh", 31000));
  const signal = AbortSignal.timeout(2000);
  const pendingRefresh = provider.refresh(grant.tokens.refreshToken, Date.now(), signal);
  await refreshEntered.wait;

  return { ...state, rotating, pendingPoll, pendingRefresh, pollResume, refreshResume };
}

it("keeps actual scheduler poll401 from unlocking another SQLite owner's in-flight rotation", async () => {
  const {
    a,
    b,
    reopen,
    config,
    scheduler,
    rotating,
    pendingPoll,
    pendingRefresh,
    pollResume,
    refreshResume,
  } = await gatedRotation();

  try {
    pollResume.release();
    await pendingPoll;
    b.credentials.recover(42000);
    expect(b.credentials.connection("owner")?.credentialState).toBe("uncertain");
    b.jobs.stop("owner", "disconnect", 42000);
    expect(b.credentials.blockAndClaimRevocation("owner", 42000)).toBeUndefined();
    refreshResume.release();
    const result = refreshed(await pendingRefresh);
    const encryptedTokens = encryptTokens(result.tokens, config.strava.tokenKey, "owner", "42");
    b.credentials.finishRefresh(rotating, {
      kind: "refreshed",
      encryptedTokens,
      accessExpiresAt: result.accessExpiresAt,
    });
    expect(reopen().credentials.connection("owner")).toMatchObject({
      status: "revocation_pending",
      credentialState: "available",
      tokenRevision: 1,
      encryptedTokens,
    });
    expect(a.jobs.own("owner", consent.rideId)).toMatchObject({
      authority: { kind: "stopped", reason: "disconnect" },
      progress: { kind: "processing", receipt: { uploadId: "12345678901234567890" } },
    });
    expect(a.credentials.claimWork("owner", "poll", 42001)).toBeUndefined();
  } finally {
    pollResume.release();
    refreshResume.release();
    await pendingPoll;
    await pendingRefresh;
    await scheduler.onModuleDestroy();
  }
});

it("keeps current consent after a stale scheduler poll401 arrives after a valid token refresh", async () => {
  const state = await gatedRotation();

  const {
    a,
    b,
    reopen,
    config,
    scheduler,
    rotating,
    pendingPoll,
    pendingRefresh,
    pollResume,
    refreshResume,
  } = state;

  const before = required(a.jobs.own("owner", consent.rideId));

  try {
    refreshResume.release();
    const result = refreshed(await pendingRefresh);
    b.credentials.finishRefresh(rotating, {
      kind: "refreshed",
      encryptedTokens: encryptTokens(result.tokens, config.strava.tokenKey, "owner", "42"),
      accessExpiresAt: result.accessExpiresAt,
    });
    pollResume.release();
    await pendingPoll;
    expect(reopen().credentials.connection("owner")).toMatchObject({
      status: "connected",
      credentialState: "available",
      tokenRevision: 1,
      generation: consent.connectionGeneration,
    });
    expect(a.jobs.own("owner", consent.rideId)?.authority).toEqual(before.authority);
    expect(a.jobs.own("owner", consent.rideId)?.progress).toMatchObject({
      kind: "processing",
      receipt: { uploadId: "12345678901234567890" },
    });
  } finally {
    pollResume.release();
    refreshResume.release();
    await pendingPoll;
    await pendingRefresh;
    await scheduler.onModuleDestroy();
  }
});
