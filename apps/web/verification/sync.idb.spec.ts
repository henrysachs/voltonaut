import { expect, test } from "@playwright/test";
import type { CompletedLocalRide } from "@voltonaut/shared";
import { localRide } from "../src/sync/testdata/localRide.js";
import type { OutboxRow } from "../src/sync/accountOutbox.js";

const web = process.env["WEB_ORIGIN"] ?? "http://127.0.0.1:5193";
const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";

interface ClaimInput {
  readonly ride: CompletedLocalRide;
  readonly userId: string;
}

async function claim(input: ClaimInput): Promise<void> {
  const { openAccountOutbox } = await import("../src/sync/accountOutboxDatabase.js");
  const { newOutboxRow } = await import("../src/sync/accountOutbox.js");
  const database = await openAccountOutbox();
  await database.claim(
    newOutboxRow(
      { apiOrigin: "http://localhost:3000", userId: input.userId },
      input.ride,
      Date.now(),
    ),
  );
}

async function list(userId: string) {
  const { openAccountOutbox } = await import("../src/sync/accountOutboxDatabase.js");

  return (await openAccountOutbox()).list({ apiOrigin: "http://localhost:3000", userId });
}

function winningOwner(rows: readonly OutboxRow[]): string {
  const [row] = rows;

  if (rows.length !== 1 || row === undefined) throw new Error("Expected exactly one atomic claim");

  return row.userId;
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns browser/context fixture handles.
test("sync real IndexedDB atomically prevents cross-tab owner rebind and UUID aliases", async ({
  page,
  context,
}) => {
  const other = await context.newPage();
  await Promise.all([page.goto(web), other.goto(web)]);

  const results = await Promise.allSettled([
    page.evaluate(claim, { ride: localRide, userId: A }),
    other.evaluate(claim, {
      ride: { ...localRide, rideId: localRide.rideId.toUpperCase() },
      userId: B,
    }),
  ]);

  expect(
    results.map((result: Readonly<PromiseSettledResult<void>>) => result.status).toSorted(),
  ).toEqual(["fulfilled", "rejected"]);
  const rowsA = await page.evaluate(list, A);
  const rowsB = await page.evaluate(list, B);
  expect(rowsA.length + rowsB.length).toBe(1);
  const winner = winningOwner([...rowsA, ...rowsB]);
  await page.evaluate(claim, {
    ride: { ...localRide, rideId: localRide.rideId.toUpperCase() },
    userId: winner,
  });
  await expect(
    page.evaluate(claim, {
      ride: { ...localRide, metadata: { ...localRide.metadata, routeRevision: "other" } },
      userId: winner,
    }),
  ).rejects.toThrow("unveränderlichen Snapshot");
  await page.reload();
  expect(await page.evaluate(list, winner)).toHaveLength(1);
});

async function capacity(seed: CompletedLocalRide) {
  const { openAccountOutbox } = await import("../src/sync/accountOutboxDatabase.js");
  const { newOutboxRow } = await import("../src/sync/accountOutbox.js");
  const database = await openAccountOutbox();

  const owner = {
    apiOrigin: "http://localhost:3000",
    userId: "00000000-0000-4000-8000-000000000001",
  };

  const rows = Array.from({ length: 20 }, (_, index) =>
    newOutboxRow(
      owner,
      { ...seed, rideId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}` },
      Date.now(),
    ),
  );

  await Promise.all(rows.map((row) => database.claim(row)));
  let failure = "";

  try {
    await database.claim(newOutboxRow(owner, seed, Date.now()));
  } catch (error) {
    failure = error instanceof Error ? error.message : "unexpected";
  }

  return { count: (await database.list(owner)).length, failure };
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the page fixture.
test("sync real IndexedDB caps storage without eviction", async ({ page }) => {
  await page.goto(web);
  expect(await page.evaluate(capacity, localRide)).toEqual({
    count: 20,
    failure: "Kontowarteschlange voll (20 Einträge). Keine Daten gelöscht.",
  });
});

async function crashAndQuota(seed: CompletedLocalRide) {
  const { openAccountOutbox } = await import("../src/sync/accountOutboxDatabase.js");
  const { newOutboxRow } = await import("../src/sync/accountOutbox.js");
  const database = await openAccountOutbox();

  const owner = {
    apiOrigin: "http://localhost:3000",
    userId: "00000000-0000-4000-8000-000000000001",
  };

  const row = newOutboxRow(owner, seed, Date.now());
  await database.claim(row);
  await database.update({ ...row, state: { kind: "sending", attempts: 1, retryAtMs: 0 } });
  const reopened = await openAccountOutbox();
  const recovered = await reopened.list(owner);
  const put = Object.getOwnPropertyDescriptor(IDBObjectStore.prototype, "put");
  IDBObjectStore.prototype.put = () => {
    throw new DOMException("Quota exceeded", "QuotaExceededError");
  };

  let failure = "";

  try {
    await database.claim(
      newOutboxRow(owner, { ...seed, rideId: "00000000-0000-4000-8000-000000000099" }, Date.now()),
    );
  } catch (error) {
    failure = error instanceof Error ? error.message : "unexpected";
  } finally {
    if (put !== undefined) Object.defineProperty(IDBObjectStore.prototype, "put", put);
  }

  return { recovered, failure, count: (await reopened.list(owner)).length };
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the page fixture.
test("sync real IndexedDB recovers sending payload and rejects quota failure without a phantom queue", async ({
  page,
}) => {
  await page.goto(web);
  const result = await page.evaluate(crashAndQuota, localRide);
  expect(result.recovered).toMatchObject([
    { kind: "ride", payload: localRide, state: { kind: "sending", attempts: 1 } },
  ]);
  expect(result.count).toBe(1);
  expect(result.failure).toContain("Quota");
});

async function corrupt(seed: CompletedLocalRide) {
  const { openAccountOutbox } = await import("../src/sync/accountOutboxDatabase.js");
  const { newOutboxRow, outboxKey } = await import("../src/sync/accountOutbox.js");

  const owner = {
    apiOrigin: "http://localhost:3000",
    userId: "00000000-0000-4000-8000-000000000001",
  };

  const outbox = await openAccountOutbox();
  const row = newOutboxRow(owner, seed, Date.now());
  await outbox.claim(row);
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("voltonaut-account-outbox", 1);
    request.addEventListener("success", () => {
      const database = request.result;
      const transaction = database.transaction("outbox", "readwrite");
      const state = { kind: "blocked", cause: "private-data", attempts: 1, retryAtMs: 0 };
      transaction.objectStore("outbox").put({ ...row, state }, [...outboxKey(row)]);
      transaction.addEventListener("complete", () => {
        database.close();
        resolve();
      });
      transaction.addEventListener("error", () => {
        database.close();
        reject(new Error("corruption setup failed"));
      });
    });
    request.addEventListener("error", () => {
      reject(new Error("corruption setup open failed"));
    });
  });

  const listed = await outbox
    .list(owner)
    .then(() => "unexpected success")
    .catch((error: Readonly<Error>) => error.message);

  const claimed = await outbox
    .claim(row)
    .then(() => "unexpected success")
    .catch((error: Readonly<Error>) => error.message);

  return { listed, claimed };
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the Page fixture.
test("sync real IndexedDB rejects corrupted rows without exposing their private values", async ({
  page,
}) => {
  await page.goto(web);
  expect(await page.evaluate(corrupt, localRide)).toEqual({
    listed: "Kontowarteschlange beschädigt. Keine Daten geändert.",
    claimed: "Kontowarteschlange beschädigt. Keine Daten geändert.",
  });
});
