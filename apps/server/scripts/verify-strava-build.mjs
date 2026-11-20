import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { chromium } from "./strava-browser-runtime.mjs";
import {
  createVerificationHost,
  startVerificationServer,
  stopVerificationServer,
  verifyStartupRejections,
  closeVerificationHost,
} from "./strava-verification-host.mjs";

const root = resolve(import.meta.dirname, "../../..");

const host = await createVerificationHost(
  root,
  resolve(process.argv[2] ?? join(root, "apps/server")),
);

const { api, origin, provider, oidc, databasePath } = host;
let child = startVerificationServer(host);

/** @type {import("./strava-browser-runtime.mjs").Browser | undefined} */
let browser;
let unexpectedBrowserRequests = 0;

const receipt = {
  artifact: "compiled Nest server",
  provider: "loopback protocol fake only",
  browser: "Chromium protocol fixture, not application UI",
  checks: ["explicit server-only connection; no upload routes"],
};

async function healthy(remaining = 100) {
  assert.ok(remaining > 0, "compiled server becomes healthy");
  const response = await fetch(`${api}/healthz`).catch(() => null);

  if (response?.ok === true) return;
  assert.equal(child.exitCode, null, "compiled process remains running");
  await delay(50);

  return healthy(remaining - 1);
}

/** @param {string} expectedStatus */
function encryptedCheckpoint(expectedStatus) {
  const db = new DatabaseSync(databasePath);

  const row = z
    .object({ status: z.string(), encrypted_tokens: z.string() })
    .parse(db.prepare("SELECT status, encrypted_tokens FROM strava_connections").get());

  assert.equal(row.status, expectedStatus);
  z.object({
    keyId: z.literal("1"),
    nonce: z.string().regex(/^[a-f0-9]{24}$/u),
    tag: z.string().regex(/^[a-f0-9]{32}$/u),
    ciphertext: z.string().min(1),
  })
    .strict()
    .parse(JSON.parse(row.encrypted_tokens));
  assert.equal(provider.containsPlaintext(JSON.stringify(row)), false);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
  assert.equal(provider.containsPlaintext(readFileSync(databasePath).toString("latin1")), false);
}

/** @param {import("./strava-browser-runtime.mjs").Page} page @param {string} selector @param {string} expected */
async function command(page, selector, expected) {
  await page.locator(selector).click();
  await page
    .locator("#result")
    .filter({ hasText: new RegExp(`^${expected}$`, "u") })
    .waitFor();
}

/** @param {import("./strava-browser-runtime.mjs").Page} page */
async function browserFlow(page) {
  await page.goto(origin);
  await command(page, "#login-a", "logged-in");
  oidc.control.subject = "second-local-owner";
  oidc.control.email = "second-local@example.com";
  await command(page, "#login-b", "logged-in");
  await command(page, "#switch-a", "account-a");
  await command(page, "#start", "started");
  const cookies = await page.context().cookies(`${api}/v1/strava/connection`);
  const binding = cookies.find((cookie) => cookie.name === "voltonaut-strava");
  assert.ok(
    binding?.httpOnly === true && binding.sameSite === "Lax" && binding.path === "/v1/strava",
  );
  await command(page, "#switch-b", "account-b");
  await command(page, "#authorize", "confirmation-ready");
  assert.equal(new URL(page.url()).search, "", "fixture strips one-use code immediately");
  await command(page, "#confirm", "error-401");
  await command(page, "#switch-a", "account-a");
  await command(page, "#confirm", "connected");
  await command(page, "#confirm", "error-401");
  receipt.checks.push(
    "real OIDC sessions A/B",
    "credentialed cross-origin start",
    "HttpOnly SameSite=Lax path cookie",
    "top-level local provider navigation",
    "B cannot consume A handoff",
    "A confirms once",
  );
}

/** @param {import("./strava-browser-runtime.mjs").Page} page */
async function restartAndRevoke(page) {
  await stopVerificationServer(child);
  encryptedCheckpoint("connected");
  child = startVerificationServer(host);
  await healthy();
  await command(page, "#status", "connected");
  provider.control.revokeFault = "http";
  await command(page, "#disconnect", "revocation_pending");
  await stopVerificationServer(child);
  encryptedCheckpoint("revocation_pending");
  child = startVerificationServer(host);
  await healthy();
  await command(page, "#status", "revocation_pending");
  provider.control.revokeFault = "none";
  await command(page, "#disconnect", "disconnected");
  await stopVerificationServer(child);
  const db = new DatabaseSync(databasePath);
  assert.equal(
    z
      .object({ n: z.number() })
      .parse(db.prepare("SELECT COUNT(*) AS n FROM strava_connections").get()).n,
    0,
  );
  db.close();
  receipt.checks.push(
    "encrypted SQLite persists across process restart",
    "failed remote revoke stays locally blocked across restart",
    "retry confirms genuine fake-provider revoke and removes ciphertext",
  );
}

try {
  await healthy();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());

    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
      unexpectedBrowserRequests += 1;
      await route.abort();

      return;
    }

    await route.continue();
  });
  const page = await context.newPage();
  await browserFlow(page);
  await restartAndRevoke(page);
  verifyStartupRejections(host);
  assert.equal(unexpectedBrowserRequests, 0);
  assert.equal(provider.control.unexpectedCalls, 0);
  assert.equal(provider.control.tokenCalls, 1);
  assert.equal(provider.control.validClientCalls, 1);
  assert.equal(provider.control.revokeCalls, 2);
  receipt.checks.push(
    "invalid key and production fake-provider configuration rejected",
    "production legacy mail requirement unchanged",
    "browser and compiled API restricted to loopback network",
  );

  const providerRequests = {
    token: provider.control.tokenCalls,
    revoke: provider.control.revokeCalls,
    unexpected: provider.control.unexpectedCalls + unexpectedBrowserRequests,
  };

  writeFileSync(
    join(root, "docs/research/strava-local-verification.json"),
    `${JSON.stringify({ ...receipt, providerRequests }, null, 2)}\n`,
  );
  process.stdout.write(
    "Compiled Strava protocol and browser proof passed. Sanitized receipt in docs/research/strava-local-verification.json. No live provider calls.\n",
  );
} finally {
  await browser?.close();
  await stopVerificationServer(child);
  await closeVerificationHost(host);
}
