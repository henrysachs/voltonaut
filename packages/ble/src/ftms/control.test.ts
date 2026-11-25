import { expect, it } from "vitest";
import { bytesToDataView } from "../bytes.js";
import { ControlTestRig, settle } from "./controlTestRig.js";
import type { SimulationCommand } from "./controlCodec.js";
import type { GattProperty } from "../transport.js";

const COMMAND: SimulationCommand = {
  type: "simulation",
  gradePct: 4.5,
  windMps: 0,
  crr: 0.004,
  cwKgPerM: 0.51,
};

function rig() {
  return new ControlTestRig();
}

it("is read-only before enable; subscribes before synchronous ACKs; writes with response", async () => {
  const r = rig();
  r.cadence(90);
  r.control.forward([COMMAND]);
  await r.advance(1);
  expect(r.writes).toEqual([]);
  expect(r.retained).toEqual([]);
  await r.control.enable();
  expect(r.writes.map((write) => write.opcode)).toEqual([0, 7, 0x11]);
  expect(r.writes.every((write) => write.mode === "withResponse")).toBe(true);
  expect(r.control.view().authority.kind).toBe("active");
  expect(r.control.view().acknowledged?.gradePct).toBe(0);
  r.control.dispose();
});

it("requires fresh cadence, coalesces latest target, limits real wall rate without an extra delay", async () => {
  const r = rig();
  await r.control.enable();
  r.control.forward([COMMAND]);
  await r.advance(0.25);
  expect(r.writes).toHaveLength(3);
  r.cadence(90);
  r.control.forward([COMMAND]);
  await settle();
  expect(r.writes).toHaveLength(4);
  r.control.forward([{ ...COMMAND, gradePct: 6 }]);
  r.control.forward([{ ...COMMAND, gradePct: 7 }]);
  await r.advance(0.24);
  expect(r.writes).toHaveLength(4);
  await r.advance(0.01);
  expect(r.control.view().acknowledged?.gradePct).toBe(7);
  r.cadence(0);
  r.control.forward([{ ...COMMAND, gradePct: 8 }]);
  await r.advance(1);
  expect(r.writes).toHaveLength(5);
  r.cadence(90);
  r.control.forward([COMMAND]);
  await settle();
  r.control.forward([{ ...COMMAND, gradePct: 9 }]);
  await r.advance(2);
  expect(r.writes).toHaveLength(6);
  r.control.dispose();
});

it("keeps exactly one procedure outstanding and distinguishes target from ACK", async () => {
  const r = rig();
  await r.control.enable();
  await r.advance(0.25);
  r.ack(false);
  r.cadence(90);
  r.control.forward([COMMAND]);
  r.control.forward([{ ...COMMAND, gradePct: 6 }]);
  await r.advance(0.5);
  expect(r.writes).toHaveLength(4);
  expect(r.control.view().target?.gradePct).toBe(6);
  expect(r.control.view().acknowledged?.gradePct).toBe(0);
  r.notify([0x80, 7, 1]);
  await settle();
  expect(r.writes).toHaveLength(4);
  r.notify([0x80, 0x11, 1]);
  await settle();
  expect(r.writes).toHaveLength(5);
  expect(r.control.view().acknowledged?.gradePct).toBe(4.5);
  r.control.dispose();
});

it("quarantines timeout and late same-opcode ACK until a fresh connection", async () => {
  const r = rig();
  r.ack(false);
  const enabling = r.control.enable();
  await settle();
  await r.advance(3);
  await enabling;
  expect(r.control.view().authority).toMatchObject({ kind: "failed", reconnectRequired: true });
  r.notify([0x80, 0, 1]);
  await r.control.enable();
  expect(r.writes).toHaveLength(1);
  r.control.detach();
  r.attach();
  r.ack(true);
  await r.control.enable();
  expect(r.control.view().authority.kind).toBe("active");
  expect(r.control.view().target).toBeUndefined();
  r.control.dispose();
});

it.each([2, 3, 4, 5])("never starts after refused control %s", async (result) => {
  const r = rig();
  r.result(result);
  await r.control.enable();
  expect(r.writes.map((write) => write.opcode)).toEqual([0]);
  expect(r.control.view().authority.kind).not.toBe("active");
  r.control.dispose();
});

it("permission lost drops targets without retry or stop against another owner", async () => {
  const r = rig();
  await r.control.enable();
  r.lost();
  r.cadence(90);
  r.control.forward([COMMAND]);
  await r.control.disable();
  await r.advance(5);
  expect(r.control.view().authority.kind).toBe("lost");
  expect(r.writes).toHaveLength(3);
  r.control.dispose();
});

it("malformed ACK and uncertain writes quarantine instead of claiming applied", async () => {
  const r = rig();
  r.ack(false);
  const enable = r.control.enable();
  await settle();
  r.notify([0x80, 0]);
  await enable;
  expect(r.control.view().authority.kind).toBe("failed");
  r.control.detach();
  r.attach();
  r.ack(true);
  r.failWrite();
  await r.control.enable();
  expect(r.control.view().authority.kind).toBe("failed");
  expect(r.writes.map((write) => write.opcode)).toEqual([0, 0]);
  r.control.dispose();
});

