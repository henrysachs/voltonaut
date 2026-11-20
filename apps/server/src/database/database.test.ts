import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { expect, it } from "vitest";

import { createTestApp, getDatabase, httpServerOf, bodyOf } from "../testing/test-app.spec.js";
import { createDatabase } from "./drizzle.provider.js";
import { testServerConfig } from "../config.js";

it("creates owned tables, enforces foreign keys and closes on Nest shutdown", async () => {
  const { app } = await createTestApp();
  const db = getDatabase(app);

  const tables = db.$client
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all();

  expect(tables).toEqual(
    ["__drizzle_migrations", "login_tokens", "profiles", "rides", "sessions", "users"].map(
      (name) => ({ name }),
    ),
  );
  expect(db.$client.pragma("foreign_keys", { simple: true })).toBe(1);
  expect(() =>
    db.$client.prepare("INSERT INTO sessions VALUES ('hash', 'missing', 0, 0, 100, NULL)").run(),
  ).toThrow("FOREIGN KEY");
  await app.close();
  expect(db.$client.open).toBe(false);
});

it("persists with WAL, creates the data directory and applies migrations idempotently", async () => {
  const directory = mkdtempSync(join(tmpdir(), "voltonaut-auth-db-"));

  const config = {
    database: { path: join(directory, "data", "auth.db"), migrationsDir: "drizzle" },
  };

  try {
    const first = await createTestApp({ config });
    const db = getDatabase(first.app);
    expect(db.$client.pragma("journal_mode", { simple: true })).toBe("wal");
    const migrations = db.$client.prepare("SELECT * FROM __drizzle_migrations").all();
    expect(migrations).toHaveLength(2);
    db.$client
      .prepare("INSERT INTO users VALUES ('persisted', 'persist@example.com', 0, NULL)")
      .run();
    await first.app.close();
    const second = await createTestApp({ config });
    expect(getDatabase(second.app).$client.prepare("SELECT id FROM users").all()).toEqual([
      { id: "persisted" },
    ]);
    expect(
      getDatabase(second.app).$client.prepare("SELECT * FROM __drizzle_migrations").all(),
    ).toEqual(migrations);
    await second.app.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("fails startup with missing migrations instead of creating an empty application database", () => {
  expect(() =>
    createDatabase(
      testServerConfig({
        database: { path: ":memory:", migrationsDir: "/missing-voltonaut-migrations" },
      }),
    ),
  ).toThrow(/.+/u);
});

it("keeps health public and returns a safe 503 envelope when the database closes", async () => {
  const { app } = await createTestApp();
  await request(httpServerOf(app)).get("/healthz").expect(200);
  getDatabase(app).$client.close();
  const response = await request(httpServerOf(app)).get("/healthz").expect(503);
  expect(bodyOf(response)).toEqual({
    error: { code: "internal_error", message: "database unavailable" },
  });
  await app.close();
});
