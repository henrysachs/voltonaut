import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("/app/data/voltonaut.db");

db.exec("PRAGMA foreign_keys = ON");

assert.ok(process.getuid);

assert.equal(process.getuid(), 1000, "proof runs as the image's node user");

assert.equal(statSync("/app/data/voltonaut.db").uid, 1000, "server owns SQLite");

const journalMode = db.prepare("PRAGMA journal_mode").get();

assert.ok(journalMode);

assert.equal(journalMode["journal_mode"], "wal");

const migrationPrefixes = readdirSync("/app/drizzle")
  .flatMap((file) => (file.endsWith(".sql") ? [file.slice(0, 4)] : []))
  .toSorted();

assert.deepEqual(migrationPrefixes.slice(0, 3), ["0000", "0001", "0002"]);

const appliedMigrations = db.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get();

assert.ok(appliedMigrations);

assert.equal(appliedMigrations["n"], migrationPrefixes.length);

async function request(
  path: string,
  token: string,
  method: "GET" | "PUT" | "POST",
  body?: string,
  expectedStatus = 200,
): Promise<string> {
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  const options =
    method === "GET" || body === undefined ? { method, headers } : { method, headers, body };

  const response = await fetch(`http://127.0.0.1:3000${path}`, {
    ...options,
    signal: AbortSignal.timeout(5000),
  });

  assert.equal(response.status, expectedStatus, `${method} ${path}`);

  return response.text();
}

function save(name: string, value: string): void {
  writeFileSync(`/proof/${name}`, value, { mode: 0o600 });
}

function read(name: string): string {
  return readFileSync(`/proof/${name}`, "utf8");
}

function createOwner() {
  return { userId: randomUUID(), token: randomBytes(32).toString("hex") };
}

if (process.argv[2] === "seed") {
  const nowMs = Date.now();

  const owners: readonly [ReturnType<typeof createOwner>, ReturnType<typeof createOwner>] = [
    createOwner(),
    createOwner(),
  ];

  for (const owner of owners) {
    db.prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)").run(
      owner.userId,
      `${randomUUID()}@example.invalid`,
      nowMs,
    );
    db.prepare(
      "INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    ).run(
      createHash("sha256").update(owner.token).digest("hex"),
      owner.userId,
      nowMs,
      nowMs,
      nowMs + 86_400_000,
    );
  }

  const [owner, other] = owners;

  const profile = {
    displayName: "Local restore proof",
    massKg: 75,
    heightCm: 185,
    bike: { massKg: 8, chainringTeeth: 42, cogTeeth: 14, wheelCircM: 2.105 },
    gearPreset: "zwift-like-24",
    units: "metric",
  };

  const ride = {
    schemaVersion: 1,
    rideId: randomUUID(),
    startedAt: new Date(nowMs).toISOString(),
    metadata: {
      source: "sim",
      routeId: "test-loop",
      routeRevision: "1",
      physicsClockScale: 1,
      profile,
    },
    samples: [
      { elapsedMs: 0, distanceM: 0, powerW: 150, cadenceRpm: 80, gap: false },
      { elapsedMs: 1000, distanceM: 5, powerW: 150, cadenceRpm: 80, gap: false },
    ],
  };

  save("token", owner.token);
  save("other-token", other.token);
  save("ride-id", ride.rideId);
  save("ride", JSON.stringify(ride));
  save("profile", await request("/v1/me/profile", owner.token, "PUT", JSON.stringify(profile)));
  save("receipt", await request("/v2/rides", owner.token, "POST", JSON.stringify(ride)));
  save("detail", await request(`/v2/rides/${ride.rideId}`, owner.token, "GET"));
  await Promise.all(
    [owner.token, other.token].map(async (token, index) => {
      save(`me-${index}`, await request("/v1/me", token, "GET"));
    }),
  );
} else {
  assert.equal(process.argv[2], "verify");
  const token = read("token");
  const otherToken = read("other-token");
  const rideId = read("ride-id");
  const ride = read("ride");
  await Promise.all(
    [token, otherToken].map(async (session, index) => {
      assert.equal(await request("/v1/me", session, "GET"), read(`me-${index}`));
    }),
  );
  assert.equal(await request("/v1/me/profile", token, "GET"), read("profile"));
  assert.equal(await request(`/v2/rides/${rideId}`, token, "GET"), read("detail"));
  assert.equal(await request("/v2/rides", token, "POST", ride), read("receipt"));
  await request(
    "/v2/rides",
    token,
    "POST",
    ride.replace(/"startedAt":"[^"]+"/u, '"startedAt":"2026-01-01T00:00:00.000Z"'),
    409,
  );
  await request(`/v2/rides/${rideId}`, otherToken, "GET", undefined, 404);
  const accounts = db.prepare("SELECT count(*) AS n FROM users").get();
  assert.ok(accounts);
  assert.equal(accounts["n"], 2);
  const sessions = db.prepare("SELECT count(*) AS n FROM sessions").get();
  assert.ok(sessions);
  assert.equal(sessions["n"], 2);
  const profiles = db.prepare("SELECT count(*) AS n FROM profiles").get();
  assert.ok(profiles);
  assert.equal(profiles["n"], 1);
  const rides = db.prepare("SELECT count(*) AS n FROM rides").get();
  assert.ok(rides);
  assert.equal(rides["n"], 1);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  assert.throws(
    () =>
      db
        .prepare("INSERT INTO profiles (user_id, profile_json, updated_at) VALUES (?, '{}', 0)")
        .run(randomUUID()),
    /FOREIGN KEY/u,
  );
  process.stdout.write(
    "Persisted accounts, sessions, profile, ride, receipt, idempotency, ownership and foreign keys verified.\n",
  );
}

db.close();