it("disconnect cancels acquisition and old callbacks cannot activate a new session", async () => {
  const r = rig();
  r.ack(false);
  const enable = r.control.enable();
  await settle();
  r.control.detach();
  await enable;
  r.attach();

  for (const receive of r.retained) receive(bytesToDataView(Uint8Array.from([0x80, 0, 1])));
  await settle();
  expect(r.control.view().authority.kind).toBe("inactive");
  expect(r.writes).toHaveLength(1);
  r.control.dispose();
});

it("disable neutralizes and stops only owned control, then rejects automatic writes", async () => {
  const r = rig();
  await r.control.enable();
  const stopping = r.control.disable();
  await r.advance(0.25);
  await stopping;
  expect(r.writes.map((write) => write.opcode)).toEqual([0, 7, 0x11, 0x11, 8]);
  expect(r.writes.at(-1)?.bytes.at(1)).toBe(1);
  expect(r.control.view().authority.kind).toBe("inactive");
  expect(r.control.view().hardware).toBe("stopAcknowledged");
  r.cadence(90);
  r.control.forward([COMMAND]);
  await r.advance(1);
  expect(r.writes).toHaveLength(5);
  r.control.dispose();
});

it("rejects unsupported devices and accelerated native clocks without writes", async () => {
  const r = rig();
  r.control.attach({ services: [] });
  await r.control.enable();
  expect(r.control.view().authority.kind).toBe("inactive");
  r.control.dispose();
  const fast = new ControlTestRig(20);
  fast.cadence(90);
  fast.control.forward([COMMAND]);
  await fast.control.enable();
  await fast.advance(1);
  expect(fast.writes).toEqual([]);
  expect(fast.control.view().authority.kind).toBe("failed");
  fast.control.dispose();
});

it("does not start the next procedure until native write completion, even with synchronous ACK", async () => {
  const r = rig();
  const release = r.holdWrites();
  const enabling = r.control.enable();
  await settle();
  expect(r.writes.map((write) => write.opcode)).toEqual([0]);
  expect(r.control.view().authority).toEqual({ kind: "acquiring", step: "control" });
  release();
  await enabling;
  expect(r.writes.map((write) => write.opcode)).toEqual([0, 7, 0x11]);
  r.control.dispose();
});

it("late ACK cannot beat a deadline just because the timer callback was delayed", async () => {
  const r = rig();
  r.ack(false);
  const enabling = r.control.enable();
  await settle();
  r.clock.advanceS(3.1);
  r.notify([0x80, 0, 1]);
  await enabling;
  expect(r.control.view().authority.kind).toBe("failed");
  expect(r.writes).toHaveLength(1);
  r.control.dispose();
});

it("immediate cancel prevents a not-yet-dispatched native write", async () => {
  const r = rig();
  const enabling = r.control.enable();
  await r.control.disable();
  await enabling;
  expect(r.writes).toEqual([]);
  expect(r.control.view().authority.kind).toBe("failed");
  r.control.dispose();
});

it.each([
  { properties: ["write"] },
  { properties: ["indicate"] },
  { properties: ["writeWithoutResponse", "indicate"] },
] satisfies readonly { readonly properties: readonly GattProperty[] }[])(
  "requires both CP write and indicate: $properties",
  async ({ properties }: Readonly<{ properties: readonly GattProperty[] }>) => {
    const r = rig();
    r.attach(properties);
    await r.control.enable();
    expect(r.control.view().available).toBe(false);
    expect(r.writes).toEqual([]);
    r.control.dispose();
  },
);

it("does not infer simulation support from a writable CP alone", async () => {
  const r = rig();
  r.attach(["write", "indicate"], false);
  await r.control.enable();
  expect(r.control.view().available).toBe(false);
  expect(r.writes).toEqual([]);
  r.control.dispose();
});

it("rejects a non-finite deadline source without a write", async () => {
  const r = rig();
  r.clock.advanceS(Infinity);
  await r.control.enable();
  expect(r.control.view().authority.kind).toBe("failed");
  expect(r.writes).toEqual([]);
  r.control.dispose();
});

it("disable during an uncertain simulation drops all queued targets without stop against an unknown owner", async () => {
  const r = rig();
  await r.control.enable();
  await r.advance(0.25);
  r.ack(false);
  r.cadence(90);
  r.control.forward([COMMAND]);
  await settle();
  r.control.forward([{ ...COMMAND, gradePct: 8 }]);
  await r.control.disable();
  r.notify([0x80, 0x11, 1]);
  await r.control.enable();
  await r.advance(1);
  expect(r.writes).toHaveLength(4);
  expect(r.control.view().hardware).toBe("unknown");
  expect(r.control.view().authority.kind).toBe("failed");
  r.control.dispose();
});
