import { expect, it } from "vitest";
import { ControlTestRig, settle } from "./controlTestRig.js";
import type { SimulationCommand } from "./controlCodec.js";

const COMMAND: SimulationCommand = {
  type: "simulation",
  gradePct: 8,
  windMps: 0,
  crr: 0.004,
  cwKgPerM: 0.51,
};

async function acknowledge(
  r: Readonly<Pick<ControlTestRig, "notify">>,
  opcode: number,
): Promise<void> {
  r.notify([0x80, opcode, 1]);
  await settle();
}

async function acquireBefore(
  r: Readonly<Pick<ControlTestRig, "notify">>,
  opcode: number,
): Promise<void> {
  if (opcode !== 0) await acknowledge(r, 0);

  if (opcode === 0x11) await acknowledge(r, 7);
}

async function disableBefore(
  r: Readonly<Pick<ControlTestRig, "notify">>,
  opcode: number,
): Promise<void> {
  if (opcode === 8) await acknowledge(r, 0x11);
}

function afterNeutral(r: Readonly<Pick<ControlTestRig, "control">>, action: () => void): void {
  r.control.subscribe(() => {
    if (r.control.view().hardware === "neutralAcknowledged") queueMicrotask(action);
  });
}

it.each([
  { opcode: 0, status: 0xff },
  { opcode: 7, status: 0xff },
  { opcode: 0x11, status: 0xff },
  { opcode: 0, status: 0x01 },
  { opcode: 7, status: 0x01 },
  { opcode: 0x11, status: 0x01 },
])(
  "keeps loss after acquisition ACK $opcode and status $status terminal",
  async ({ opcode, status }: Readonly<{ opcode: number; status: number }>) => {
    const r = new ControlTestRig();
    r.ack(false);
    const enabling = r.control.enable();
    await settle();

    await acquireBefore(r, opcode);

    expect(r.writes.at(-1)?.opcode).toBe(opcode);
    const writes = r.writes.length;
    r.notify([0x80, opcode, 1]);
    r.lost(status);
    const lost = r.control.view();
    expect(lost.authority.kind).toBe("lost");
    await enabling;
    expect(r.control.view()).toEqual(lost);
    expect(r.control.view().available).toBe(false);
    await r.control.enable();
    await r.control.disable();
    r.control.observeCadence(90);
    r.control.submit(COMMAND);
    await r.advance(5);
    expect(r.control.view()).toEqual(lost);
    expect(r.control.view().available).toBe(false);
    expect(r.writes).toHaveLength(writes);
    r.control.dispose();
  },
);

it.each([0xff, 0x01])("does not restore a target ACK after status %s", async (status) => {
  const r = new ControlTestRig();
  await r.control.enable();
  await r.advance(0.25);
  r.ack(false);
  r.control.observeCadence(90);
  r.control.submit(COMMAND);
  await settle();
  r.control.submit({ ...COMMAND, gradePct: 9 });
  r.notify([0x80, 0x11, 1]);
  r.lost(status);
  const lost = r.control.view();
  expect(lost.hardware).toBe("unknown");
  await settle();
  await r.advance(1);
  expect(r.control.view()).toEqual(lost);
  expect(r.control.view().available).toBe(false);
  expect(r.writes).toHaveLength(4);
  r.control.dispose();
});

it.each([
  { opcode: 0x11, status: 0xff },
  { opcode: 8, status: 0xff },
  { opcode: 0x11, status: 0x01 },
  { opcode: 8, status: 0x01 },
])(
  "does not restore disable ACK $opcode after status $status",
  async ({ opcode, status }: Readonly<{ opcode: number; status: number }>) => {
    const r = new ControlTestRig();
    await r.control.enable();
    await r.advance(0.25);
    r.ack(false);
    const stopping = r.control.disable();
    await settle();

    await disableBefore(r, opcode);

    expect(r.writes.at(-1)?.opcode).toBe(opcode);
    const writes = r.writes.length;
    r.notify([0x80, opcode, 1]);
    r.lost(status);
    const lost = r.control.view();
    expect(lost.authority.kind).toBe("lost");
    await stopping;
    await r.advance(1);
    expect(r.control.view()).toEqual(lost);
    expect(r.control.view().available).toBe(false);
    expect(r.writes).toHaveLength(writes);
    r.control.dispose();
  },
);

