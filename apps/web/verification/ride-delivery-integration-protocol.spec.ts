/// <reference types="node" />
// oxlint-disable typescript/prefer-readonly-parameter-types -- This observer reads the native boundary log without changing it.
import assert from "node:assert/strict";
import { expect, type Page } from "@playwright/test";
import type { RecordingV2 } from "@voltonaut/shared";
import { z } from "../../../packages/shared/node_modules/zod/index.js";
import { save } from "./ride-delivery-integration-runtime.spec.js";

const WriteSchema = z
  .object({ opcode: z.number(), gradePct: z.number().nullable(), atMs: z.number() })
  .readonly();

export async function assertProtocol(page: Page, recording: RecordingV2): Promise<void> {
  const raw = await page.locator("body").getAttribute("data-control-writes");
  const writes = z.array(WriteSchema).parse(JSON.parse(raw ?? "[]"));
  const originMs = await page.evaluate(() => performance.timeOrigin);
  const start = recording.entries.at(recording.window.startSeq);
  const finish = recording.entries.at(recording.window.finishSeq);

  assert.ok(start);
  assert.ok(finish);
  const startMs = recording.initialization.workerTimeOriginMs + start[1];
  const finishMs = recording.initialization.workerTimeOriginMs + finish[1];

  const inWindow = writes.filter(
    (write) =>
      write.opcode === 0x11 &&
      originMs + write.atMs >= startMs &&
      originMs + write.atMs <= finishMs,
  );

  const commands = recording.observations
    .filter((observation) => observation.boundarySeq > recording.window.startSeq)
    .flatMap((observation) => observation.commands);

  expect(inWindow.length).toBeGreaterThanOrEqual(2);
  expect(
    inWindow.every((write) =>
      commands.some(
        (command) =>
          command.type === "simulation" &&
          write.gradePct !== null &&
          Math.abs(command.gradePct - write.gradePct) <= 0.011,
      ),
    ),
  ).toBe(true);
  await save(
    "protocol-window.json",
    JSON.stringify(
      {
        startMs,
        finishMs,
        decodedWrites: inWindow,
        recordedCommands: commands,
        targetsMatchWithinFtmsResolution: true,
      },
      null,
      2,
    ),
  );
}
