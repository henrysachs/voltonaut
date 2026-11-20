import { expect, it } from "vitest";
import { rig, noop, RIGHT_PRESSED, LEFT_PRESSED } from "../testdata/playRig.js";

function pauseFirst() {
  let calls = 0;
  let release = noop;

  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });

  return {
    release: () => {
      release();
    },
    next: () => {
      calls += 1;

      return calls === 1 ? pending : Promise.resolve();
    },
    calls: () => calls,
  };
}

it("late completion of a cancelled connect cannot replace a ready newer generation", async () => {
  const gate = pauseFirst();
  const target = rig({ beforeConnect: gate.next });
  const old = target.adapter.select();
  await expect.poll(gate.calls).toBe(1);
  await target.adapter.disconnect();
  const current = target.adapter.select();
  await expect.poll(() => target.operations().length).toBe(3);
  target.reply();
  target.input(RIGHT_PRESSED);
  await current;
  gate.release();
  await old;
  expect(target.adapter.status()).toBe("ready");
  expect(target.events()).toMatchObject([{ pressed: true }]);
  expect(target.operations()).toHaveLength(3);
});

it("late completion of an old write cannot shift or mark a new session ready", async () => {
  const gate = pauseFirst();
  const target = rig({ write: gate.next });
  const old = target.adapter.select();
  await expect.poll(gate.calls).toBe(1);
  target.reply();
  target.input(RIGHT_PRESSED);
  expect(target.events()).toEqual([]);
  await target.adapter.disconnect();
  const current = target.adapter.select();
  await expect.poll(gate.calls).toBe(2);
  gate.release();
  await old;
  expect(target.adapter.status()).toBe("handshaking");
  expect(target.events()).toEqual([]);
  target.reply();
  target.input(RIGHT_PRESSED);
  await current;
  expect(target.adapter.status()).toBe("ready");
  expect(target.events()).toMatchObject([{ pressed: true }]);
});

it("a contradictory side after readiness releases the old source and stops notifications", async () => {
  const target = rig();
  const connected = target.adapter.select();
  await expect.poll(() => target.operations().length).toBe(3);
  target.reply();
  target.input(RIGHT_PRESSED);
  await connected;
  target.input(LEFT_PRESSED);
  expect(target.adapter.status()).toBe("error");
  expect(target.events()).toMatchObject([
    { button: "shiftUp", pressed: true },
    { button: "shiftUp", pressed: false },
  ]);
  expect(target.listenerCount()).toBe(0);
  target.late();
  expect(target.events()).toHaveLength(2);
});
