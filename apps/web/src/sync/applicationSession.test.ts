import { expect, it } from "vitest";
import type { AuthConfigResponse, SessionResponse, User } from "@voltonaut/shared";

import { ApplicationSession } from "./applicationSession.js";
import type { AuthTransport } from "./authTransport.js";
import { sessionPersistence } from "./sessionPersistence.js";
import { privateAuthTransport } from "./privateAuthTransport.js";
import { deferred } from "./testdata/deferred.js";

const user: User = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "local@example.com",
  createdAt: "2026-11-20T00:00:00.000Z",
};

const token = "s".repeat(43);
const session: SessionResponse = { user, sessionToken: token };

function fixture() {
  const data = new Map<string, string>();
  const calls: string[] = [];

  const persistence = sessionPersistence("http://localhost:3000", () => ({
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  }));

  const transport: AuthTransport = {
    mode: () => {
      calls.push("mode");

      return Promise.resolve({ mode: "oidc" });
    },
    me: () => {
      calls.push("me");

      return Promise.resolve(user);
    },
    exchange: () => {
      calls.push("exchange");

      return Promise.resolve(session);
    },
    logout: (value) => {
      calls.push(`logout:${value}`);

      return Promise.resolve();
    },
  };

  const navigate = (): void => {
    calls.push("navigate");
  };

  return {
    data,
    calls,
    persistence,
    transport,
    navigate,
    privateTransport: privateAuthTransport("http://localhost:3000"),
  };
}

function competingExchanges() {
  const older = deferred<SessionResponse>();
  const newer = deferred<SessionResponse>();

  const responses = new Map([
    ["older", older.promise],
    ["newer", newer.promise],
  ]);

  return {
    older,
    newer,
    exchange(code: string) {
      const response = responses.get(code);

      if (response === undefined) throw new Error("Missing test response");

      return response;
    },
  };
}

it("starts as guest without auth traffic; mode and navigation need an explicit login", async () => {
  const options = fixture();
  const client = new ApplicationSession(options);
  await client.restore();
  expect(options.calls).toEqual([]);
  expect(client.view().kind).toBe("guest");
  await client.login();
  expect(options.calls).toEqual(["mode", "navigate"]);
});

it("never publishes a cached user before me validates the token", async () => {
  const options = fixture();
  const waiting = deferred<User>();
  options.persistence.save(token);

  const client = new ApplicationSession({
    ...options,
    transport: { ...options.transport, me: () => waiting.promise },
  });

  const restore = client.restore();
  expect(client.view()).toEqual({ kind: "busy", operation: "restoring" });
  waiting.resolve(user);
  await restore;
  expect(client.view()).toEqual({ kind: "authenticated", user, persistent: true });
  expect(JSON.stringify(client.view())).not.toContain(token);
});

it("ignores a late me after logout, even if the transport ignores abort", async () => {
  const options = fixture();
  const waiting = deferred<User>();
  options.persistence.save(token);

  const client = new ApplicationSession({
    ...options,
    transport: { ...options.transport, me: () => waiting.promise },
  });

  const restore = client.restore();
  await client.logout();
  waiting.resolve(user);
  await restore;
  expect(client.view().kind).toBe("guest");
  expect(options.persistence.load()).toBeUndefined();
  expect(options.calls).toContain(`logout:${token}`);
});

it("ignores a late exchange after logout or a newer exchange", async () => {
  const options = fixture();
  const waiting = deferred<SessionResponse>();

  const client = new ApplicationSession({
    ...options,
    transport: { ...options.transport, exchange: () => waiting.promise },
  });

  const exchange = client.exchange("a".repeat(43));
  await client.logout();
  waiting.resolve(session);
  await exchange;
  expect(client.view().kind).toBe("guest");
  expect(options.persistence.load()).toBeUndefined();
});

