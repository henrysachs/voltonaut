import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, expect } from "./playwright-runtime.mjs";

function forbidNativeBluetooth() {
  Object.defineProperty(navigator, "bluetooth", {
    get() {
      console.error("VERIFICATION_NATIVE_BLUETOOTH_FORBIDDEN");
      throw new Error("Sim verification must never access native Bluetooth");
    },
  });
}

/** @returns {Promise<string>} */
function readArchiveJson() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("voltonaut-local-rides");
    request.addEventListener("upgradeneeded", () => {
      request.transaction?.abort();
      reject(new Error("Application has not created its real ride archive"));
    });
    request.addEventListener("error", () => {
      reject(new Error("Cannot open application ride archive"));
    });
    request.addEventListener("success", () => {
      const database = request.result;
      const transaction = database.transaction("completed", "readonly");
      const rows = transaction.objectStore("completed").getAll();
      transaction.addEventListener("complete", () => {
        database.close();
        resolve(JSON.stringify(rows.result));
      });
      transaction.addEventListener("abort", () => {
        database.close();
        reject(new Error("Cannot read application ride archive"));
      });
    });
  });
}

function createDiagnostics() {
  /** @type {{ console: { readonly type: string; readonly text: string }[]; errors: string[]; blocked: string[]; requests: { readonly path: string; readonly type: string }[]; workers: string[]; bluetoothAccesses: number }} */
  const diagnostics = {
    console: [],
    errors: [],
    blocked: [],
    requests: [],
    workers: [],
    bluetoothAccesses: 0,
  };

  return diagnostics;
}

/** @param {Readonly<import("../../apps/web/node_modules/@playwright/test/index.js").BrowserContext>} context @param {ReturnType<typeof createDiagnostics>} diagnostics @param {string} origin */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the context; this boundary records blocked requests in the owned diagnostics.
async function restrictNetwork(context, diagnostics, origin) {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the Route lifecycle and request interception methods.
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());

    if (
      url.origin !== origin ||
      /(?:\.(?:ts|tsx)$|^\/(?:@|src\/|node_modules\/))/u.test(url.pathname)
    ) {
      diagnostics.blocked.push(url.href);
      await route.abort();

      return;
    }

    diagnostics.requests.push({ path: url.pathname, type: route.request().resourceType() });
    await route.continue();
  });
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the native WebSocket route handle.
  await context.routeWebSocket("**/*", (socket) => {
    diagnostics.blocked.push(socket.url());
    void socket.close();
  });
}

/** @param {Readonly<import("../../apps/web/node_modules/@playwright/test/index.js").Page>} page @param {ReturnType<typeof createDiagnostics>} diagnostics */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns native page/event handles; listeners append to the owned diagnostics.
function observeBrowser(page, diagnostics) {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the native ConsoleMessage handle.
  page.on("console", (message) => {
    const text = message.text();
    diagnostics.console.push({ type: message.type(), text });

    if (text.includes("VERIFICATION_NATIVE_BLUETOOTH_FORBIDDEN"))
      diagnostics.bluetoothAccesses += 1;
  });
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright emits its native Error contract.
  page.on("pageerror", (error) => {
    diagnostics.errors.push(error.message);
  });
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the Worker lifecycle handle.
  page.on("worker", (worker) => {
    diagnostics.workers.push(new URL(worker.url()).pathname);
  });
}

/** @param {Readonly<import("../../apps/web/node_modules/@playwright/test/index.js").Page>} page @param {string} origin @param {string} artifacts */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Driving public controls requires Playwright's native Page handle.
async function recordThroughUi(page, origin, artifacts) {
  const response = await page.goto(`${origin}/?sim=1`);
  assert.equal(response?.headers()["referrer-policy"], "no-referrer");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await expect(page.getByTestId("hud-power")).toHaveText(/^[1-9]\d* W$/u);
  await expect(page.getByTestId("hud-speed")).not.toHaveText("0.0 km/h");
  assert.equal(
    await page.evaluate(readArchiveJson),
    "[]",
    "Fresh browser starts with an empty archive",
  );
  await page.getByRole("button", { name: "Aufnahme starten", exact: true }).click();
  await expect(page.getByTestId("recording-status")).toContainText("Aufnahme läuft");
  const startedMs = performance.now();

  await delay(1600);
  await page.getByRole("button", { name: "Aufnahme beenden und speichern", exact: true }).click();
  await expect(page.getByTestId("recording-status")).toContainText("Lokal gespeichert");
  const realCaptureMs = performance.now() - startedMs;
  assert.ok(
    realCaptureMs > 1000,
    "Capture spans more than one real second without clock injection",
  );
  const archive = await page.evaluate(readArchiveJson);

  await page.screenshot({ path: join(artifacts, "stored-capture.png"), fullPage: true });
  await page.reload();
  await expect(page.getByRole("button", { name: "TCX herunterladen", exact: true })).toHaveCount(1);
  assert.equal(
    await page.evaluate(readArchiveJson),
    archive,
    "Actual IndexedDB archive survives reload unchanged",
  );
  await page.screenshot({ path: join(artifacts, "reloaded-capture.png"), fullPage: true });
  await writeFile(
    join(artifacts, "capture.json"),
    `${JSON.stringify({ source: "sim", clockScale: 1, realCaptureMs, reloadedUnchanged: true }, null, 2)}\n`,
  );

  return archive;
}

/** @param {ReturnType<typeof createDiagnostics>} diagnostics @param {readonly { readonly path: string }[]} workers */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Evidence is the same owned diagnostic log populated by native browser listeners.
function requireBrowserEvidence(diagnostics, workers) {
  assert.equal(diagnostics.bluetoothAccesses, 0, "Sim never accesses native Bluetooth");
  assert.deepEqual(
    diagnostics.blocked,
    [],
    "No source modules, dev client or nonlocal network attempted",
  );
  assert.deepEqual(diagnostics.errors, [], "Built application has no uncaught errors");

  for (const worker of workers) {
    assert.ok(
      diagnostics.workers.includes(`/${worker.path}`),
      "Browser runs the hashed built Worker",
    );
    assert.ok(
      diagnostics.requests.some((request) => request.path === `/${worker.path}`),
      "Worker was fetched from the static build",
    );
  }
}

/** @param {{ readonly origin: string; readonly artifacts: string; readonly workers: readonly { readonly path: string }[] }} options */
export async function captureSimArchive(options) {
  const { origin, artifacts, workers } = options;
  const diagnostics = createDiagnostics();

  const context = await chromium.launchPersistentContext(join(artifacts, "chromium-profile"), {
    headless: true,
    viewport: { width: 1280, height: 720 },
    serviceWorkers: "block",
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--disable-background-networking",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost",
    ],
  });

  try {
    await restrictNetwork(context, diagnostics, origin);
    await context.addInitScript(forbidNativeBluetooth);
    const page = await context.newPage();
    observeBrowser(page, diagnostics);
    page.setDefaultTimeout(30_000);

    try {
      const archive = await recordThroughUi(page, origin, artifacts);
      requireBrowserEvidence(diagnostics, workers);

      return archive;
    } catch (error) {
      await page
        .screenshot({ path: join(artifacts, "browser-failure.png"), fullPage: true })
        .catch(() => {});
      throw error;
    }
  } finally {
    await context.close();
    await writeFile(
      join(artifacts, "browser-diagnostics.json"),
      `${JSON.stringify(diagnostics, null, 2)}\n`,
    );
  }
}
