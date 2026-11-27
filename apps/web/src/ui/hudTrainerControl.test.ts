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
import { bindHudResistance, hudResistance, hudResistanceText } from "./hudTrainerControl.js";

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

it("stays hidden without a controllable trainer", () => {
  expect(hudResistance({ ...BASE, available: false })).toEqual({ kind: "hidden" });
  expect(hudResistanceText({ kind: "hidden" })).toBe("");
});

it("keeps a lost or failed session visible although it is no longer available", () => {
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
});

it.each([
  [{ kind: "inactive", reason: "x" }, "Widerstand aus · Menü → Geräte"],
  [{ kind: "acquiring", step: "control" }, "Widerstand wird aktiviert …"],
  [{ kind: "acquiring", step: "stopping" }, "Widerstand aus · Menü → Geräte"],
  [{ kind: "lost", reason: "x" }, "Widerstand verloren · neu verbinden"],
  [
    { kind: "failed", reason: "x", reconnectRequired: true },
    "Widerstand fehlgeschlagen · Geräte prüfen",
  ],
] as const)("maps authority %o to %s", (authority, text) => {
  expect(hudResistanceText(hudResistance({ ...BASE, authority }))).toBe(text);
});

it("shows only an acknowledged grade, never a merely requested target", () => {
  const active = { ...BASE, authority: { kind: "active" } } as const;

  expect(
    hudResistanceText(hudResistance({ ...active, target: SIM_TARGET, hardware: "unknown" })),
  ).toBe("Widerstand aktiv");
  expect(
    hudResistanceText(
      hudResistance({
        ...active,
        target: SIM_TARGET,
        acknowledged: SIM_TARGET,
        hardware: "targetAcknowledged",
      }),
    ),
  ).toBe("Widerstand aktiv · 4.0 %");
  expect(
    hudResistanceText(
      hudResistance({
        ...active,
        acknowledged: { ...SIM_TARGET, gradePct: 0 },
        hardware: "neutralAcknowledged",
      }),
    ),
  ).toBe("Widerstand aktiv · 0.0 %");
});

async function settle(rounds = 20): Promise<void> {
  if (rounds === 0) return;

  await Promise.resolve();
  await settle(rounds - 1);
}

it("follows the real sim trainer from hidden over off to active and back to off on disconnect", async () => {
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

  const seen: string[] = [];

  bindHudResistance(trainer.control, {
    write: (_text, state) => {
      seen.push(state);
    },
  });

  await trainer.connect();
  await settle();
  await trainer.control.enable();
  await settle();
  await trainer.disconnect();
  await settle();

  // Repeated notifications of one state are expected; the order of distinct states is the contract.
  expect(seen.filter((state, index) => state !== seen[index - 1])).toEqual([
    "hidden",
    "off",
    "starting",
    "active",
    "hidden",
  ]);
});
