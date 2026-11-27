import { expect, it } from "vitest";
import { ControlTestRig } from "./controlTestRig.js";

function rig() {
  return new ControlTestRig();
}

it("accepts Start answered with failed (already started, as on the Zwift Hub), then needs a neutral ACK", async () => {
  const r = rig();
  r.resultFor(7, 4);
  await r.control.enable();
  expect(r.writes.map((write) => write.opcode)).toEqual([0, 7, 0x11]);
  expect(r.control.view()).toMatchObject({
    authority: { kind: "active" },
    hardware: "neutralAcknowledged",
  });
  r.control.dispose();
});

it.each([2, 3, 5])("does not accept Start refused with %s", async (result) => {
  const r = rig();
  r.resultFor(7, result);
  await r.control.enable();
  expect(r.writes.map((write) => write.opcode)).toEqual([0, 7]);
  expect(r.control.view().authority.kind).not.toBe("active");
  r.control.dispose();
});

it("never treats failed as success for the neutral simulation", async () => {
  const r = rig();
  r.resultFor(0x11, 4);
  await r.control.enable();
  expect(r.control.view().authority.kind).toBe("failed");
  expect(r.control.view().hardware).toBe("unknown");
  r.control.dispose();
});
