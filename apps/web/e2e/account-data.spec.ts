import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  API_ORIGIN,
  exported,
  readBrowserData,
  required,
  setupAccountPage,
  user,
} from "../src/sync/testdata/accountData.spec.js";

/* oxlint-disable typescript/prefer-readonly-parameter-types -- Playwright owns mutable page fixtures. */

async function seedVersionOneOutbox(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("voltonaut-account-outbox", 1);
        request.addEventListener("upgradeneeded", () => {
          request.result.createObjectStore("outbox");
        });
        request.addEventListener("success", () => {
          const database = request.result;
          const transaction = database.transaction("outbox", "readwrite");
          transaction.objectStore("outbox").put({ legacy: true }, "legacy");
          transaction.addEventListener("complete", () => {
            database.close();
            resolve();
          });
          transaction.addEventListener("abort", () => {
            database.close();
            reject(transaction.error ?? new Error("v1 seed failed"));
          });
        });
        request.addEventListener("error", () => {
          reject(request.error ?? new Error("v1 open failed"));
        });
      }),
  );
}

function readOutboxStores(page: Page): Promise<readonly string[]> {
  return page.evaluate(
    () =>
      new Promise<readonly string[]>((resolve, reject) => {
        const request = indexedDB.open("voltonaut-account-outbox");
        request.addEventListener("success", () => {
          resolve([...request.result.objectStoreNames].toSorted());
          request.result.close();
        });
        request.addEventListener("error", () => {
          reject(request.error ?? new Error("outbox inspection failed"));
        });
      }),
  );
}

function readUpgradedOutbox(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ readonly stores: readonly string[]; readonly rows: readonly unknown[] }>(
        (resolve, reject) => {
          const request = indexedDB.open("voltonaut-account-outbox");
          request.addEventListener("success", () => {
            const database = request.result;
            const rows = database.transaction("outbox", "readonly").objectStore("outbox").getAll();
            rows.addEventListener("success", () => {
              resolve({ stores: [...database.objectStoreNames], rows: rows.result });
              database.close();
            });
            rows.addEventListener("error", () => {
              database.close();
              reject(rows.error ?? new Error("v2 read failed"));
            });
          });
          request.addEventListener("error", () => {
            reject(request.error ?? new Error("v2 open failed"));
          });
        },
      ),
  );
}

test("downloads a validated account export without exposing the bearer", async ({ page }) => {
  await setupAccountPage(page, 200);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Datenexport herunterladen", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`voltonaut-account-${user.id}.json`);
  const content = await readFile(required(await download.path()), "utf8");
  expect(JSON.parse(content)).toEqual(exported);
  expect(content).not.toContain("s".repeat(43));
});

test("confirmed deletion purges only the owner's outbox and keeps riding plus local archives", async ({
  page,
}) => {
  await setupAccountPage(page, 200);
  const diagnostics = page.getByLabel("Render diagnostics");
  const beforeM = Number(await diagnostics.getAttribute("data-distance-m"));
  const confirmation = page.getByLabel("E-Mail zur Löschbestätigung");
  const understood = page.getByRole("checkbox");
  const deleteButton = page.getByRole("button", { name: "Konto endgültig löschen", exact: true });
  await expect(deleteButton).toBeDisabled();
  await confirmation.fill(user.email);
  await understood.check();
  await expect(deleteButton).toBeEnabled();

  const requestPromise = page.waitForRequest(`${API_ORIGIN}/v1/me`);

  await deleteButton.click();
  const deletionRequest = await requestPromise;
  expect(deletionRequest.method()).toBe("DELETE");
  expect(deletionRequest.headers()["origin"]).toBe(new URL(page.url()).origin);
  expect(deletionRequest.postDataJSON()).toEqual({ confirmation: user.email });
  await expect(page.getByRole("tabpanel", { name: "Konto", exact: true })).toContainText(
    "Konto gelöscht",
  );
  await expect
    .poll(async () => Number(await diagnostics.getAttribute("data-distance-m")))
    .toBeGreaterThan(beforeM);

  const local = await readBrowserData(page);
  expect(local.session).toBeNull();
  expect(local.outbox).toHaveLength(1);
  expect(local.outbox[0]).toMatchObject({ userId: local.foreignId });
  expect(local.deletedOwners).toContain(JSON.stringify([API_ORIGIN, user.id]));
  expect(local.rides).toHaveLength(1);
  expect(local.profile[0]).toMatchObject({ profile: { displayName: "Guest keeps" } });
});

test("failed server deletion keeps the session and local outbox untouched", async ({ page }) => {
  await setupAccountPage(page, 503);
  await page.getByLabel("E-Mail zur Löschbestätigung").fill(user.email);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Konto endgültig löschen", exact: true }).click();
  await expect(page.getByRole("tabpanel", { name: "Konto", exact: true })).toContainText(
    "Kontolöschung nicht bestätigt",
  );
  const local = await readBrowserData(page);
  expect(local.session).not.toBeNull();
  expect(local.outbox).toHaveLength(2);
  expect(local.deletedOwners).toEqual([]);
});

test("upgrades the account outbox from version 1 without losing existing rows", async ({
  page,
}) => {
  await page.goto("/robots.txt");
  await seedVersionOneOutbox(page);
  await setupAccountPage(page, 200, false);
  await expect.poll(() => readOutboxStores(page)).toEqual(["deleted-owners", "outbox"]);
  const upgraded = await readUpgradedOutbox(page);
  expect(upgraded.stores.toSorted()).toEqual(["deleted-owners", "outbox"]);
  expect(upgraded.rows).toEqual([{ legacy: true }]);
});
