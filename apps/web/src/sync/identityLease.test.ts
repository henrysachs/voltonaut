import { expect, it } from "vitest";
import { identityLease, type IdentityRequest } from "./identityLease.js";

interface Call {
  readonly path: string;
  readonly body: string | undefined;
  readonly credentials: string;
}

function recorder() {
  const calls: Call[] = [];

  const request: IdentityRequest = (path, schema, body, credentials) => {
    calls.push({ path, body, credentials });

    const response = path.endsWith("/link")
      ? { location: "https://idp.example/authorize" }
      : { identities: [] };

    return Promise.resolve(schema.parse(response));
  };

  return { calls, lease: identityLease(request) };
}

it("uses the identity routes and sends the browser binding only for link writes", async () => {
  const { calls, lease } = recorder();
  const code = "c".repeat(43);

  await lease.list();
  await lease.startLink("authentik");
  await lease.completeLink(code);

  expect(calls).toEqual([
    { path: "/v1/auth/identities", body: undefined, credentials: "omit" },
    { path: "/v1/auth/oidc/authentik/link", body: "{}", credentials: "include" },
    { path: "/v1/auth/identities", body: JSON.stringify({ code }), credentials: "include" },
  ]);
});

it("rejects provider ids and codes outside the shared contract before any request", () => {
  const { calls, lease } = recorder();

  expect(() => lease.startLink("../admin")).toThrow("Invalid");
  expect(() => lease.completeLink("short")).toThrow("Invalid");
  expect(calls).toEqual([]);
});
