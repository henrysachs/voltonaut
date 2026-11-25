import { createEventBus, type DeviceEvent } from "@voltonaut/shared";
import { describe, expect, it } from "vitest";

import { createRideDeviceSet, type DeviceTransports, type RideDeviceSet } from "./devices.js";
import type { SimulationCommand } from "./ftms/controlCodec.js";
import { settle } from "./ftms/controlTestRig.js";
import { createSimTrainerPeripheral } from "./ftms/simTrainer.js";
import { createSimStrapPeripheral } from "./hrs/simStrap.js";
import {
  createManualClock,
  createManualTicker,
  createSimScript,
  createSimTransport,
  type SimPeripheral,
} from "./sim/index.js";
import { createPeripheralCentral } from "./testdata/peripheralCentral.js";
import { createWebBluetoothTransport } from "./webBluetoothTransport.js";

const SAMPLES = createSimScript([{ powerW: 200, cadenceRpm: 90, heartRateBpm: 120 }]);

const CLIMB: SimulationCommand = {
  type: "simulation",
  gradePct: 4,
  windMps: 0,
  crr: 0.004,
  cwKgPerM: 0.51,
};

interface Peripherals {
  readonly trainer: SimPeripheral;
  readonly heartRate: SimPeripheral;
}

/** Records every opcode written to the trainer; both transports reach the same peripheral. */
function recorded(peripheral: SimPeripheral) {
  const writes: number[] = [];

  return {
    writes: (): readonly number[] => writes,
    peripheral: {
      ...peripheral,
      write(ref, payload, link) {
        writes.push(payload.at(0) ?? -1);
        peripheral.write?.(ref, payload, link);
      },
    } satisfies SimPeripheral,
  };
}

const TRANSPORTS = [
  {
    name: "sim transport",
    transports: (peripherals: Peripherals): DeviceTransports => ({
      trainer: createSimTransport(peripherals.trainer),
      heartRate: createSimTransport(peripherals.heartRate),
      play: [],
    }),
  },
  {
    name: "test central",
    transports: (peripherals: Peripherals): DeviceTransports => {
      const central = createPeripheralCentral([peripherals.trainer, peripherals.heartRate]);

      return {
        trainer: createWebBluetoothTransport({ central }),
        heartRate: createWebBluetoothTransport({ central }),
        play: [],
      };
    },
  },
];

type Source = (typeof TRANSPORTS)[number];

interface Rig extends RideDeviceSet {
  readonly writes: () => readonly number[];
  readonly data: readonly DeviceEvent[];
  readonly trainerStatus: readonly string[];
  readonly tick: (s: number) => Promise<void>;
}

function rig(source: Readonly<Source>, clockScale = 1): Rig {
  const bus = createEventBus();
  const clock = createManualClock();
  const ticker = createManualTicker();
  const trainer = recorded(createSimTrainerPeripheral({ ticker, samples: SAMPLES }));
  const data: DeviceEvent[] = [];
  const trainerStatus: string[] = [];

  const record = (event: DeviceEvent): void => {
    data.push(event);
  };

  bus.subscribe("trainer.data", record);
  bus.subscribe("hr.data", record);
  bus.subscribe("device.status", (event) => {
    if (event.type === "device.status" && event.kind === "trainer")
      trainerStatus.push(event.status);
  });

  const devices = createRideDeviceSet({
    bus,
    clock,
    ticker,
    clockScale,
    transports: source.transports({
      trainer: trainer.peripheral,
      heartRate: createSimStrapPeripheral({ ticker, samples: SAMPLES }),
    }),
  });

  return {
    ...devices,
    writes: trainer.writes,
    data,
    trainerStatus,
    async tick(s) {
      clock.advanceS(s);
      ticker.tick();
      await settle();
    },
  };
}

async function connectedTrainer(source: Readonly<Source>, clockScale = 1): Promise<Rig> {
  const r = rig(source, clockScale);
  await r.trainer.connect();
  await r.tick(0.25);

  return r;
}

