import { afterEach, expect, it, vi } from "vitest";
import { createEventBus, type ConnectionStatus } from "@voltonaut/shared";
import { createTestDocument, type TestNodeView } from "../../testdata/dom.js";
import { mountConnectDialog, type ConnectableDevice } from "./dialog.js";

afterEach(() => vi.unstubAllGlobals());

it("shows status transitions, opens and closes, retries failed connects", async () => {
  const document = createTestDocument();
  const bus = createEventBus();
  let status: ConnectionStatus = "disconnected";
  let attempts = 0;

  const connect = (): Promise<void> => {
    attempts += 1;

    return Promise.reject(new Error("unavailable"));
  };

  const adapter: ConnectableDevice = {
    kind: "trainer",
    id: "trainer",
    status: () => status,
    connect,
    select: connect,
    disconnect: () => Promise.resolve(),
  };

  vi.stubGlobal("document", document);
  mountConnectDialog([{ label: "Trainer", adapter }], bus);
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

  const adapter: ConnectableDevice = {
    kind: "controller",
    id: "play-left",
    status: () => "handshaking",
    connect: () => Promise.resolve(),
    select: () => Promise.resolve(),
    description: () => detail,
    disconnect: () => {
      disconnected = true;

      return Promise.resolve();
    },
  };

  vi.stubGlobal("document", document);
  mountConnectDialog([{ label: "Linker Play-Griff", adapter }], bus);
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
