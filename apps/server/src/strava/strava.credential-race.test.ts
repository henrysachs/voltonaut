import { expect, it } from "vitest";
import { fixture, required, gate } from "./strava.delivery-fixture.spec.js";
import { providerFixture } from "./strava.provider-fixture.spec.js";
import type { StravaCredentialStore } from "./strava.credential-store.js";

function replaceWork(credentials: Readonly<StravaCredentialStore>, state: string): void {
  if (state === "replacement") {
    required(credentials.claimWork("owner", "submit", 12000));

    return;
  }

  const refresh = required(credentials.claimWork("owner", "refresh", 12000));

  if (state === "uncertain") credentials.recover(24000);

  if (state === "refreshed")
    credentials.finishRefresh(refresh, {
      kind: "refreshed",
      encryptedTokens: "latest-token",
      accessExpiresAt: 999999,
    });
}

it("keeps uncertain rotation blocked after stale poll401 and retains late credentials for revocation", async () => {
  const { a, b, reopen } = fixture();
  const { peer, provider, grant } = await providerFixture();
  const oldPoll = required(a.credentials.claimWork("owner", "poll", 1000));
  const rotating = required(b.credentials.claimWork("owner", "refresh", 12000));
  const entered = gate();
  const resume = gate();
  peer.resources.refreshGate = { enter: entered.release, wait: resume.wait };

  const signal = AbortSignal.timeout(2000);
  const pending = provider.refresh(grant.tokens.refreshToken, Date.now(), signal);

  try {
    await entered.wait;

    const latePoll = await provider.poll({
      accessToken: "obsolete-access-token",
      receipt: {
        uploadId: "12345678901234567890",
        externalId: "voltonaut-00000000-0000-4000-8000-000000000001.tcx",
      },
      signal: AbortSignal.timeout(2000),
      onHeaders: () => {},
    });

    expect(latePoll).toEqual({ kind: "deferred", reason: "authorization" });
    a.credentials.credentialFailure(oldPoll);
    b.credentials.recover(24000);
    expect.soft(b.credentials.connection("owner")?.credentialState).toBe("uncertain");
    const revokedWithOldToken = b.credentials.blockAndClaimRevocation("owner", 24000);
    expect(revokedWithOldToken).toBeUndefined();

    resume.release();
    expect((await pending).kind).toBe("refreshed");
    b.credentials.finishRefresh(rotating, {
      kind: "refreshed",
      encryptedTokens: "newest-revoke-credential",
      accessExpiresAt: 999999,
    });
    expect(reopen().credentials.connection("owner")).toMatchObject({
      status: "revocation_pending",
      encryptedTokens: "newest-revoke-credential",
      tokenRevision: 1,
    });
    expect(a.credentials.claimWork("owner", "poll", 24001)).toBeUndefined();
  } finally {
    resume.release();
    await pending;
  }
});

it.each(["refreshing", "uncertain", "refreshed", "replacement"])(
  "ignores stale authorization failure after credential work becomes %s",
  (state) => {
    const { a, b, reopen } = fixture();
    const old = required(a.credentials.claimWork("owner", "poll", 1000));

    replaceWork(b.credentials, state);

    const before = required(b.credentials.connection("owner"));
    a.credentials.credentialFailure(old);
    expect(reopen().credentials.connection("owner")).toEqual(before);
  },
);

it("ignores an authorization failure after its owner releases the work", () => {
  const { a, b, reopen } = fixture();
  const old = required(a.credentials.claimWork("owner", "poll", 1000));
  a.credentials.releaseWork(old);
  const before = required(b.credentials.connection("owner"));
  a.credentials.credentialFailure(old);
  expect(reopen().credentials.connection("owner")).toEqual(before);
});

it.each<{ readonly kind: "poll" | "submit" }>([{ kind: "poll" }, { kind: "submit" }])(
  "blocks work after the current $kind credential is refused",
  ({ kind }) => {
    const { a, b, reopen } = fixture();

    const work = required(a.credentials.claimWork("owner", kind, 1000));

    a.credentials.credentialFailure(work);
    a.credentials.releaseWork(work);
    expect(reopen().credentials.connection("owner")?.credentialState).toBe(
      "reauthorization_required",
    );
    expect(b.credentials.claimWork("owner", "poll", 12000)).toBeUndefined();
    expect(b.credentials.claimWork("owner", "submit", 12000)).toBeUndefined();
    expect(b.credentials.claimWork("owner", "refresh", 12000)).toBeUndefined();
  },
);
