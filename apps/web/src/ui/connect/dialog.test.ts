import { afterEach, expect, it, vi } from "vitest";
import { createEventBus, type ConnectionStatus } from "@voltonaut/shared";
import { createTestDocument, type TestNodeView } from "../../testdata/dom.js";
import { mountConnectDialog, type ConnectableDevice } from "./dialog.js";

afterEach(() => vi.unstubAllGlobals());

interface PendingAction {
  readonly resolve: () => void;
  readonly reject: (error: Readonly<Error>) => void;
}

class PendingActions {
  readonly #pending: PendingAction[] = [];

  readonly wait = (): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      this.#pending.push({ resolve, reject });
    });

  async settle(reject = false): Promise<void> {
    const action = this.#pending.shift();

    if (action === undefined) throw new Error("Missing pending device action");

    if (reject) action.reject(new Error("unavailable"));
    else action.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }
}

function busyRig() {
  const document = createTestDocument();
  const bus = createEventBus();
  const actions = new PendingActions();
  let status: ConnectionStatus = "disconnected";
  let selections = 0;

  const adapter: ConnectableDevice = {
    kind: "trainer",
    id: "trainer",
    status: () => status,
    connect: actions.wait,
    disconnect: actions.wait,
    select: () => {
      selections += 1;

      return actions.wait();
    },
  };

  vi.stubGlobal("document", document);
  mountConnectDialog([{ label: "Trainer", adapter }], bus);

  return {
    document,
    actions,
    selections: () => selections,
    setStatus: (next: ConnectionStatus): void => {
      status = next;
      bus.publish({ type: "device.status", tS: 1, kind: "trainer", id: "trainer", status });
    },
  };
}

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

it("marks connect, retry and disconnect busy only until their action settles", async () => {
  const { document, actions, selections, setStatus } = busyRig();
  const choose = document.find("Gerät wählen");
  const retry = document.find("Erneut verbinden");
  const disconnect = document.find("Trennen");

  expect(choose.getAttribute("class")).toBe("btn btn--secondary");
  expect(retry.getAttribute("class")).toBe("btn btn--secondary");
  expect(disconnect.getAttribute("class")).toBe("btn btn--secondary");
  expect(document.find("Schließen").getAttribute("class")).toBe("btn btn--secondary");
  expect(document.find("Geräte verbinden").getAttribute("class")).toBe("btn btn--secondary");

  choose.click();
  expect(selections()).toBe(1);
  expect(choose.getAttribute("aria-busy")).toBe("true");
  expect(retry.getAttribute("aria-busy")).toBe("false");
  expect(disconnect.getAttribute("aria-busy")).toBe("false");
  await actions.settle();
  expect(choose.getAttribute("aria-busy")).toBe("false");

  setStatus("error");
  retry.click();
  expect(retry.getAttribute("aria-busy")).toBe("true");
  await actions.settle(true);
  expect(retry.getAttribute("aria-busy")).toBe("false");

  setStatus("ready");
  disconnect.click();
  expect(disconnect.getAttribute("aria-busy")).toBe("true");
  await actions.settle();
  expect(disconnect.getAttribute("aria-busy")).toBe("false");
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
  mountConnectDialog([{ label: "Linker Controller", adapter }], bus);
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
