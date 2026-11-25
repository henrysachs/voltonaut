import { expect, it } from "vitest";
import { consent, fixture, required } from "./strava.delivery-fixture.spec.js";

it("gives only the current preparing owner permanent dispatch rights across SQLite owners", () => {
  const { a, b } = fixture();
  a.jobs.enqueue("owner", consent, 1000);
  b.jobs.enqueue("owner", consent, 1000);
  const old = required(a.jobs.prepare(1000));
  expect(b.jobs.prepare(1000)).toBeUndefined();
  const replacement = required(b.jobs.prepare(20000));
  const work = required(b.credentials.claimWork("owner", "submit", 20000));
  expect(a.jobs.dispatch(old, work, consent, 20000)).toBeUndefined();
  expect(b.jobs.dispatch(replacement, work, consent, 20000)?.delivery.progress.kind).toBe(
    "submitting",
  );
  b.credentials.releaseWork(work);
  a.jobs.recover(40000);
  expect(a.jobs.own("owner", consent.rideId)?.progress.kind).toBe("submission_unknown");
  expect(a.jobs.prepare(40000)).toBeUndefined();
  expect(b.jobs.enqueue("owner", consent, 40000).progress.kind).toBe("submission_unknown");
});

it("keeps known upload IDs and stopped authority independently across disconnect", () => {
  const { a } = fixture();
  a.jobs.enqueue("owner", consent, 1000);
  const claim = required(a.jobs.prepare(1000));
  const work = required(a.credentials.claimWork("owner", "submit", 1000));
  const dispatched = required(a.jobs.dispatch(claim, work, consent, 1000));
  a.jobs.submitted(
    dispatched,
    {
      kind: "known",
      receipt: { uploadId: "12345678901234567890", externalId: `voltonaut-${consent.rideId}.tcx` },
      state: { kind: "processing" },
    },
    1100,
  );
  a.credentials.releaseWork(work);
  a.jobs.stop("owner", "disconnect", 1200);
  expect(a.jobs.own("owner", consent.rideId)).toMatchObject({
    authority: { kind: "stopped" },
    progress: { kind: "processing", receipt: { uploadId: "12345678901234567890" } },
  });
});

it("never reclaims uncertain refresh, including revoke after an expired rotating request", () => {
  const { a, b } = fixture();
  expect(a.credentials.claimWork("owner", "refresh", 1000)).toBeDefined();
  expect(b.credentials.claimWork("owner", "revoke", 2000)).toBeUndefined();
  expect(b.credentials.claimWork("owner", "refresh", 20000)).toBeUndefined();
  expect(b.credentials.claimWork("owner", "revoke", 20000)).toBeUndefined();
  expect(b.credentials.connection("owner")?.credentialState).toBe("uncertain");
});

it("rejects incomplete delivery variants in SQLite instead of inventing missing receipts", () => {
  const { a } = fixture();
  a.jobs.enqueue("owner", consent, 1000);
  expect(() =>
    a.db.$client.prepare("UPDATE strava_deliveries SET progress = ?").run('{"kind":"delivered"}'),
  ).toThrow("CHECK");
  expect(a.jobs.own("owner", consent.rideId)?.progress.kind).toBe("queued");
});

it("rejects obsolete token work while refresh preserves the consent target", () => {
  const { a, b } = fixture();
  a.jobs.enqueue("owner", consent, 1000);
  const preparing = required(a.jobs.prepare(1000));
  const old = required(a.credentials.claimWork("owner", "submit", 1000));
  a.credentials.releaseWork(old);
  const refresh = required(b.credentials.claimWork("owner", "refresh", 1100));
  b.credentials.finishRefresh(refresh, {
    kind: "refreshed",
    encryptedTokens: "new-encrypted",
    accessExpiresAt: 999999,
  });
  const latest = required(b.credentials.claimWork("owner", "submit", 1200));
  expect(latest.generation).toBe(consent.connectionGeneration);
  expect(latest.tokenRevision).toBe(1);
  expect(a.jobs.dispatch(preparing, old, consent, 1200)).toBeUndefined();
  expect(b.jobs.dispatch(preparing, latest, consent, 1200)?.delivery.progress.kind).toBe(
    "submitting",
  );
});

it("keeps disconnect authoritative when a late refresh supplies the newest revoke credential", () => {
  const { a, b } = fixture();
  const refresh = required(a.credentials.claimWork("owner", "refresh", 1000));
  expect(b.credentials.blockAndClaimRevocation("owner", 1100)).toBeUndefined();
  a.credentials.finishRefresh(refresh, {
    kind: "refreshed",
    encryptedTokens: "latest-encrypted",
    accessExpiresAt: 999999,
  });
  expect(a.credentials.connection("owner")).toMatchObject({
    status: "revocation_pending",
    credentialState: "available",
    tokenRevision: 1,
  });
  expect(a.credentials.claimWork("owner", "submit", 1200)).toBeUndefined();
  expect(b.credentials.claimWork("owner", "revoke", 1200)).toMatchObject({
    encryptedTokens: "latest-encrypted",
    tokenRevision: 1,
  });
});

it("allows only the same dispatched attempt's late evidence to refine uncertainty without restoring authority", () => {
  const { a, b } = fixture();
  a.jobs.enqueue("owner", consent, 1000);
  const preparing = required(a.jobs.prepare(1000));
  const work = required(a.credentials.claimWork("owner", "submit", 1000));
  const dispatched = required(a.jobs.dispatch(preparing, work, consent, 1000));
  b.jobs.recover(20000);
  b.jobs.stop("owner", "disconnect", 20000);
  a.jobs.submitted(
    dispatched,
    {
      kind: "known",
      receipt: { uploadId: "12345678901234567890", externalId: `voltonaut-${consent.rideId}.tcx` },
      state: { kind: "delivered", activityId: "321" },
    },
    21000,
  );
  expect(b.jobs.own("owner", consent.rideId)).toMatchObject({
    authority: { kind: "stopped" },
    progress: { kind: "delivered", activityId: "321" },
  });
  expect(b.jobs.prepare(22000)).toBeUndefined();
});
