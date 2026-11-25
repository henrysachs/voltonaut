import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { expect, it, onTestFinished, vi } from "vitest";
import type { ServerDatabase } from "../database/drizzle.provider.js";
import { headMigrations, seedOwners, upgradeFrom } from "./migration-harness.spec.js";

// These probes share state across tests and must run in file order (vitest's default).
const order: string[] = [];

let leftDirectory = "";
let leftDb: ServerDatabase | undefined;
let directoryExistedAtClose: boolean | undefined;

it("registers two onTestFinished hooks", () => {
  expect(order).toEqual([]);
  onTestFinished(() => {
    order.push("registered first");
  });
  onTestFinished(() => {
    order.push("registered second");
  });
});

it("ran the onTestFinished hooks last-registered first", () => {
  expect(order).toEqual(["registered second", "registered first"]);
});

it("upgrades a seeded database from a named tag to the journal head", () => {
  const upgrade = upgradeFrom("0000_steep_trish_tilby", (old) => {
    seedOwners(old, [{ id: "owner" }]);

    return old.$client.prepare("SELECT id, email FROM users").all();
  });

  const db = upgrade.open();
  expect(db.$client.prepare("SELECT id, email FROM users").all()).toEqual(upgrade.seeded);
  expect(headMigrations().length).toBeGreaterThan(1);
  leftDirectory = dirname(upgrade.path);
  leftDb = db;

  // Records the directory state at the moment the harness closes the left-open connection.
  const close = db.$client.close.bind(db.$client);
  vi.spyOn(db.$client, "close").mockImplementation(() => {
    directoryExistedAtClose = existsSync(leftDirectory);

    return close();
  });
});

it("closed the left-open connection before removing its directory", () => {
  expect(directoryExistedAtClose).toBe(true);
  expect(leftDb?.$client.open).toBe(false);
  expect(leftDirectory).not.toBe("");
  expect(existsSync(leftDirectory)).toBe(false);
});

it("rejects an unknown migration tag", () => {
  expect(() => upgradeFrom("9999_missing", () => null)).toThrow(
    "test: unknown migration tag 9999_missing",
  );
});
