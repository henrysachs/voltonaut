/// <reference types="node" />
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "../../packages/shared/node_modules/zod/index.js";

const cases = [
  "account-switch stale",
  "account-switch-code actual",
  "binding actual",
  "expiry actual",
  "capture-owned real",
  "delivery explicit",
  "lost-response accepted",
  "poll-restart preserves",
  "sim-blocked actual",
  "memory-cookie actual",
  "clock-fast actual",
  "missing-cookie actual",
];

/** @param {string} name @param {string} artifacts */
async function runCase(name, artifacts) {
  await mkdir(artifacts);

  const child = spawn(process.execPath, [join(import.meta.dirname, "verify.mjs"), "--case", name], {
    cwd: join(import.meta.dirname, "../.."),
    env: { ...process.env, DELIVERY_CASE_ARTIFACTS: artifacts },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let log = "";

  child.stdout?.on("data", (chunk) => {
    const text = String(chunk);
    log += text;
    process.stdout.write(text);
  });
  child.stderr?.on("data", (chunk) => {
    const text = String(chunk);
    log += text;
    process.stderr.write(text);
  });
  const result = await once(child, "exit");
  const status = z.number().nullable().parse(result[0]);

  await writeFile(join(artifacts, "coordinator.log"), log);

  return Object.freeze({ name, artifacts, status });
}

/** @param {string | undefined} filter */
export async function runSuite(filter) {
  const temporary = join(tmpdir(), "opencode");

  await mkdir(temporary, { recursive: true });
  const artifacts = await mkdtemp(join(temporary, "full-ride-delivery-proof-suite-"));
  const chosen = cases.filter((name) => filter === undefined || new RegExp(filter, "u").test(name));

  assert.ok(chosen.length > 0, "Filter must select an actual integration case");
  const results = [];

  process.stdout.write(`Suite evidence: ${artifacts}\n`);

  for (const [index, name] of chosen.entries()) {
    // oxlint-disable-next-line no-await-in-loop -- Independent cases use fresh providers, API processes and SQLite, never shared rate reservations.
    const result = await runCase(
      name,
      join(artifacts, `${String(index + 1).padStart(2, "0")}-${name.replaceAll(" ", "-")}`),
    );

    results.push(result);
    // oxlint-disable-next-line no-await-in-loop -- Retain the completed case even if a later case is interrupted.
    await writeFile(join(artifacts, "cases.json"), JSON.stringify(results, null, 2));
  }

  assert.ok(
    results.every((result) => result.status === 0),
    `Cases remain red; inspect ${artifacts}/cases.json`,
  );
}
