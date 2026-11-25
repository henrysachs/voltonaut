import { expect, it } from "vitest";
import { TrainerAdapterRig } from "./adapterTestRig.js";
import type { SimulationCommand } from "./controlCodec.js";

const CLIMB: SimulationCommand = {
  type: "simulation",
  gradePct: 4.5,
  windMps: 0,
  crr: 0.004,
  cwKgPerM: 0.51,
};

/** Fresh pedaling bike data plus an empty engine batch per sample, sequentially. */
async function ride(
  r: Readonly<Pick<TrainerAdapterRig, "adapter" | "advance" | "bikeData">>,
  samples: number,
  stepS: number,
): Promise<void> {
  if (samples === 0) return;
  r.bikeData(90);
  r.adapter.control.forward([]);
  await r.advance(stepS);
  await ride(r, samples - 1, stepS);
}

async function connected(clockScale = 1): Promise<TrainerAdapterRig> {
  const r = new TrainerAdapterRig(clockScale);
  await r.adapter.connect();
  expect(r.adapter.status()).toBe("ready");

  return r;
}

async function enabled(): Promise<TrainerAdapterRig> {
  const r = await connected();
  await r.adapter.control.enable();
  expect(r.adapter.control.view().authority.kind).toBe("active");
  expect(r.writes.map((write) => write.opcode)).toEqual([0, 7, 0x11]);
  await r.advance(0.25);

  return r;
}

it("sends one forwarded engine target exactly once, only after explicit enable", async () => {
  const r = await connected();
  r.bikeData(90);
  r.adapter.control.forward([CLIMB]);
  await r.advance(0.5);
  expect(r.writes).toEqual([]);
  expect(r.samples.at(-1)).toMatchObject({ cadenceRpm: 90, powerW: 244 });

  await r.adapter.control.enable();
  await r.advance(0.25);
  r.bikeData(90);
  await r.advance(0.25);
  r.adapter.control.forward([]);

  await ride(r, 8, 0.1);

  expect(r.simWrites()).toEqual([0, 450]);
  expect(r.adapter.control.view().acknowledged?.gradePct).toBe(4.5);
});

it("reads cadence from its own bike data: stale or zero cadence never writes", async () => {
  const r = await enabled();
  r.bikeData(90);
  await r.advance(1.6);
  r.adapter.control.forward([CLIMB]);
  await r.advance(0.5);
  r.bikeData(0);
  r.adapter.control.forward([{ ...CLIMB, gradePct: 6 }]);
  await r.advance(0.5);
  expect(r.simWrites()).toEqual([0]);
});

it("sends the held target when pedaling resumes, but not after the engine went silent", async () => {
  const r = await enabled();
  r.bikeData(0);
  r.adapter.control.forward([CLIMB]);
  await r.advance(1);
  r.adapter.control.forward([]);
  r.bikeData(90);
  await r.advance(0.25);
  expect(r.simWrites()).toEqual([0, 450]);

  r.bikeData(0);
  r.adapter.control.forward([{ ...CLIMB, gradePct: 6 }]);
  await r.advance(1.6);
  r.bikeData(90);
  await r.advance(0.5);
  expect(r.simWrites()).toEqual([0, 450]);
});

it("refuses control for an accelerated clock fixed at creation, without writes", async () => {
  const r = await connected(20);
  r.bikeData(90);
  r.adapter.control.forward([CLIMB]);
  await r.adapter.control.enable();
  r.bikeData(90);
  await r.advance(1);
  expect(r.writes).toEqual([]);
  expect(r.adapter.control.view().authority).toMatchObject({ kind: "failed" });
});

it("drops authority on disconnect and never resends the cached target until re-enabled", async () => {
  const r = await enabled();
  r.bikeData(90);
  r.adapter.control.forward([CLIMB]);
  await r.advance(0.25);
  expect(r.simWrites()).toEqual([0, 450]);

  r.dropLink();
  expect(r.adapter.control.view().authority.kind).toBe("inactive");
  await r.advance(1);
  expect(r.adapter.status()).toBe("ready");

  await ride(r, 10, 0.25);

  expect(r.writes).toHaveLength(4);
  expect(r.adapter.control.view()).toMatchObject({
    authority: { kind: "inactive" },
    target: undefined,
    acknowledged: undefined,
    hardware: "unknown",
  });

  // Explicit re-enable is a new grant: neutral first, then the engine's current target.
  await r.adapter.control.enable();
  await r.advance(0.25);
  r.bikeData(90);
  r.adapter.control.forward([]);
  await r.advance(0.25);
  expect(r.writes.slice(4).map((write) => write.opcode)).toEqual([0, 7, 0x11, 0x11]);
  expect(r.simWrites()).toEqual([0, 450, 0, 450]);
});

it("quarantines an unacknowledged target and never resends it on later samples", async () => {
  const r = await enabled();
  r.ack(false);
  r.bikeData(90);
  r.adapter.control.forward([CLIMB]);
  await r.advance(0.25);
  expect(r.simWrites()).toEqual([0, 450]);
  await r.advance(3);
  expect(r.adapter.control.view().authority).toMatchObject({
    kind: "failed",
    reconnectRequired: true,
  });

  r.adapter.control.forward([{ ...CLIMB, gradePct: 6 }]);
  await ride(r, 8, 0.25);

  await r.adapter.control.enable();
  expect(r.simWrites()).toEqual([0, 450]);
  expect(r.adapter.control.view().hardware).toBe("unknown");
});
