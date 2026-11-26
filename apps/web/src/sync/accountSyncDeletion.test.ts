import { expect, it } from "vitest";
import { DEFAULT_RIDER_PROFILE, type AccountExport } from "@voltonaut/shared";
import { newOutboxRow } from "./accountOutbox.js";
import { deletionOwnerKey } from "./accountDeletion.js";
import { deferred } from "./testdata/deferred.js";
import { localRide } from "./testdata/localRide.js";
import { journalRide } from "./testdata/journal.js";
import { A, B, accountExport, fixture } from "./testdata/accountSyncFixture.js";

it("invalidates the lease and purges only the deleted owner's outbox rows", async () => {
  const f = fixture();
  const lease = f.login(A);
  await f.sync.refresh();
  const own = newOutboxRow(lease, localRide, 1000);
  const foreign = newOutboxRow({ userId: B, apiOrigin: lease.apiOrigin }, journalRide, 1000);

  const otherOrigin = newOutboxRow(
    { userId: A, apiOrigin: "http://localhost:4000" },
    DEFAULT_RIDER_PROFILE,
    1000,
  );

  await f.write(own);
  await f.write(foreign);
  await f.write(otherOrigin);

  await expect(f.sync.deleteAccount(`${A}@example.com`)).resolves.toBe(true);
  expect(f.sessionEnded).toBe(true);
  expect(f.active).toBeUndefined();
  expect(f.purged).toEqual([{ apiOrigin: lease.apiOrigin, userId: A }]);
  expect(f.progressPurged).toEqual([{ apiOrigin: lease.apiOrigin, userId: A }]);
  expect([...f.rows.values()].map((row) => row.userId)).toEqual([B, A]);
  expect([...f.rows.values()].map((row) => row.apiOrigin)).toEqual([
    lease.apiOrigin,
    "http://localhost:4000",
  ]);
  expect(f.pendingDeletions.size).toBe(0);
  expect(JSON.stringify(f.sync.view())).toContain("Konto gelöscht");
});

it("keeps local data and the session when server deletion is not confirmed", async () => {
  const f = fixture();
  const lease = f.login(A);
  await f.sync.refresh();
  await f.write(newOutboxRow(lease, localRide, 1000));
  f.deletionFailure = true;

  await expect(f.sync.deleteAccount(`${A}@example.com`)).resolves.toBe(false);
  expect(f.sessionEnded).toBe(false);
  expect(f.active).toBe(lease);
  expect(f.purged).toEqual([]);
  expect(f.progressPurged).toEqual([]);
  expect(f.rows.size).toBe(1);
  expect(JSON.stringify(f.sync.view())).toContain("nicht bestätigt");
});

it("keeps the cleanup intent until the progress outbox is purged too", async () => {
  const f = fixture();
  const lease = f.login(A);
  const owner = { apiOrigin: lease.apiOrigin, userId: A };
  await f.sync.refresh();
  await f.write(newOutboxRow(lease, localRide, 1000));
  f.progressPurgeFailure = true;

  await expect(f.sync.deleteAccount(`${A}@example.com`)).resolves.toBe(true);
  expect(f.rows.size).toBe(0);
  expect(f.progressPurged).toEqual([]);
  expect(f.pendingDeletions.has(deletionOwnerKey(owner))).toBe(true);
  expect(JSON.stringify(f.sync.view())).toContain("für einen späteren Versuch vermerkt");

  f.progressPurgeFailure = false;
  await f.sync.recoverDeletions();
  expect(f.progressPurged).toEqual([owner]);
  expect(f.pendingDeletions.size).toBe(0);
});

it("durably retries a local cleanup that failed after confirmed server deletion", async () => {
  const f = fixture();
  const lease = f.login(A);
  await f.sync.refresh();
  await f.write(newOutboxRow(lease, localRide, 1000));
  f.purgeFailure = true;

  await expect(f.sync.deleteAccount(`${A}@example.com`)).resolves.toBe(true);
  expect(f.pendingDeletions.has(deletionOwnerKey({ apiOrigin: lease.apiOrigin, userId: A }))).toBe(
    true,
  );
  expect(f.rows.size).toBe(1);
  f.purgeFailure = false;
  await f.sync.recoverDeletions();
  expect(f.rows.size).toBe(0);
  expect(f.pendingDeletions.size).toBe(0);
});

it("does not return a late export after the owning session ends", async () => {
  const f = fixture();
  const response = deferred<AccountExport>();
  f.login(A);
  f.exportResponse = response.promise;
  const exporting = f.sync.exportAccount();
  f.logout();
  response.resolve(accountExport);
  await expect(exporting).resolves.toBeUndefined();
});

it("reports a failed export without promising a retry window", async () => {
  const f = fixture();
  f.login(A);
  f.exportFailure = true;

  await expect(f.sync.exportAccount()).resolves.toBeUndefined();
  expect(JSON.stringify(f.sync.view())).toContain(
    "Datenexport nicht bestätigt. Keine Datei erzeugt; Verbindung und Anmeldung prüfen.",
  );
  expect(JSON.stringify(f.sync.view())).not.toContain("Minute");
});

it("names the rate limit and its wait when the server answers 429", async () => {
  const f = fixture();
  f.login(A);
  f.exportRateLimitS = 42;

  await expect(f.sync.exportAccount()).resolves.toBeUndefined();
  expect(JSON.stringify(f.sync.view())).toContain(
    "Datenexport ist nur einmal pro Minute möglich. Neuer Versuch in 42 s. Keine Datei erzeugt.",
  );
});

it("reports a persisted session that could not be removed after confirmed deletion", async () => {
  const f = fixture();
  const lease = f.login(A);
  await f.sync.refresh();
  await f.write(newOutboxRow(lease, localRide, 1000));
  f.sessionClearResult = false;

  await expect(f.sync.deleteAccount(`${A}@example.com`)).resolves.toBe(true);
  expect(f.rows.size).toBe(0);
  expect(JSON.stringify(f.sync.view())).toContain("Lokale Session konnte nicht entfernt werden");
});
