import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { Server } from "node:http";
import { createServer } from "node:net";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { createEngine, createRoute, TEST_LOOP } from "@voltonaut/engine";
import {
  DEFAULT_RIDER_PROFILE,
  RecordingV2Schema,
  ReplayEventV2Schema,
  ReplaySnapshotV2Schema,
  type ReplayObservationV2,
  type RideReceipt,
} from "@voltonaut/shared";

export function journalFixture() {
  const engine = createEngine({ route: createRoute(TEST_LOOP), profile: DEFAULT_RIDER_PROFILE });
  engine.ingest({ type: "trainer.data", tS: 0, powerW: 250, cadenceRpm: 90 });
  engine.advance(1);
  engine.ingest({ type: "trainer.data", tS: 1, powerW: 300, cadenceRpm: 80 });

  const start = journalBoundary(engine, 5);
  engine.ingest({ type: "trainer.data", tS: 1, powerW: 300, cadenceRpm: 80 });
  engine.advance(1);

  const finish = journalBoundary(engine, 8);

  return RecordingV2Schema.parse({
    schemaVersion: 2,
    rideId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    initializedAt: "2026-11-20T12:00:00.000Z",
    initialization: {
      physicsRevision: "engine-v1",
      routeId: "test-loop",
      routeRevision: "1",
      profile: DEFAULT_RIDER_PROFILE,
      source: "ble",
      clockScale: 1,
      workerTimeOriginMs: 1795176000000,
      initializedWorkerMs: 0,
    },
    journalState: "complete",
    entries: [
      [0, 0, "arm"],
      [1, 0, "status", "trainer", "ready"],
      [2, 0, "trainer", 250, 90, null],
      [3, 1000, "advance", 1],
      [4, 1000, "trainer", 300, 80, null],
      [5, 1000, "boundary", "start"],
      [6, 1000, "trainer", 300, 80, null],
      [7, 2000, "advance", 1],
      [8, 2000, "boundary", "finish"],
    ],
    window: { startSeq: 5, finishSeq: 8 },
    observations: [start, finish],
  });
}

function journalBoundary(
  engine: Readonly<ReturnType<typeof createEngine>>,
  boundarySeq: number,
): ReplayObservationV2 {
  const {
    worldPos: _position,
    headingRad: _heading,
    trainerMode: _mode,
    mode: _rideMode,
    gear,
    hrBpm,
    ...snapshot
  } = engine.snapshot();

  return {
    boundarySeq,
    snapshot: ReplaySnapshotV2Schema.parse({
      ...snapshot,
      gearIndex: gear.index,
      gearRatio: gear.ratio,
      hrBpm: hrBpm ?? null,
    }),
    events: engine.drainEvents().map((event) => ReplayEventV2Schema.parse(event)),
    commands: engine.drainCommands(),
    gap: false,
  };
}

export async function unusedPort(): Promise<number> {
  const listener = createServer();

  await new Promise<void>((done) => {
    listener.listen(0, "127.0.0.1", done);
  });
  const address = z.object({ port: z.number() }).parse(listener.address());

  await new Promise<void>((done) => {
    listener.close(() => {
      done();
    });
  });

  return address.port;
}

interface DrainRequest {
  readonly resume: () => void;
}

interface DroppedResponse {
  readonly destroy: () => void;
}

async function forwardJournal(
  baseUrl: string,
  headers: Readonly<Record<string, string>>,
  response: DroppedResponse,
): Promise<boolean> {
  try {
    const backend = await fetch(`${baseUrl}/v2/rides`, {
      method: "POST",
      headers,
      body: JSON.stringify(journalFixture()),
    });

    await backend.arrayBuffer();
    response.destroy();

    return backend.status === 200;
  } catch {
    response.destroy();

    return false;
  }
}

/** Local relay commits the API request, then drops its entire reply to the caller. */
export async function loseJournalReply(
  baseUrl: string,
  headers: Readonly<Record<string, string>>,
): Promise<void> {
  const relay = new Server();

  const committed = new Promise<boolean>((resolve) => {
    relay.on("request", (request: DrainRequest, response: DroppedResponse) => {
      request.resume();
      void forwardJournal(baseUrl, headers, response).then(resolve);
    });
  });

  await new Promise<void>((done) => {
    relay.listen(0, "127.0.0.1", done);
  });
  const address = z.object({ port: z.number() }).parse(relay.address());

  try {
    await assert.rejects(
      fetch(`http://127.0.0.1:${address.port}/lost-reply`, {
        method: "POST",
        signal: AbortSignal.timeout(3000),
      }),
      /fetch failed/u,
    );
    assert.equal(await committed, true, "API committed before the relay lost its reply");
  } finally {
    relay.closeAllConnections();
    await new Promise<void>((done) => {
      relay.close(() => {
        done();
      });
    });
  }
}

const PersistedJournalSchema = z.object({
  payload_hash: z.string(),
  receipt_json: z.string(),
  export_tcx: z.string(),
  export_hash: z.string(),
  export_version: z.literal("tcx-1"),
  summary_json: z.string(),
});

export async function verifyJournal(
  db: Readonly<Pick<DatabaseSync, "prepare">>,
  temporary: string,
  receipt: Readonly<RideReceipt>,
): Promise<void> {
  z.object({ count: z.literal(2) }).parse(db.prepare("SELECT count(*) AS count FROM rides").get());

  const saved = PersistedJournalSchema.parse(
    db
      .prepare(
        "SELECT payload_hash, receipt_json, export_tcx, export_hash, export_version, summary_json FROM rides WHERE id = ?",
      )
      .get(receipt.rideId),
  );

  assert.deepEqual(JSON.parse(saved.receipt_json), receipt);
  assert.equal(
    saved.payload_hash,
    createHash("sha256").update(JSON.stringify(journalFixture())).digest("hex"),
  );
  assert.equal(saved.export_tcx.includes("<ax:Watts>300</ax:Watts>"), true);
  assert.equal(saved.export_tcx.includes("<TotalTimeSeconds>1</TotalTimeSeconds>"), true);
  assert.equal(saved.export_tcx.includes("<Position>"), false);
  assert.equal(
    saved.export_hash,
    Buffer.from(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(saved.export_tcx)),
    ).toString("hex"),
  );
  writeFileSync(join(temporary, "journal-receipt.json"), saved.receipt_json);
  writeFileSync(join(temporary, "journal.tcx"), saved.export_tcx);
  writeFileSync(join(temporary, "journal-raw.json"), JSON.stringify(journalFixture()));
  writeFileSync(
    join(temporary, "proof.json"),
    JSON.stringify({
      compiledServer: true,
      localHttpOnly: true,
      restart: true,
      lostReply: true,
      policy: "declared_ble_v1",
      payloadHash: saved.payload_hash,
      exportHash: saved.export_hash,
      exportVersion: saved.export_version,
    }),
  );
}
