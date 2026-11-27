import { expect, it } from "vitest";
import { createEventBus } from "@voltonaut/shared";
import {
  createManualClock,
  createManualTicker,
  createRideDeviceSet,
  createSimDeviceTransports,
  createSimScript,
  type TrainerControlView,
} from "@voltonaut/ble";
import {
  bindHudResistance,
  hudResistance,
  hudResistanceGrade,
  hudResistanceText,
} from "./hudTrainerControl.js";

const BASE: TrainerControlView = {
  authority: { kind: "inactive", reason: "Nur Messwerte." },
  available: true,
  target: undefined,
  acknowledged: undefined,
  hardware: "unknown",
};

const SIM_TARGET = {
  type: "simulation",
  gradePct: 4,
  windMps: 0,
  crr: 0.004,
  cwKgPerM: 0.2,
} as const;

const ACTIVE = { ...BASE, authority: { kind: "active" } } as const;

it("stays hidden without a controllable trainer", () => {
  expect(hudResistance({ ...BASE, available: false })).toEqual({ kind: "hidden" });
  expect(hudResistanceText({ kind: "hidden" })).toBe("");
});

it("keeps an ended session visible although it is no longer available", () => {
  expect(
    hudResistance({ ...BASE, available: false, authority: { kind: "lost", reason: "x" } }),
  ).toEqual({ kind: "lost" });
  expect(
    hudResistance({
      ...BASE,
      available: false,
      authority: { kind: "failed", reason: "x", reconnectRequired: true },
    }),
  ).toEqual({ kind: "failed" });
  expect(hudResistance({ ...BASE, available: false, hardware: "stopAcknowledged" })).toEqual({
    kind: "stopped",
  });
});

it.each([
  [{ kind: "inactive", reason: "x" }, "Widerstand aus · Menü → Geräte"],
  [{ kind: "acquiring", step: "control" }, "Widerstand wird aktiviert …"],
  [{ kind: "acquiring", step: "stopping" }, "Widerstand wird deaktiviert …"],
  [{ kind: "lost", reason: "x" }, "Widerstand verloren · neu verbinden"],
  [
    { kind: "failed", reason: "x", reconnectRequired: true },
    "Widerstand fehlgeschlagen · Geräte prüfen",
  ],
] as const)("maps authority %o to %s", (authority, text) => {
  expect(hudResistanceText(hudResistance({ ...BASE, authority }))).toBe(text);
});

it("never claims 'off' while the stop is still unconfirmed", () => {
  const stopping = hudResistance({
    ...BASE,
    authority: { kind: "acquiring", step: "stopping" },
    acknowledged: SIM_TARGET,
    hardware: "targetAcknowledged",
  });

  expect(stopping).toEqual({ kind: "stopping" });
  expect(hudResistanceText(stopping)).not.toContain("aus");
});

it("shows only an acknowledged grade, never a merely requested target", () => {
  expect(hudResistanceGrade(hudResistance({ ...ACTIVE, target: SIM_TARGET }))).toBe("");
  expect(
    hudResistanceGrade(
      hudResistance({
        ...ACTIVE,
        target: SIM_TARGET,
        acknowledged: SIM_TARGET,
        hardware: "targetAcknowledged",
      }),
    ),
  ).toBe("4.0 %");
  expect(
    hudResistanceGrade(
      hudResistance({
        ...ACTIVE,
        acknowledged: { ...SIM_TARGET, gradePct: -0.04 },
        hardware: "neutralAcknowledged",
      }),
    ),
  ).toBe("0.0 %");
  expect(hudResistanceText({ kind: "active", acknowledgedGradePct: 4 })).toBe("Widerstand aktiv");
});

it("writes only when state, text or grade change", () => {
  const writes: string[] = [];
  const listeners: (() => void)[] = [];
  let view: TrainerControlView = BASE;

  bindHudResistance(
    {
      view: () => view,
      subscribe: (listener) => {
        listeners.push(listener);

        return () => {};
      },
    },
    {
      write: (state, _text, grade) => {
        writes.push(`${state}${grade}`);
      },
    },
  );

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  notify();
  view = { ...ACTIVE, acknowledged: SIM_TARGET, hardware: "targetAcknowledged" };
  notify();
  notify();
  view = { ...view, acknowledged: { ...SIM_TARGET, gradePct: 4.02 } };
  notify();
  view = { ...view, acknowledged: { ...SIM_TARGET, gradePct: 5 } };
  notify();

  expect(writes).toEqual(["off", "active4.0 %", "active5.0 %"]);
});

async function settle(rounds = 20): Promise<void> {
  if (rounds === 0) return;

  await Promise.resolve();
  await settle(rounds - 1);
}

function simTrainer() {
  const clock = createManualClock();
  const ticker = createManualTicker();

  const { trainer } = createRideDeviceSet({
    bus: createEventBus(),
    clock,
    ticker,
    clockScale: 1,
    transports: createSimDeviceTransports({
      ticker,
      samples: createSimScript([{ powerW: 200, cadenceRpm: 90, heartRateBpm: 120 }]),
    }),
  });

  const states: string[] = [];

  bindHudResistance(trainer.control, {
    write: (state) => {
      states.push(state);
    },
  });

  return { trainer, clock, ticker, states };
}

it("follows the real sim trainer: hidden, off, starting, active, hidden after disconnect", async () => {
  const { trainer, states } = simTrainer();

  await trainer.connect();
  await settle();
  await trainer.control.enable();
  await settle();
  await trainer.disconnect();
  await settle();

  expect(states).toEqual(["hidden", "off", "starting", "active", "hidden"]);
});

it("follows the real sim trainer through disable: stopping until confirmed, then stopped", async () => {
  const { trainer, clock, ticker, states } = simTrainer();

  await trainer.connect();
  await settle();
  await trainer.control.enable();
  await settle();

  const disabling = trainer.control.disable();

  await settle();
  expect(states.at(-1)).toBe("stopping");
  clock.advanceS(0.25);
  ticker.tick();
  await disabling;
  await settle();

  expect(states).toEqual(["hidden", "off", "starting", "active", "stopping", "stopped"]);
  await trainer.disconnect();
});
