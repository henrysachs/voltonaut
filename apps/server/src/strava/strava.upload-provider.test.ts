import { expect, it } from "vitest";
import { z } from "zod";
import { providerFixture } from "./strava.provider-fixture.spec.js";
import { fixture, required } from "./strava.delivery-fixture.spec.js";
import { uploadFixture } from "./strava.scheduler-fixture.spec.js";
import type { StravaDeliveryStore } from "./strava.delivery-store.js";
import type { StravaCredentialStore } from "./strava.credential-store.js";
import type { StravaProvider } from "./strava.provider.js";
import { encryptTokens, decryptTokens } from "./strava.crypto.js";
import type { StravaConnection } from "./strava.credential-store.js";

const shutdown = new AbortController().signal;

function saveRefresh(
  credentials: Readonly<StravaCredentialStore>,
  work: StravaConnection,
  result: Awaited<ReturnType<StravaProvider["refresh"]>>,
): void {
  credentials.finishRefresh(
    work,
    result.kind === "refreshed"
      ? {
          kind: "refreshed",
          encryptedTokens: encryptTokens(
            result.tokens,
            "a".repeat(64),
            work.userId,
            work.athleteId,
          ),
          accessExpiresAt: result.accessExpiresAt,
        }
      : result,
  );
}

function applyPoll(
  jobs: Readonly<StravaDeliveryStore>,
  job: Parameters<StravaDeliveryStore["pollResult"]>[0],
  result: Awaited<ReturnType<StravaProvider["poll"]>>,
): void {
  jobs.pollResult(job, result.kind === "observed" ? result.state : result, 2000);
}

it("sends exact stored TCX multipart and only confirms final successful provider processing", async () => {
  const { a, peer, provider, grant, step, rideId, tcx } = await uploadFixture();
  await step.submitNext(shutdown);
  const body = required(peer.resources.multipart);
  expect(
    Object.fromEntries(
      body
        .keys()
        .filter((name) => name !== "file")
        .map((name) => [name, body.get(name)])
        .toArray(),
    ),
  ).toMatchObject({
    data_type: "tcx",
    sport_type: "VirtualRide",
    trainer: "1",
    visibility: "only_me",
    external_id: `voltonaut-${rideId}.tcx`,
  });
  const file = z.instanceof(File).parse(body.get("file"));
  expect(await file.text()).toBe(tcx);
  expect(a.jobs.own("owner", rideId)?.progress.kind).toBe("processing");
  peer.resources.processing = "delivered";

  const result = await provider.poll({
    accessToken: grant.tokens.accessToken,
    receipt: { uploadId: "12345678901234567890", externalId: `voltonaut-${rideId}.tcx` },
    signal: AbortSignal.timeout(2000),
    onHeaders: () => {},
  });

  expect(result).toEqual({ kind: "observed", state: { kind: "delivered", activityId: "321" } });
  applyPoll(a.jobs, required(a.jobs.own("owner", rideId)), result);
  expect(a.jobs.own("owner", rideId)?.progress.kind).toBe("delivered");
});

it.each(["http", "unsafe", "foreign", "html_error"] satisfies (
  | "http"
  | "unsafe"
  | "foreign"
  | "html_error"
)[])("retains upload ID on poll %s and never claims false success", async (fault) => {
  const { a, peer, provider, grant, step, rideId } = await uploadFixture();
  await step.submitNext(shutdown);
  const job = required(a.jobs.own("owner", rideId));
  peer.resources.processing = fault;

  const result = await provider.poll({
    accessToken: grant.tokens.accessToken,
    receipt: { uploadId: "12345678901234567890", externalId: `voltonaut-${rideId}.tcx` },
    signal: AbortSignal.timeout(2000),
    onHeaders: () => {},
  });

  applyPoll(a.jobs, job, result);
  expect(a.jobs.own("owner", rideId)?.progress).toMatchObject({
    receipt: { uploadId: "12345678901234567890" },
  });
  expect(a.jobs.own("owner", rideId)?.progress.kind).not.toBe("delivered");
  expect(peer.resources.submitCalls).toBe(1);
});

it("parses rotating refresh without athlete or scope and keeps target generation stable", async () => {
  const { a, b, reopen } = fixture();
  const { provider, grant, peer } = await providerFixture();
  const work = required(a.credentials.claimWork("owner", "refresh", 1000));
  expect(b.credentials.claimWork("owner", "refresh", 1000)).toBeUndefined();

  const result = await provider.refresh(
    grant.tokens.refreshToken,
    Date.now(),
    AbortSignal.timeout(2000),
  );

  expect(result.kind).toBe("refreshed");
  saveRefresh(a.credentials, work, result);
  expect(peer.resources.refreshCalls).toBe(1);
  const stored = required(reopen().credentials.connection("owner"));
  expect(stored).toMatchObject({
    generation: work.generation,
    tokenRevision: 1,
    credentialState: "available",
  });
  const latest = decryptTokens(stored.encryptedTokens, "a".repeat(64), "owner", "42");
  expect(JSON.stringify(stored)).not.toContain(latest.refreshToken);
  expect(
    (await provider.refresh(latest.refreshToken, Date.now(), AbortSignal.timeout(2000))).kind,
  ).toBe("refreshed");
});

it("keeps unknown rotation blocked despite HTTP 200 revocation of the old token", async () => {
  const { a, b } = fixture();
  const { provider, grant, peer } = await providerFixture();
  const work = required(a.credentials.claimWork("owner", "refresh", 1000));
  peer.resources.refreshFault = "lost";

  const result = await provider.refresh(
    grant.tokens.refreshToken,
    Date.now(),
    AbortSignal.timeout(2000),
  );

  expect(result.kind).toBe("unknown");
  saveRefresh(a.credentials, work, result);
  expect(b.credentials.blockAndClaimRevocation("owner", 2000)).toBeUndefined();
  expect(await provider.revoke(grant.tokens.refreshToken)).toBe(true);
  expect(b.credentials.connection("owner")).toMatchObject({
    status: "revocation_pending",
    credentialState: "uncertain",
  });
  expect(b.credentials.claimWork("owner", "revoke", 40000)).toBeUndefined();
  expect(peer.resources.refreshCalls).toBe(1);
});
