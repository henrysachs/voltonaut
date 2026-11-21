import { createEventBus } from "@voltonaut/shared";
import { expect, it } from "vitest";
import { createManualClock } from "../sim/clock.js";
import { createManualTicker } from "../sim/tick.js";
import { createFakeTrainer } from "../sim/fakeTrainer.js";
import { createSimScript } from "../sim/sample.js";
import { settle } from "./controlTestRig.js";

it("Sim uses the production control/ACK state machine, never implicit success on connect", async () => {
  const clock = createManualClock();
  const ticker = createManualTicker();

  const trainer = createFakeTrainer({
    bus: createEventBus(),
    clock,
    ticker,
    samples: createSimScript([{ powerW: 200, cadenceRpm: 90, heartRateBpm: 120, gearIndex: 11 }]),
  });

  await trainer.connect();
  expect(trainer.control.view().authority.kind).toBe("inactive");
  expect(trainer.control.view().acknowledged).toBeUndefined();
  await trainer.control.enable();
  expect(trainer.control.view().authority.kind).toBe("active");
  expect(trainer.control.view().acknowledged?.gradePct).toBe(0);
  clock.advanceS(0.25);
  ticker.tick();
  trainer.control.submit({
    type: "simulation",
    gradePct: 4,
    windMps: 0,
    crr: 0.004,
    cwKgPerM: 0.51,
  });
  await settle();
  expect(trainer.control.view().acknowledged?.gradePct).toBe(4);
  await trainer.disconnect();
  await trainer.connect();
  expect(trainer.control.view().authority.kind).toBe("inactive");
  expect(trainer.control.view().acknowledged).toBeUndefined();
  await trainer.disconnect();
});
