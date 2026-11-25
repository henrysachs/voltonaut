import { expect, it } from "vitest";

import { createProgressOutboxDatabase } from "./progressOutboxDatabase.js";
import {
  MemoryOutboxDatabase,
  checkpoint,
  fence,
  owner,
  requireAppendedRow,
  requireValue,
  userB,
} from "./progressOutboxTestdata.js";

it("resumes the same owner after reload under a new browser generation", async () => {
  const memory = new MemoryOutboxDatabase();
  const outbox = createProgressOutboxDatabase(memory);
  const first = requireAppendedRow(await outbox.append(fence(), checkpoint()));

  expect(await outbox.append(fence(), checkpoint())).toEqual({
    kind: "stored",
    rows: [first],
  });

  const reloaded = createProgressOutboxDatabase(memory);

  const second = requireAppendedRow(
    await reloaded.append(
      fence({ sessionGeneration: 2 }),
      checkpoint({ sequence: 1, startTick: 1 }),
    ),
  );

  expect(second.phase).toBe("open");
  expect(second.sessionGeneration).toBe(2);
  expect(second.payload.sessionGeneration).toBe(2);
  expect(second.payload.checkpoints.map((entry) => entry.sequence)).toEqual([0, 1]);

  const sealed = requireValue(await reloaded.seal(fence({ sessionGeneration: 2 })));

  const sending = await reloaded.markSending({
    row: sealed,
    fence: fence({ sessionGeneration: 2 }),
    nowMs: 1000,
    manual: false,
  });

  expect(sending.state.kind).toBe("sending");

  expect(await reloaded.listPending({ ...owner, userId: userB })).toEqual([]);
  expect(await reloaded.listPending({ ...owner, apiOrigin: "http://localhost:4000" })).toEqual([]);
  await expect(
    reloaded.markSending({
      row: sealed,
      fence: fence({ ...owner, userId: userB, sessionGeneration: 2 }),
      nowMs: 1000,
      manual: false,
    }),
  ).rejects.toMatchObject({ cause: "owner" });
});

it("aborts a write when the old browser generation stops being current", async () => {
  const memory = new MemoryOutboxDatabase();
  const outbox = createProgressOutboxDatabase(memory);
  let checks = 0;

  const stale = fence({
    current: () => {
      checks += 1;

      return checks < 3;
    },
  });

  await expect(outbox.append(stale, checkpoint())).rejects.toMatchObject({ cause: "session" });
  expect(memory.raw()).toEqual([]);
});

it("filters simulation and missing consent and aborts a revoked transaction signal", async () => {
  const memory = new MemoryOutboxDatabase();
  const outbox = createProgressOutboxDatabase(memory);

  expect(await outbox.append(fence(), checkpoint({ source: "sim" }))).toEqual({
    kind: "ignored",
    reason: "sim",
  });
  expect(await outbox.append(fence({ consentVersion: 0 }), checkpoint())).toEqual({
    kind: "ignored",
    reason: "consent",
  });

  const controller = new AbortController();
  const pending = outbox.append(fence({ signal: controller.signal }), checkpoint());
  controller.abort();
  await expect(pending).rejects.toMatchObject({ cause: "session" });
  expect(memory.raw()).toEqual([]);
});

it("rejects corrupted persisted rows without changing or exposing them", async () => {
  const memory = new MemoryOutboxDatabase();
  const outbox = createProgressOutboxDatabase(memory);
  const row = requireAppendedRow(await outbox.append(fence(), checkpoint({ paused: true })));
  const corrupted = { ...row, sessionToken: "not-allowed" };
  memory.seed(corrupted);

  await expect(outbox.listPending(owner)).rejects.toMatchObject({ cause: "corrupt" });
  await expect(
    outbox.append(fence(), checkpoint({ sequence: 1, startTick: 1 })),
  ).rejects.toMatchObject({ cause: "corrupt" });
  expect(memory.raw()).toEqual([corrupted]);
});
