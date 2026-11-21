import { afterEach } from "vitest";
import { z } from "zod";
import { LocalStravaProvider } from "../testing/strava-provider.spec.js";
import { StravaProvider } from "./strava.provider.js";

export async function providerFixture() {
  const peer = new LocalStravaProvider("123", "synthetic-client-secret");
  await peer.listen();
  afterEach(() => peer.close());

  const provider = new StravaProvider({
    mode: "enabled",
    clientId: "123",
    clientSecret: "synthetic-client-secret",
    tokenKey: "a".repeat(64),
    redirectUri: "http://127.0.0.1:5238/v1/strava/callback",
    providerOrigin: peer.origin,
  });

  const response = await fetch(provider.authorizationUrl("s".repeat(43)), { redirect: "manual" });
  const callback = new URL(z.string().parse(response.headers.get("location")));

  const grant = await provider.exchange(
    z.string().parse(callback.searchParams.get("code")),
    Date.now(),
  );

  return { peer, provider, grant };
}
