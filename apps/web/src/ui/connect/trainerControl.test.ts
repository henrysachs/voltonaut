import { afterEach, expect, it, vi } from "vitest";
import { createEventBus } from "@voltonaut/shared";
import {
  createManualClock,
  createManualTicker,
  createRideDeviceSet,
  createSimDeviceTransports,
  createSimScript,
} from "@voltonaut/ble";
import { createTestDocument } from "../../testdata/dom.js";
import { mountConnectDialog } from "./dialog.js";

afterEach(() => vi.unstubAllGlobals());

async function settle(rounds = 20): Promise<void> {
  if (rounds === 0) return;
  await Promise.resolve();
  await settle(rounds - 1);
}

function rig(clockScale = 1) {
  const document = createTestDocument();
  const bus = createEventBus();
  const clock = createManualClock();
  const ticker = createManualTicker();

  const { trainer } = createRideDeviceSet({
    bus,
    clock,
    ticker,
    clockScale,
    transports: createSimDeviceTransports({
      ticker,
      samples: createSimScript([{ powerW: 200, cadenceRpm: 90, heartRateBpm: 120 }]),
    }),
  });

  vi.stubGlobal("document", {
    ...document,
    createElement(tag: string) {
      return Object.assign(document.createElement(tag), { dataset: {} });
    },
  });
  mountConnectDialog([{ label: "Trainer", adapter: trainer }], bus);

  return { document, clock, ticker, trainer };
}

it("keeps explicit control in the device overlay and shows acquisition before real Sim ACKs", async () => {
  const r = rig();
  expect(r.document.body.children).toHaveLength(2);
  expect(r.document.find("Widerstand aktivieren").getAttribute("class")).toBe("btn btn--secondary");
  expect(r.document.find("Widerstand deaktivieren").getAttribute("class")).toBe(
    "btn btn--secondary",
  );
  expect(r.document.find("Widerstand aktivieren").disabled).toBe(true);
  await r.trainer.connect();
  await settle();
  expect(r.document.find("Widerstand aktivieren").disabled).toBe(false);
  r.document.find("Widerstand aktivieren").click();
  expect(r.document.find("Freigabe läuft: control.")).toBeDefined();
  await settle();
  expect(r.document.find("Aktiv · Trainersteuerung freigegeben.")).toBeDefined();
  expect(r.document.find("ACK: 0.00 % · Neutralziel bestätigt")).toBeDefined();
  expect(r.document.find("Ziel: —")).toBeDefined();
  r.document.find("Schließen").click();
  expect(r.trainer.control.view().authority.kind).toBe("active");
  await r.trainer.disconnect();
});

it("separates requested grade from ACK and reports neutral/Stop only after confirmation", async () => {
  const r = rig();
  await r.trainer.connect();
  await settle();
  r.document.find("Widerstand aktivieren").click();
  await settle();
  r.clock.advanceS(0.25);
  r.ticker.tick();
  r.trainer.control.forward({
    paused: false,
    commands: [
      {
        type: "simulation",
        gradePct: 6,
        windMps: 0,
        crr: 0.004,
        cwKgPerM: 0.51,
      },
    ],
  });
  expect(r.document.find("Ziel: 6.00 %")).toBeDefined();
  expect(r.document.find("ACK: 0.00 % · Neutralziel bestätigt")).toBeDefined();
  await settle();
  expect(r.document.find("ACK: 6.00 % · Ziel bestätigt")).toBeDefined();
  r.document.find("Widerstand deaktivieren").click();
  r.clock.advanceS(0.25);
  r.ticker.tick();
  await settle();
  expect(r.document.find("ACK: 0.00 % · Stop bestätigt, kein Stillstandsnachweis")).toBeDefined();
  expect(r.document.find("Widerstand aktivieren").disabled).toBe(true);
  await r.trainer.disconnect();
});

it("shows accelerated-clock refusal honestly, with no acknowledged target", async () => {
  const r = rig(20);
  await r.trainer.connect();
  await settle();
  r.document.find("Widerstand aktivieren").click();
  await settle();
  expect(
    r.document.find("Rollenschaltung benötigt Echtzeit (clockScale=1). Neu laden ohne clock=fast."),
  ).toBeDefined();
  expect(r.document.find("ACK: — · Widerstand unbekannt")).toBeDefined();
  expect(r.document.find("Widerstand aktivieren").disabled).toBe(true);
  await r.trainer.disconnect();
});
