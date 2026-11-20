import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout } from "node:timers/promises";
import { z } from "zod";

import {
  DEFAULT_RIDER_PROFILE,
  ProfileStateSchema,
  RideDetailSchema,
  RideReceiptSchema,
} from "../../../packages/shared/dist/index.js";

const directory = resolve(process.argv[2] ?? "apps/server");
const temporary = mkdtempSync(join(tmpdir(), "voltonaut-process-rides-"));
const databasePath = join(temporary, "rides.db");

const environment = {
  PATH: process.env["PATH"],
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  DATABASE_PATH: databasePath,
  MAIL_PROVIDER: "memory",
};

const token = crypto.randomUUID();
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

const recording = {
  schemaVersion: 1,
  rideId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  startedAt: "2026-11-20T10:00:00.000Z",
  metadata: {
    source: "sim",
    routeId: "test-loop",
    routeRevision: "1",
    physicsClockScale: 1,
    profile: DEFAULT_RIDER_PROFILE,
  },
  samples: [
    { elapsedMs: 0, distanceM: 0, powerW: 150, cadenceRpm: 80, gap: false },
    { elapsedMs: 1000, distanceM: 5, powerW: 150, cadenceRpm: 80, gap: false },
  ],
};

async function unusedPort(): Promise<number> {
  const listener = createServer();

  await new Promise<void>((done) => {
    listener.listen(0, "127.0.0.1", done);
  });

  const address = z.object({ port: z.number() }).parse(listener.address());
  const port = address.port;

  await new Promise<void>((done) => {
    listener.close(() => {
      done();
    });
  });

  return port;
}

async function startServer() {
  const port = await unusedPort();

  const server = spawn(process.execPath, ["dist/main.js"], {
    cwd: directory,
    env: { ...environment, PORT: `${port}` },
    stdio: "ignore",
  });

  const exited = new Promise<void>((done) => {
    server.once("exit", () => {
      done();
    });
  });

  const baseUrl = `http://127.0.0.1:${port}`;

  async function ready(attempt = 0): Promise<void> {
    try {
      assert.equal((await fetch(`${baseUrl}/healthz`)).status, 200);
    } catch {
      assert.equal(server.exitCode, null, "built server stays alive");
      assert.ok(attempt < 100, "built server starts within five seconds");
      await setTimeout(50);
      await ready(attempt + 1);
    }
  }

  try {
    await ready();
  } catch (error) {
    server.kill("SIGTERM");
    await exited;
    throw error;
  }

  return {
    baseUrl,
    stop: async () => {
      server.kill("SIGTERM");
      await exited;
    },
  };
}

async function seedSession(): Promise<void> {
  const db = new DatabaseSync(databasePath);
  const nowMs = Date.now();

  const hash = Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
  ).toString("hex");

  try {
    db.prepare(
      "INSERT INTO users (id, email, created_at) VALUES ('process-user', 'process@example.com', ?)",
    ).run(nowMs);
    db.prepare(
      "INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, 'process-user', ?, ?, ?)",
    ).run(hash, nowMs, nowMs, nowMs + 60_000);
  } finally {
    db.close();
  }
}

async function upload(baseUrl: string, rideId: string = recording.rideId) {
  const response = await fetch(`${baseUrl}/v1/rides`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ ...recording, rideId }),
  });

  assert.equal(response.status, 200);

  const body: unknown = await response.json();

  assert.deepEqual(body, {
    rideId: recording.rideId,
    storage: "stored",
    assessment: { status: "unverified", reason: "legacy_missing_replay" },
  });

  return RideReceiptSchema.parse(body);
}

async function writeInitialState() {
  const first = await startServer();

  try {
    await seedSession();
    const receipt = await upload(first.baseUrl, recording.rideId.toUpperCase());

    const plainText = await fetch(`${first.baseUrl}/v1/rides`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "text/plain" },
      body: JSON.stringify(recording),
    });

    assert.equal(plainText.status, 415);

    const response = await fetch(`${first.baseUrl}/v1/me/profile`, {
      method: "PUT",
      headers,
      body: JSON.stringify(DEFAULT_RIDER_PROFILE),
    });

    assert.equal(response.status, 200);
    ProfileStateSchema.parse(await response.json());

    return receipt;
  } finally {
    await first.stop();
  }
}

try {
  const original = await writeInitialState();
  const second = await startServer();

  try {
    assert.deepEqual(await upload(second.baseUrl), original);

    const detail = await fetch(`${second.baseUrl}/v1/rides/${recording.rideId.toUpperCase()}`, {
      headers,
    });

    const profile = await fetch(`${second.baseUrl}/v1/me/profile`, { headers });

    assert.equal(detail.status, 200);
    assert.equal(profile.status, 200);
    assert.deepEqual(RideDetailSchema.parse(await detail.json()), {
      recording,
      assessment: original.assessment,
    });
    assert.equal(ProfileStateSchema.parse(await profile.json()).status, "present");

    const db = new DatabaseSync(databasePath);

    try {
      z.object({ count: z.literal(1) }).parse(
        db.prepare("SELECT count(*) AS count FROM rides").get(),
      );
    } finally {
      db.close();
    }

    process.stdout.write(
      "Built-process restart passed. Canonical UUID aliases keep one recording and receipt across SIGTERM. Profile and bearer ownership persist. Plain-text JSON is 415; JSON charset works. Local HTTP only.\n",
    );
  } finally {
    await second.stop();
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
