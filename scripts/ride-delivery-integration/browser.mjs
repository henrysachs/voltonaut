/// <reference types="node" />
import { spawn } from "node:child_process";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "../../packages/shared/node_modules/zod/index.js";

/** @param {{readonly root: string; readonly artifacts: string; readonly database: string; readonly web: string; readonly api: string; readonly control: string; readonly origins: readonly string[]; readonly workers: readonly string[]; readonly filter: string | undefined}} options */
export async function runBrowser(options) {
  const config = join(options.artifacts, "playwright.config.mjs");
  const webDirectory = join(options.root, "apps/web");

  await writeFile(
    config,
    `export default ${JSON.stringify({ testDir: join(webDirectory, "verification"), testMatch: "ride-delivery-integration.spec.ts", timeout: 90_000, workers: 1, fullyParallel: false, reporter: [["list"], ["json", { outputFile: join(options.artifacts, "cases.json") }]], outputDir: join(options.artifacts, "browser-results"), use: { headless: true, viewport: { width: 1280, height: 720 }, serviceWorkers: "block", trace: "retain-on-failure", launchOptions: { args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-background-networking", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"] } } })};\n`,
  );

  const args = [
    join(webDirectory, "node_modules/@playwright/test/cli.js"),
    "test",
    "--config",
    config,
    ...(options.filter === undefined ? [] : ["--grep", options.filter]),
  ];

  const runner = spawn(process.execPath, args, {
    cwd: options.root,
    env: {
      PATH: process.env["PATH"],
      HOME: process.env["HOME"],
      TMPDIR: process.env["TMPDIR"],
      WEB_ORIGIN: options.web,
      API_ORIGIN: options.api,
      DELIVERY_CONTROL: options.control,
      DELIVERY_ARTIFACTS: options.artifacts,
      DELIVERY_DATABASE: options.database,
      DELIVERY_ORIGINS: JSON.stringify(options.origins),
      DELIVERY_WORKERS: JSON.stringify(options.workers),
    },
    stdio: "inherit",
  });

  const result = await once(runner, "exit");

  return {
    args,
    cwd: options.root,
    name: "browser",
    status: z.number().nullable().parse(result[0]),
  };
}
