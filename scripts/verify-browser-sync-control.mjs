import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** @typedef {{readonly identity: (identity: "a" | "b") => void, readonly stop: () => Promise<void>, readonly start: () => Promise<void>}} SyncCommands */

/** @param {SyncCommands} options */
function syncCommands(options) {
  return new Map([
    [
      "/a",
      () => {
        options.identity("a");

        return Promise.resolve();
      },
    ],
    [
      "/b",
      () => {
        options.identity("b");

        return Promise.resolve();
      },
    ],
    ["/offline", options.stop],
    ["/online", options.start],
    [
      "/restart",
      async () => {
        await options.stop();
        await options.start();
      },
    ],
  ]);
}

export async function randomPort() {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  const port = address instanceof Object ? address.port : undefined;

  if (port === undefined) throw new Error("Missing local verification port");
  await new Promise((resolve) => {
    reservation.close(resolve);
  });

  return port;
}

/** @param {SyncCommands} options */
export async function syncBrowserControl(options) {
  const commands = syncCommands(options);

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Node owns native request/response lifecycle handles in this local verifier.
  const server = createServer((request, response) => {
    const command = commands.get(request.url ?? "");

    if (request.method !== "POST" || command === undefined) {
      response.writeHead(404);
      response.end();

      return;
    }

    command()
      .then(() => {
        response.writeHead(204);

        return response.end();
      })
      .catch(() => {
        response.writeHead(500);
        response.end();
      });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = address instanceof Object ? address.port : undefined;

  if (port === undefined) throw new Error("Missing verification control port");

  return {
    origin: `http://127.0.0.1:${port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => {
        server.close(resolve);
      });
    },
  };
}

/** @param {string} artifacts */
export async function verifySyncDatabase(artifacts) {
  const database = new DatabaseSync(join(artifacts, "sync.sqlite"), { readOnly: true });
  const rows = database.prepare("SELECT id, count(*) AS copies FROM rides GROUP BY id").all();
  assert.equal(rows.length, 3);

  for (const row of rows) assert.equal(row["copies"], 1);
  await writeFile(join(artifacts, "database-proof.json"), JSON.stringify(rows, null, 2));
  database.close();
}
