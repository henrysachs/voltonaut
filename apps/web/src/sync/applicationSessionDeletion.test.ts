import { expect, it } from "vitest";
import type { SessionResponse, User } from "@voltonaut/shared";
import { ApplicationSession } from "./applicationSession.js";
import { privateAuthTransport } from "./privateAuthTransport.js";
import { sessionPersistence } from "./sessionPersistence.js";

const user: User = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "rider@example.com",
  createdAt: "2026-11-20T00:00:00.000Z",
};

const token = "s".repeat(43);
const session: SessionResponse = { user, sessionToken: token };

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing lease");

  return value;
}

interface MemoryValues {
  readonly get: (key: string) => string | undefined;
  readonly set: (key: string, value: string) => void;
  readonly delete: (key: string) => void;
}

function memoryStorage(values: MemoryValues) {
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

it("ends a deleted account locally without another logout request", async () => {
  const values = new Map<string, string>();
  const calls: string[] = [];

  const client = new ApplicationSession({
    transport: {
      mode: () =>
        Promise.resolve({ mode: "oidc", providers: [{ id: "test", displayName: "Test" }] }),
      exchange: () => {
        calls.push("exchange");

        return Promise.resolve(session);
      },
      me: () => Promise.resolve(user),
      logout: (value) => {
        calls.push(`logout:${value}`);

        return Promise.resolve();
      },
    },
    persistence: sessionPersistence("http://localhost:3000", () => memoryStorage(values)),
    navigate: () => {
      throw new Error("unexpected navigation");
    },
    privateTransport: privateAuthTransport("http://localhost:3000"),
  });

  await client.exchange("a".repeat(43));
  const lease = required(client.authorize());
  expect(client.endAfterAccountDeletion()).toBe(true);
  expect(JSON.stringify(client.view())).toContain("Konto gelöscht");
  expect(lease.current()).toBe(false);
  expect(lease.signal.aborted).toBe(true);
  expect(client.view().kind).toBe("guest");
  expect(values.size).toBe(0);
  expect(calls).toEqual(["exchange"]);
});

it("reports when a persisted session cannot be removed after account deletion", async () => {
  const values = new Map<string, string>();
  const storage = memoryStorage(values);

  const persistence = sessionPersistence("http://localhost:3000", () => ({
    ...storage,
    removeItem: () => {
      throw new Error("storage denied");
    },
  }));

  persistence.save(token);

  const client = new ApplicationSession({
    transport: {
      mode: () =>
        Promise.resolve({ mode: "oidc", providers: [{ id: "test", displayName: "Test" }] }),
      exchange: () => Promise.resolve(session),
      me: () => Promise.resolve(user),
      logout: () => Promise.resolve(),
    },
    persistence,
    navigate: () => {
      throw new Error("unexpected navigation");
    },
    privateTransport: privateAuthTransport("http://localhost:3000"),
  });

  await client.restore();

  expect(client.endAfterAccountDeletion()).toBe(false);
  expect(values.size).toBe(1);
  expect(JSON.stringify(client.view())).toContain("Lokale Session konnte nicht entfernt werden");
});
