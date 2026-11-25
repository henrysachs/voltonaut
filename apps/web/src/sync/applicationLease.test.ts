import { expect, it } from "vitest";
import type { User } from "@voltonaut/shared";

import { ApplicationSession } from "./applicationSession.js";
import { privateAuthTransport } from "./privateAuthTransport.js";
import { sessionPersistence } from "./sessionPersistence.js";

it("binds tokenless leases to validated identity/generation/origin and aborts on logout or replacement", async () => {
  let user: User = {
    id: "00000000-0000-4000-8000-000000000001",
    email: "a@example.com",
    createdAt: "2026-11-20T00:00:00.000Z",
  };

  const signals: Readonly<AbortSignal>[] = [];
  const origin = "http://localhost:3000";

  const session = new ApplicationSession({
    transport: {
      me: () => Promise.resolve(user),
      mode: () =>
        Promise.resolve({ mode: "oidc", providers: [{ id: "test", displayName: "Test" }] }),
      logout: () => Promise.resolve(),
      exchange: () => Promise.resolve({ user, sessionToken: "s".repeat(43) }),
    },
    persistence: sessionPersistence(origin, () => {
      throw new Error("denied");
    }),
    navigate: () => {},
    privateTransport: {
      authorize: (authorization) => {
        signals.push(authorization.signal);

        return privateAuthTransport(origin).authorize(authorization);
      },
    },
  });

  expect(session.authorize()).toBeUndefined();
  await session.exchange("a");
  const a = session.authorize();
  expect(a?.signal).toBe(signals[0]);
  expect(a).toMatchObject({ userId: user.id, apiOrigin: origin });
  expect(JSON.stringify(a)).not.toContain("sessionToken");
  await session.logout();
  expect(signals[0]?.aborted).toBe(true);
  expect(a?.current()).toBe(false);
  await expect(a?.profile.load()).rejects.toMatchObject({ cause: "superseded" });
  user = { ...user, id: "00000000-0000-4000-8000-000000000002", email: "b@example.com" };
  await session.exchange("b");
  const b = session.authorize();
  expect(b?.userId).toBe(user.id);
  expect(b?.generation).not.toBe(a?.generation);
  await session.exchange("new-b");
  expect(signals[1]?.aborted).toBe(true);
  expect(b?.current()).toBe(false);
});
