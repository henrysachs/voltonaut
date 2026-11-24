import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { z } from "zod";

const serverRoot = fileURLToPath(new URL("../../", import.meta.url));

export async function buildServerProcess(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "voltonaut-shutdown-"));

  await writeFile(join(directory, "package.json"), JSON.stringify({ type: "module" }));
  await symlink(join(serverRoot, "node_modules"), join(directory, "node_modules"));
  await build({
    root: serverRoot,
    configFile: join(serverRoot, "vite.config.ts"),
    logLevel: "error",
    build: { outDir: directory, emptyOutDir: false },
  });

  return directory;
}

export async function availableProcessPort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = z.object({ port: z.number() }).parse(server.address());

  await new Promise<void>((resolve, reject) => {
    server.close((error: Readonly<Error> | undefined) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });

  return address.port;
}

export function startServerProcess(directory: string, origin: string, issuer: string) {
  return spawn(process.execPath, [join(directory, "main.js")], {
    cwd: serverRoot,
    env: {
      NODE_ENV: "test",
      AUTH_MODE: "oidc",
      STRAVA_MODE: "disabled",
      DATABASE_PATH: ":memory:",
      HOST: "127.0.0.1",
      PORT: new URL(origin).port,
      OIDC_PROVIDERS: "test",
      OIDC_TEST_ISSUER: issuer,
      OIDC_TEST_CLIENT_ID: "test-client",
      OIDC_TEST_CLIENT_SECRET: "test-secret",
      OIDC_TEST_REDIRECT_URI: `${origin}/v1/auth/oidc/test/callback`,
      CLIENT_ORIGIN: "http://127.0.0.1:5193",
    },
    stdio: "ignore",
  });
}

export function stopServerProcess(
  child: Readonly<Pick<ReturnType<typeof startServerProcess>, "exitCode" | "signalCode" | "kill">>,
): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGKILL");
}

export async function waitForProcessHealth(origin: string, attempt = 0): Promise<void> {
  if (attempt === 100) throw new Error("Compiled API did not become healthy");

  const response = await fetch(`${origin}/healthz`, {
    headers: { Connection: "close" },
    signal: AbortSignal.timeout(500),
  }).catch(() => null);

  if (response !== null) {
    await response.arrayBuffer();

    if (response.ok) return;
  }

  await delay(50);
  await waitForProcessHealth(origin, attempt + 1);
}
