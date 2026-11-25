import { createEventBus, type DeviceEvent } from "@voltonaut/shared";
import { expect, it } from "vitest";

import { createRideDeviceSet } from "../devices.js";
import { settle } from "../ftms/controlTestRig.js";
import { createSimTrainerPeripheral } from "../ftms/simTrainer.js";
import { createSimStrapPeripheral } from "../hrs/simStrap.js";
import { createManualClock } from "./clock.js";
import { createSimScript } from "./sample.js";
import { createManualTicker } from "./tick.js";
import { createSimTransport } from "./transport.js";

const TWO_SAMPLES = createSimScript([
  { powerW: 200, cadenceRpm: 90, heartRateBpm: 120 },
  { powerW: 150, cadenceRpm: 80, heartRateBpm: 110 },
]);

function rig() {
  const bus = createEventBus();
  const clock = createManualClock();
  const ticker = createManualTicker();
  const trainerData: DeviceEvent[] = [];
  const heartRateData: DeviceEvent[] = [];
  const trainer = createSimTransport(createSimTrainerPeripheral({ ticker, samples: TWO_SAMPLES }));
  const strap = createSimTransport(createSimStrapPeripheral({ ticker, samples: TWO_SAMPLES }));

  bus.subscribe("trainer.data", (event) => {
    trainerData.push(event);
  });
  bus.subscribe("hr.data", (event) => {
    heartRateData.push(event);
  });

  return {
    ...createRideDeviceSet({
      bus,
      clock,
      ticker,
      clockScale: 1,
      transports: { trainer, heartRate: strap, play: [] },
    }),
    strap,
    trainerData,
    heartRateData,
    async tick(times: number): Promise<void> {
      if (times === 0) return;
      clock.advanceS(0.25);
      ticker.tick();
      await settle();
      await this.tick(times - 1);
    },
  };
}

it("sim peripherals cycle through the script and wrap around", async () => {
  const r = rig();
  await Promise.all([r.trainer.connect(), r.heartRate.connect()]);
  await r.tick(3);

  expect(r.trainerData).toEqual([
    { type: "trainer.data", tS: 0.25, powerW: 200, cadenceRpm: 90 },
    { type: "trainer.data", tS: 0.5, powerW: 150, cadenceRpm: 80 },
    { type: "trainer.data", tS: 0.75, powerW: 200, cadenceRpm: 90 },
  ]);
  expect(r.heartRateData).toEqual([
    { type: "hr.data", tS: 0.25, bpm: 120 },
    { type: "hr.data", tS: 0.5, bpm: 110 },
    { type: "hr.data", tS: 0.75, bpm: 120 },
  ]);
});

it("sim peripherals stop notifying after disconnect", async () => {
  const r = rig();
  await Promise.all([r.trainer.connect(), r.heartRate.connect()]);
  await r.tick(1);
  await Promise.all([r.trainer.disconnect(), r.heartRate.disconnect()]);
  await r.tick(4);

  expect(r.trainer.status()).toBe("disconnected");
  expect(r.heartRate.status()).toBe("disconnected");
  expect(r.trainerData).toHaveLength(1);
  expect(r.heartRateData).toHaveLength(1);
});

it("an unexpected sim link loss runs the shell's reconnect schedule", async () => {
  const r = rig();
  await r.heartRate.connect();
  r.strap.drop();
  expect(r.heartRate.status()).toBe("reconnecting");
  await r.tick(4);
  expect(r.heartRate.status()).toBe("ready");
});

it("the sim transport rejects a scan for services the peripheral lacks", async () => {
  const transport = createSimTransport(
    createSimStrapPeripheral({ ticker: createManualTicker(), samples: TWO_SAMPLES }),
  );

  await expect(
    transport.connect({
      acceptAllDevices: false,
      filters: [{ services: ["0000fff0-0000-1000-8000-00805f9b34fb"] }],
      optionalServices: [],
    }),
  ).rejects.toThrow("no sim device matches");
});
