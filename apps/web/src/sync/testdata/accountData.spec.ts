import { expect, type Page } from "@playwright/test";

/* oxlint-disable typescript/prefer-readonly-parameter-types -- Playwright pages and IndexedDB fixtures are mutable browser handles. */

export const API_ORIGIN = "http://127.0.0.1:3000";

export const user = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "rider@example.com",
  createdAt: "2026-11-20T00:00:00.000Z",
};

const otherUserId = "00000000-0000-4000-8000-000000000002";
const token = "s".repeat(43);

const profile = {
  displayName: "Rider",
  massKg: 75,
  heightCm: 185,
  bike: { massKg: 8, chainringTeeth: 42, cogTeeth: 14, wheelCircM: 2.105 },
  gearPreset: "zwift-like-24",
  units: "metric",
};

export const exported = {
  schemaVersion: 1,
  exportedAt: "2026-11-24T12:00:00.000Z",
  account: {
    user,
    membership: { tier: "normal", vip: false },
    authorization: { role: "user" },
    identities: [{ issuer: "https://identity.example", subject: "owner-subject" }],
  },
  profile: { status: "present", profile, updatedAt: "2026-11-20T00:00:00.000Z" },
  rides: [],
  inventory: { status: "not_stored" },
  progression: { volts: { balance: 0, journal: [] } },
  strava: { status: { status: "disabled" }, deliveries: [] },
};

async function routeExportAndIdentities(page: Page): Promise<void> {
  await page.route(`${API_ORIGIN}/v1/me/export`, (route) => route.fulfill({ json: exported }));
  await page.route(`${API_ORIGIN}/v1/auth/identities`, (route) =>
    route.fulfill({
      json: {
        identities: [
          { providerId: "cloudflare", displayName: "Cloudflare Access" },
          { providerId: "authentik", displayName: "authentik" },
        ],
      },
    }),
  );
}

export async function setupAccountPage(
  page: Page,
  deleteStatus: number,
  seed = true,
): Promise<void> {
  await page.addInitScript(
    ({ apiOrigin, sessionToken }) => {
      localStorage.setItem(
        `voltonaut.application-session:${apiOrigin}`,
        JSON.stringify({ sessionToken }),
      );
    },
    { apiOrigin: API_ORIGIN, sessionToken: token },
  );
  await page.route(`${API_ORIGIN}/v1/me`, async (route) => {
    if (route.request().method() === "DELETE") {
      await route.fulfill({ status: deleteStatus, body: "" });

      return;
    }

    await route.fulfill({ json: { user } });
  });
  await page.route(`${API_ORIGIN}/v1/me/profile`, (route) =>
    route.fulfill({ json: { status: "missing" } }),
  );
  await page.route(`${API_ORIGIN}/v2/rides`, (route) =>
    route.fulfill({ json: { rides: [], nextCursor: null } }),
  );
  await page.route(`${API_ORIGIN}/v1/me/account-status`, (route) =>
    route.fulfill({
      json: { membership: { tier: "normal", vip: false }, authorization: { role: "user" } },
    }),
  );
  await page.route(`${API_ORIGIN}/v1/strava/connection`, (route) =>
    route.fulfill({ json: { status: "disabled" } }),
  );
  await routeExportAndIdentities(page);
  await page.goto("/?sim=1&debug=1");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await page.getByRole("button", { name: "Menü", exact: true }).click();
  await page.getByRole("tab", { name: "Konto", exact: true }).click();
  await expect(page.getByRole("tabpanel", { name: "Konto", exact: true })).toContainText(
    `Daten für ${user.email}`,
  );

  if (seed) await seedBrowserData(page);
}

async function seedOutbox(page: Page): Promise<void> {
  await page.evaluate(
    async ({ apiOrigin, ownerId, foreignId, riderProfile }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("voltonaut-account-outbox", 2);
        request.addEventListener("upgradeneeded", () => {
          for (const store of ["outbox", "deleted-owners"]) {
            if (!request.result.objectStoreNames.contains(store))
              request.result.createObjectStore(store);
          }
        });
        request.addEventListener("success", () => {
          resolve(request.result);
        });
        request.addEventListener("error", () => {
          reject(request.error ?? new Error("outbox open failed"));
        });
      });

      const base = {
        apiOrigin,
        createdAtMs: 1000,
        revision: "00000000-0000-4000-8000-000000000010",
        kind: "profile",
        payload: riderProfile,
        state: { kind: "queued", attempts: 0, retryAtMs: 0 },
      };

      const transaction = database.transaction("outbox", "readwrite");
      transaction
        .objectStore("outbox")
        .put({ ...base, userId: ownerId }, [apiOrigin, "profile", ownerId]);
      transaction
        .objectStore("outbox")
        .put({ ...base, userId: foreignId }, [apiOrigin, "profile", foreignId]);
      await new Promise<void>((resolve, reject) => {
        transaction.addEventListener("complete", () => {
          database.close();
          resolve();
        });
        transaction.addEventListener("abort", () => {
          database.close();
          reject(transaction.error ?? new Error("outbox seed failed"));
        });
      });
    },
    { apiOrigin: API_ORIGIN, ownerId: user.id, foreignId: otherUserId, riderProfile: profile },
  );
}

