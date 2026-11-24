import { expect, it } from "vitest";
import type {
  AuthConfigResponse,
  OidcProviderChoice,
  SessionResponse,
  User,
} from "@voltonaut/shared";

import { ApplicationSession } from "./applicationSession.js";
import type { AuthTransport } from "./authTransport.js";
import { sessionPersistence } from "./sessionPersistence.js";
import { privateAuthTransport } from "./privateAuthTransport.js";

const user: User = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "local@example.com",
  createdAt: "2026-11-20T00:00:00.000Z",
};

const session: SessionResponse = { user, sessionToken: "s".repeat(43) };

const TWO_PROVIDERS: readonly Readonly<OidcProviderChoice>[] = [
  { id: "cloudflare", displayName: "Cloudflare Access" },
  { id: "authentik", displayName: "authentik" },
];

function sessionFor(providers: readonly Readonly<OidcProviderChoice>[]) {
  const config: AuthConfigResponse = { mode: "oidc", providers: [...providers] };
  const visited: string[] = [];
  const data = new Map<string, string>();

  const transport: AuthTransport = {
    mode: () => Promise.resolve(config),
    me: () => Promise.resolve(user),
    exchange: () => Promise.resolve(session),
    logout: () => Promise.resolve(),
  };

  const client = new ApplicationSession({
    transport,
    privateTransport: privateAuthTransport("http://localhost:3000"),
    persistence: sessionPersistence("http://localhost:3000", () => ({
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        data.set(key, value);
      },
      removeItem: (key) => {
        data.delete(key);
      },
    })),
    navigate: (providerId) => {
      visited.push(providerId);
    },
  });

  return { client, visited };
}

function offeredProviders(client: Readonly<ApplicationSession>): readonly string[] {
  const view = client.view();

  return view.kind === "guest" ? (view.providers ?? []).map((provider) => provider.id) : [];
}

it("offers a provider choice for several providers without navigating", async () => {
  const { client, visited } = sessionFor(TWO_PROVIDERS);
  await client.login();
  expect(visited).toEqual([]);
  expect(offeredProviders(client)).toEqual(["cloudflare", "authentik"]);
});

it("navigates only to the explicitly chosen provider", async () => {
  const { client, visited } = sessionFor(TWO_PROVIDERS);
  await client.login("authentik");
  expect(visited).toEqual(["authentik"]);
});

it("refuses a provider the server does not list", async () => {
  const { client, visited } = sessionFor(TWO_PROVIDERS);
  await client.login("unknown");
  expect(visited).toEqual([]);
  expect(client.view().kind).toBe("guest");
});

it("navigates straight to a single configured provider", async () => {
  const { client, visited } = sessionFor([{ id: "authentik", displayName: "authentik" }]);

  await client.login();
  expect(visited).toEqual(["authentik"]);
});