describe.each(TRANSPORTS)("ride device setup over $name", (source: Readonly<Source>) => {
  it("connects the production adapters through status, feature check and parsers", async () => {
    const r = rig(source);
    await Promise.all([r.trainer.connect(), r.heartRate.connect()]);
    await r.tick(0.25);

    expect(r.trainer.status()).toBe("ready");
    expect(r.heartRate.status()).toBe("ready");
    expect(r.trainer.protocol()).toBe("ftms");
    expect(r.trainer.features()?.targetFeatures).toContain("indoorBikeSimulationParameters");
    expect(r.trainerStatus).toEqual(["connecting", "handshaking", "ready"]);
    expect(r.data).toContainEqual({ type: "trainer.data", tS: 0.25, powerW: 200, cadenceRpm: 90 });
    expect(r.data).toContainEqual({ type: "hr.data", tS: 0.25, bpm: 120 });
  });

  it("writes nothing until explicit enable", async () => {
    const r = await connectedTrainer(source);
    r.trainer.control.forward({ paused: false, commands: [CLIMB] });
    await r.tick(0.25);

    expect(r.writes()).toEqual([]);
    expect(r.trainer.control.view().authority.kind).toBe("inactive");
  });

  it("refuses control under an accelerated clock without any write", async () => {
    const r = await connectedTrainer(source, 20);
    await r.trainer.control.enable();

    expect(r.trainer.control.view().authority).toMatchObject({ kind: "failed" });
    expect(r.writes()).toEqual([]);
  });
});

describe.each(TRANSPORTS)("trainer control over $name", (source: Readonly<Source>) => {
  it("runs the real ACK path after enable and forwards engine targets", async () => {
    const r = await connectedTrainer(source);
    await r.trainer.control.enable();

    expect(r.trainer.control.view()).toMatchObject({
      authority: { kind: "active" },
      acknowledged: { gradePct: 0 },
      hardware: "neutralAcknowledged",
    });

    await r.tick(0.25);
    r.trainer.control.forward({ paused: false, commands: [CLIMB] });
    await r.tick(0.25);

    expect(r.writes()).toEqual([0, 7, 0x11, 0x11]);
    expect(r.trainer.control.view().acknowledged?.gradePct).toBe(4);
  });

  it("reconnect revokes authority and never resends the cached target", async () => {
    const r = await connectedTrainer(source);
    await r.trainer.control.enable();
    await r.trainer.disconnect();
    await r.trainer.connect();
    r.trainer.control.forward({ paused: false, commands: [CLIMB] });
    await r.tick(0.25);

    expect(r.trainer.control.view()).toMatchObject({
      authority: { kind: "inactive" },
      acknowledged: undefined,
    });
    expect(r.writes()).toEqual([0, 7, 0x11]);
  });
});

it("an unexpected sim link loss runs the shell's reconnect schedule", async () => {
  const bus = createEventBus();
  const clock = createManualClock();
  const ticker = createManualTicker();
  const strap = createSimTransport(createSimStrapPeripheral({ ticker, samples: SAMPLES }));

  const { heartRate } = createRideDeviceSet({
    bus,
    clock,
    ticker,
    clockScale: 1,
    transports: {
      trainer: createSimTransport(createSimTrainerPeripheral({ ticker, samples: SAMPLES })),
      heartRate: strap,
      play: [],
    },
  });

  await heartRate.connect();
  strap.drop();
  expect(heartRate.status()).toBe("reconnecting");
  clock.advanceS(1);
  ticker.tick();
  await settle();
  expect(heartRate.status()).toBe("ready");
});

it("the sim transport rejects a scan for services the peripheral lacks", async () => {
  const transport = createSimTransport(
    createSimStrapPeripheral({ ticker: createManualTicker(), samples: SAMPLES }),
  );

  await expect(
    transport.connect({
      acceptAllDevices: false,
      filters: [{ services: ["0000fff0-0000-1000-8000-00805f9b34fb"] }],
      optionalServices: [],
    }),
  ).rejects.toThrow("no sim device matches");
});