it("keeps loss terminal between neutralize resolving and enable resuming", async () => {
  const r = new ControlTestRig();
  afterNeutral(r, () => {
    r.lost();
  });
  await r.control.enable();
  expect(r.control.view().authority.kind).toBe("lost");
  expect(r.control.view().hardware).toBe("unknown");
  expect(r.control.view().available).toBe(false);
  expect(r.writes).toHaveLength(3);
  r.control.dispose();
});

it("cancels the disable rate waiter on loss without neutral or stop writes", async () => {
  const r = new ControlTestRig();
  await r.control.enable();
  const stopping = r.control.disable();
  r.lost();
  await stopping;
  await r.advance(1);
  expect(r.control.view().authority.kind).toBe("lost");
  expect(r.control.view().hardware).toBe("unknown");
  expect(r.control.view().available).toBe(false);
  expect(r.writes).toHaveLength(3);
  r.control.dispose();
});

it("drops pending and queued targets on loss", async () => {
  const r = new ControlTestRig();
  await r.control.enable();
  await r.advance(0.25);
  r.ack(false);
  const release = r.holdWrites();

  r.control.observeCadence(90);
  r.control.submit(COMMAND);
  r.control.submit({ ...COMMAND, gradePct: 9 });
  await settle();

  r.lost();
  const failed = r.control.view();
  expect(failed.authority.kind).toBe("lost");
  release();
  r.notify([0x80, 0x11, 1]);
  await settle();
  await r.control.disable();
  await r.control.enable();
  await r.advance(5);
  expect(r.control.view()).toEqual(failed);
  expect(r.control.view().hardware).toBe("unknown");
  expect(r.control.view().available).toBe(false);
  expect(r.writes).toHaveLength(4);
  r.control.dispose();
});

it("drops pending and queued targets on write rejection", async () => {
  const r = new ControlTestRig();
  await r.control.enable();
  await r.advance(0.25);
  r.ack(false);
  r.failWrite();
  r.control.observeCadence(90);
  r.control.submit(COMMAND);
  r.control.submit({ ...COMMAND, gradePct: 9 });
  await settle();
  const failed = r.control.view();
  expect(failed.authority.kind).toBe("failed");
  r.notify([0x80, 0x11, 1]);
  await settle();
  await r.control.disable();
  await r.control.enable();
  await r.advance(5);
  expect(r.control.view()).toEqual(failed);
  expect(r.control.view().hardware).toBe("unknown");
  expect(r.control.view().available).toBe(false);
  expect(r.writes).toHaveLength(4);
  r.control.dispose();
});

it("requires a fresh attach and explicit enable after loss", async () => {
  const r = new ControlTestRig();
  await r.control.enable();
  r.lost();
  await r.control.enable();
  expect(r.control.view().authority.kind).toBe("lost");
  expect(r.control.view().available).toBe(false);
  r.attach();
  expect(r.control.view().authority.kind).toBe("inactive");
  expect(r.control.view().hardware).toBe("unknown");
  expect(r.writes).toHaveLength(3);
  await r.control.enable();
  expect(r.control.view().authority.kind).toBe("active");
  expect(r.writes).toHaveLength(6);
  r.control.dispose();
});

it("does not publish an old session completion after fresh attach", async () => {
  const r = new ControlTestRig();
  afterNeutral(r, () => {
    r.attach();
  });
  const published: string[] = [];
  r.control.subscribe(() => {
    published.push(r.control.view().authority.kind);
  });
  await r.control.enable();
  expect(r.control.view().authority.kind).toBe("inactive");
  expect(r.control.view().hardware).toBe("unknown");
  expect(published).toEqual([
    "acquiring",
    "acquiring",
    "acquiring",
    "acquiring",
    "inactive",
    "inactive",
  ]);
  expect(r.writes).toHaveLength(3);
  r.control.dispose();
});
