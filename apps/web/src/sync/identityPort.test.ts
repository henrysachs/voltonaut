import { expect, it } from "vitest";
import type { PrivateSend } from "./apiRoute.js";
import { identityPort } from "./identityPort.js";

interface Call {
  readonly method: string;
  readonly path: string;
  readonly body: string | undefined;
  readonly credentials: string;
}

function recorder() {
  const calls: Call[] = [];

  const send: PrivateSend = (route, input) => {
    const path = route.path(input);
    const body = route.method === "GET" || route.body === null ? undefined : route.body(input);
    calls.push({ method: route.method, path, body, credentials: route.credentials });

    return Promise.resolve(
      route.response.parse(
        path.endsWith("/link") ? { location: "https://idp.example/authorize" } : { identities: [] },
      ),
    );
  };

  return { calls, port: identityPort(send) };
}

it("uses the identity routes and sends the browser binding only for link writes", async () => {
  const { calls, port } = recorder();
  const code = "c".repeat(43);

  await port.list();
  await port.startLink("authentik");
  await port.completeLink(code);

  expect(calls).toEqual([
    { method: "GET", path: "/v1/auth/identities", body: undefined, credentials: "omit" },
    { method: "POST", path: "/v1/auth/oidc/authentik/link", body: "{}", credentials: "include" },
    {
      method: "POST",
      path: "/v1/auth/identities",
      body: JSON.stringify({ code }),
      credentials: "include",
    },
  ]);
});

it("rejects provider ids and codes outside the shared contract before any request", () => {
  const { calls, port } = recorder();

  expect(() => port.startLink("../admin")).toThrow("Invalid");
  expect(() => port.completeLink("short")).toThrow("Invalid");
  expect(calls).toEqual([]);
});
