import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { once } from "node:events";
import { expect, it } from "vitest";
import { ApplicationSession } from "./applicationSession.js";
import { privateAuthTransport } from "./privateAuthTransport.js";
import { deferred } from "./testdata/deferred.js";

function sessionFor(origin: string): ApplicationSession {
  return new ApplicationSession({
    transport: {
      mode: () =>
        Promise.resolve({ mode: "oidc", providers: [{ id: "test", displayName: "Test" }] }),
      me: () => Promise.reject(new Error("unexpected restore")),
      exchange: (id) =>
        Promise.resolve({
          sessionToken: `token-${id}`,
          user: { id, email: `${id}@example.com`, createdAt: "2026-11-20T00:00:00.000Z" },
        }),
      logout: () => Promise.resolve(),
    },
    persistence: { load: () => {}, save: () => false, clear: () => true },
    navigate: () => {
      throw new Error("unexpected navigation");
    },
    privateTransport: privateAuthTransport(origin),
  });
}

function originOf(server: Readonly<Pick<Server, "address">>): string {
  const address = server.address();

  if (address instanceof Object) return `http://127.0.0.1:${address.port}`;

  throw new Error("test server must listen on TCP");
}

it("aborts an actual in-flight account-status HTTP response when ApplicationSession logs out", async () => {
  const entered = deferred<void>();
  const closed = deferred<void>();

  const server = createServer(
    (
      _request: Readonly<Pick<IncomingMessage, "url">>,
      response: Readonly<Pick<ServerResponse, "on">>,
    ) => {
      response.on("close", () => {
        closed.resolve();
      });
      entered.resolve();
    },
  );

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const session = sessionFor(originOf(server));

  try {
    await session.exchange("a");
    const lease = session.authorize();
    const pending = lease?.accountStatus();
    expect(pending).toBeDefined();
    await entered.promise;
    await session.logout();
    await expect(pending).rejects.toMatchObject({ cause: "superseded" });
    await closed.promise;
    expect(lease?.signal.aborted).toBe(true);
    expect(lease?.current()).toBe(false);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
});
