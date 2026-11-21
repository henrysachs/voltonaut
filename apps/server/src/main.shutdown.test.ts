import { once } from "node:events";
import { rm } from "node:fs/promises";
import { Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createOidcProvider } from "./testing/oidc-provider.spec.js";
import {
  availableProcessPort,
  buildServerProcess,
  startServerProcess,
  stopServerProcess,
  waitForProcessHealth,
} from "./testing/server-process.spec.js";

let directory = "";

beforeAll(async () => {
  directory = await buildServerProcess();
}, 30_000);

afterAll(async () => {
  if (directory !== "") await rm(directory, { recursive: true, force: true });
});

it("exits on SIGTERM within 500 ms with an accepted zero-byte TCP connection", async () => {
  const provider = await createOidcProvider();
  const port = await availableProcessPort();
  const origin = `http://127.0.0.1:${port}`;
  const child = startServerProcess(directory, origin, provider.issuer);
  const exited = once(child, "exit");
  const idle = new Socket();

  try {
    await waitForProcessHealth(origin);
    idle.connect({ host: "127.0.0.1", port });
    await once(idle, "connect");
    await waitForProcessHealth(origin);
    expect(idle.bytesWritten).toBe(0);
    expect(idle.bytesRead).toBe(0);

    expect(child.kill("SIGTERM")).toBe(true);
    await delay(500);

    expect(child.signalCode).toBe("SIGTERM");
    expect(idle.bytesWritten).toBe(0);
    expect(idle.bytesRead).toBe(0);
    await exited;
  } finally {
    idle.destroy();
    stopServerProcess(child);
    await exited;
    await provider.close();
  }
});
