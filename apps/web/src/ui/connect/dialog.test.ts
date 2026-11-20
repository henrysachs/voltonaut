import { afterEach, expect, it, vi } from "vitest";
import { createEventBus, type ConnectionStatus, type DeviceAdapter } from "@voltonaut/shared";
import { createTestDocument, type TestNodeView } from "../../testdata/dom.js";
import { mountConnectDialog } from "./dialog.js";

afterEach(() => vi.unstubAllGlobals());

it("shows status transitions, opens and closes, retries failed connects", async () => {
  const document = createTestDocument();
  const bus = createEventBus();
  let status: ConnectionStatus = "disconnected";
  let attempts = 0;

  const adapter: DeviceAdapter = {
    kind: "trainer",
    id: "trainer",
    status: () => status,
    connect: () => {
      attempts += 1;

      return Promise.reject(new Error("unavailable"));
    },
    disconnect: () => Promise.resolve(),
  };

  vi.stubGlobal("document", document);
  mountConnectDialog([{ label: "Trainer", adapter, select: () => adapter.connect() }], bus);
  document.find("Geräte verbinden").click();
  expect(document.created.some((node: TestNodeView) => node.open)).toBe(true);
  document.find("Gerät wählen").click();
  await Promise.resolve();
  expect(document.find("Erneut verbinden").hidden).toBe(false);
  document.find("Erneut verbinden").click();
  await Promise.resolve();
  expect(attempts).toBe(2);
  status = "reconnecting";
  bus.publish({ type: "device.status", tS: 1, kind: "trainer", id: "trainer", status });
  expect(document.find("Gerät wählen").disabled).toBe(true);
  expect(document.find("Erneut verbinden").hidden).toBe(true);
  document.find("Schließen").click();
  expect(document.created.some((node: TestNodeView) => node.open)).toBe(false);
});

it("shows unconfirmed side, actionable adapter details and allows cancelling handshaking", () => {
  const document = createTestDocument();
  const bus = createEventBus();
  let detail = "Seite noch unbekannt";
  let disconnected = false;

  const adapter: DeviceAdapter = {
    kind: "controller",
    id: "play-left",
    status: () => "handshaking",
    connect: () => Promise.resolve(),
    disconnect: () => {
      disconnected = true;

      return Promise.resolve();
    },
  };

  vi.stubGlobal("document", document);
  mountConnectDialog(
    [
      {
        label: "Play links (Ziel)",
        adapter,
        select: () => adapter.connect(),
        description: () => detail,
      },
    ],
    bus,
  );
  expect(document.find("Seite noch unbekannt")).toBeDefined();
  expect(document.find("Gerät wählen").disabled).toBe(true);
  document.find("Trennen").click();
  expect(disconnected).toBe(true);
  detail = "Falscher Griff: rechts erkannt. Gerät wählen.";
  bus.publish({
    type: "device.status",
    tS: 1,
    kind: "controller",
    id: "play-left",
    status: "error",
  });
  expect(document.find("Falscher Griff: rechts erkannt. Gerät wählen.")).toBeDefined();
});
