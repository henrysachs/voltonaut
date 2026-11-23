import { expect, it } from "vitest";
import { PolicyProvider } from "./strava.authorization-fixture.spec.js";
import { providerFixture } from "./strava.provider-fixture.spec.js";
import type { RefreshResult } from "./strava.upload-provider.js";

function refreshed(result: RefreshResult) {
  if (result.kind !== "refreshed") throw new Error("local provider did not rotate tokens");

  return result;
}

it("keeps policy proofs equivalent to HTTP proofs after real token rotation", async () => {
  const { provider, peer, grant } = await providerFixture();
  const policy = new PolicyProvider(provider, grant.tokens, peer.control);

  const input = {
    accessToken: grant.tokens.accessToken,
    athleteId: grant.athleteId,
    signal: AbortSignal.timeout(2000),
    onHeaders: () => {},
  };

  expect(await policy.verifyAuthorization(input)).toEqual({ kind: "valid" });
  const rotated = refreshed(await policy.refresh(grant.tokens.refreshToken, 20000, input.signal));
  expect(rotated.kind).toBe("refreshed");
  expect(rotated.tokens.accessToken === grant.tokens.accessToken).toBe(false);

  for (const proof of [
    { accessToken: rotated.tokens.accessToken, athleteId: grant.athleteId, kind: "valid" },
    { accessToken: grant.tokens.accessToken, athleteId: grant.athleteId, kind: "valid" },
    {
      accessToken: "invalid-access-token",
      athleteId: grant.athleteId,
      kind: "deferred",
      unauthorized: true,
    },
    {
      accessToken: rotated.tokens.accessToken,
      athleteId: "43",
      kind: "deferred",
      unauthorized: false,
    },
  ]) {
    const { accessToken, athleteId, ...expected } = proof;
    const request = { ...input, accessToken, athleteId };
    // oxlint-disable-next-line no-await-in-loop -- Compare both transports for every token and athlete case.
    expect(await provider.verifyAuthorization(request)).toEqual(expected);
    // oxlint-disable-next-line no-await-in-loop -- Compare both transports for every token and athlete case.
    expect(await policy.verifyAuthorization(request)).toEqual(expected);
  }

  expect(peer.resources.refreshCalls).toBe(1);
  expect(peer.resources.athleteCalls).toBe(5);
});

it.each([401, 200])(
  "does not learn a token from a failed HTTP refresh with status %s",
  async (status) => {
    const { provider, peer, grant } = await providerFixture();
    const policy = new PolicyProvider(provider, grant.tokens, peer.control);

    const input = {
      accessToken: grant.tokens.accessToken,
      athleteId: grant.athleteId,
      signal: AbortSignal.timeout(2000),
      onHeaders: () => {},
    };

    expect(await policy.verifyAuthorization(input)).toEqual({ kind: "valid" });
    peer.resources.refreshResponse = {
      status,
      body: JSON.stringify({
        token_type: "Bearer",
        access_token: "unissued-access-token",
        refresh_token: "unissued-refresh-token",
        expires_at: 1,
      }),
    };
    expect(await policy.refresh(grant.tokens.refreshToken, 20000, input.signal)).toEqual({
      kind: "unknown",
    });
    const unissued = { ...input, accessToken: "unissued-access-token" };
    expect(await provider.verifyAuthorization(unissued)).toEqual({
      kind: "deferred",
      unauthorized: true,
    });
    expect(await policy.verifyAuthorization(unissued)).toEqual({
      kind: "deferred",
      unauthorized: true,
    });
    expect(await provider.verifyAuthorization(input)).toEqual({ kind: "valid" });
    expect(await policy.verifyAuthorization(input)).toEqual({ kind: "valid" });
    expect(peer.resources.refreshCalls).toBe(1);
    expect(peer.resources.athleteCalls).toBe(3);
  },
);