async function seedRideArchive(page: Page): Promise<void> {
  await page.evaluate(async (riderProfile) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("voltonaut-local-rides", 1);
      request.addEventListener("upgradeneeded", () => {
        request.result.createObjectStore("completed");
      });
      request.addEventListener("success", () => {
        resolve(request.result);
      });
      request.addEventListener("error", () => {
        reject(request.error ?? new Error("ride archive open failed"));
      });
    });

    const rideId = "00000000-0000-4000-8000-000000000020";
    const transaction = database.transaction("completed", "readwrite");
    transaction.objectStore("completed").put(
      {
        schemaVersion: 1,
        rideId,
        startedAt: "2026-11-20T00:00:00.000Z",
        metadata: {
          source: "sim",
          routeId: "test-loop",
          routeRevision: "1",
          physicsClockScale: 1,
          profile: riderProfile,
        },
        samples: [
          { elapsedMs: 0, distanceM: 0, powerW: 100, cadenceRpm: 80, gap: false },
          { elapsedMs: 1000, distanceM: 5, powerW: 110, cadenceRpm: 82, gap: false },
        ],
      },
      rideId,
    );
    await new Promise<void>((resolve, reject) => {
      transaction.addEventListener("complete", () => {
        database.close();
        resolve();
      });
      transaction.addEventListener("abort", () => {
        database.close();
        reject(transaction.error ?? new Error("ride archive seed failed"));
      });
    });
  }, profile);
}

async function seedGuestProfile(page: Page): Promise<void> {
  await page.evaluate(async (riderProfile) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("voltonaut", 1);
      request.addEventListener("upgradeneeded", () => {
        request.result.createObjectStore("profile");
      });
      request.addEventListener("success", () => {
        resolve(request.result);
      });
      request.addEventListener("error", () => {
        reject(request.error ?? new Error("profile open failed"));
      });
    });

    const transaction = database.transaction("profile", "readwrite");
    transaction
      .objectStore("profile")
      .put(
        { schemaVersion: 1, profile: { ...riderProfile, displayName: "Guest keeps" } },
        "current",
      );
    await new Promise<void>((resolve, reject) => {
      transaction.addEventListener("complete", () => {
        database.close();
        resolve();
      });
      transaction.addEventListener("abort", () => {
        database.close();
        reject(transaction.error ?? new Error("profile seed failed"));
      });
    });
  }, profile);
}

async function seedBrowserData(page: Page): Promise<void> {
  await seedOutbox(page);
  await seedRideArchive(page);
  await seedGuestProfile(page);
}

export function readBrowserData(page: Page) {
  return page.evaluate(
    async ({ apiOrigin, ownerId, foreignId }) => {
      // oxlint-disable-next-line unicorn/consistent-function-scoping -- Browser evaluate callbacks cannot close over module-scope helpers.
      const read = (name: string, version: number, store: string) =>
        new Promise<readonly unknown[]>((resolve, reject) => {
          const request = indexedDB.open(name, version);
          request.addEventListener("success", () => {
            const database = request.result;
            const rows = database.transaction(store, "readonly").objectStore(store).getAll();
            rows.addEventListener("success", () => {
              resolve(rows.result);
              database.close();
            });
            rows.addEventListener("error", () => {
              database.close();
              reject(rows.error ?? new Error("IndexedDB read failed"));
            });
          });
          request.addEventListener("error", () => {
            reject(request.error ?? new Error("IndexedDB open failed"));
          });
        });

      return {
        session: localStorage.getItem(`voltonaut.application-session:${apiOrigin}`),
        outbox: await read("voltonaut-account-outbox", 2, "outbox"),
        deletedOwners: await read("voltonaut-account-outbox", 2, "deleted-owners"),
        rides: await read("voltonaut-local-rides", 1, "completed"),
        profile: await read("voltonaut", 1, "profile"),
        ownerId,
        foreignId,
      };
    },
    { apiOrigin: API_ORIGIN, ownerId: user.id, foreignId: otherUserId },
  );
}

export function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Missing test value");

  return value;
}
