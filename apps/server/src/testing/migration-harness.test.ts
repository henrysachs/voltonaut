import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import type { ServerDatabase } from "../database/drizzle.provider.js";
import { headMigrations, seedOwners, upgradeFrom } from "./migration-harness.spec.js";

const order: string[] = [];

let leftDirectory = "";
let leftDb: ServerDatabase | undefined;

it("runs onTestFinished hooks last-registered first", () => {
  expect(order).toEqual([]);
  onTestFinished(() => {
    order.push("registered first");
  });
  onTestFinished(() => {
    order.push("registered second");
  });
});

it("relies on that order to close connections before removing the directory", () => {
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
});

it("closed the left-open connection and removed its directory after the previous test", () => {
  expect(leftDb?.$client.open).toBe(false);
  expect(leftDirectory).not.toBe("");
  expect(existsSync(leftDirectory)).toBe(false);
});

it("rejects an unknown migration tag", () => {
  expect(() => upgradeFrom("9999_missing", () => null)).toThrow(
    "test: unknown migration tag 9999_missing",
  );
});