it("keeps only the newest exchange and notifies without exposing either token", async () => {
  const options = fixture();
  const competing = competingExchanges();

  const transport: AuthTransport = {
    ...options.transport,
    exchange: (code) => competing.exchange(code),
  };

  const client = new ApplicationSession({ ...options, transport });
  const views: string[] = [];

  const unsubscribe = client.subscribe((view) => {
    views.push(JSON.stringify(view));
  });

  const first = client.exchange("older");
  const second = client.exchange("newer");
  const newToken = "n".repeat(43);
  competing.newer.resolve({ ...session, sessionToken: newToken });
  await second;
  competing.older.resolve(session);
  await first;
  expect(options.persistence.load()).toBe(newToken);
  expect(views.join()).not.toContain(token);
  expect(views.join()).not.toContain(newToken);
  unsubscribe();
  const count = views.length;
  await client.logout();
  expect(views).toHaveLength(count);
});

it("does not navigate on a mode response received after cancellation", async () => {
  const options = fixture();
  const waiting = deferred<AuthConfigResponse>();

  const client = new ApplicationSession({
    ...options,
    transport: { ...options.transport, mode: () => waiting.promise },
  });

  const login = client.login();
  await client.logout();
  waiting.resolve({ mode: "oidc" });
  await login;
  expect(options.calls).not.toContain("navigate");
  expect(client.view().kind).toBe("guest");
});

it("clears an invalid cached session and keeps failed exchange errors generic", async () => {
  const options = fixture();
  options.persistence.save(token);

  const transport: AuthTransport = {
    ...options.transport,
    me: () => Promise.reject(new Error("private server failure")),
    exchange: () => Promise.reject(new Error("private provider failure")),
  };

  const client = new ApplicationSession({ ...options, transport });
  await client.restore();
  expect(client.view()).toEqual({
    kind: "guest",
    message: "Session nicht bestätigt. Weiter als Gast.",
  });
  expect(options.persistence.load()).toBeUndefined();
  await client.exchange("a".repeat(43));
  expect(client.view()).toEqual({
    kind: "guest",
    message: "Anmeldung fehlgeschlagen oder Übergabe abgelaufen. Bei Bedarf erneut anmelden.",
  });
  expect(options.persistence.load()).toBeUndefined();
});

it("clears persisted session even when server logout fails", async () => {
  const options = fixture();

  const client = new ApplicationSession({
    ...options,
    transport: { ...options.transport, logout: () => Promise.reject(new Error("offline")) },
  });

  await client.exchange("a".repeat(43));
  await client.logout();
  expect(options.persistence.load()).toBeUndefined();
  expect(client.view()).toEqual({
    kind: "guest",
    message: "Lokal abgemeldet. Serverwiderruf nicht bestätigt.",
  });
});

it("keeps a memory session if storage is denied, and reports unconfirmed remote logout", async () => {
  const options = fixture();

  const client = new ApplicationSession({
    ...options,
    persistence: sessionPersistence("http://localhost:3000", () => {
      throw new Error("blocked");
    }),
    transport: { ...options.transport, logout: () => Promise.reject(new Error("offline")) },
  });

  await client.exchange("a".repeat(43));
  expect(client.view()).toEqual({ kind: "authenticated", user, persistent: false });
  await client.logout();
  expect(client.view()).toEqual({
    kind: "guest",
    message: "Im Tab abgemeldet. Serverwiderruf und Speicherbereinigung nicht bestätigt.",
  });
});

it.each([{ mode: "disabled" }, { mode: "magic-link" }] satisfies readonly AuthConfigResponse[])(
  "does not navigate for $mode mode",
  async (config: Readonly<AuthConfigResponse>) => {
    const options = fixture();

    const client = new ApplicationSession({
      ...options,
      transport: { ...options.transport, mode: () => Promise.resolve(config) },
    });

    await client.login();
    expect(options.calls).not.toContain("navigate");
    expect(client.view().kind).toBe("guest");
  },
);

it("clears only its own key and rejects corrupted cached input", () => {
  const options = fixture();
  options.data.set("other", "keep");
  options.persistence.save(token);
  options.persistence.clear();
  expect([...options.data.entries()]).toEqual([["other", "keep"]]);
  options.data.set("voltonaut.application-session:http://localhost:3000", '{"sessionToken":12}');
  expect(options.persistence.load()).toBeUndefined();
});
