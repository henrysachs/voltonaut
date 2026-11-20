import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestDocument,
  TestElement,
  TestInput,
  TestSelect,
  type TestNodeView,
} from "../../testdata/dom.js";
import { SNIFFER_FIXTURE } from "@voltonaut/ble/testdata";
import { downloadJson, element, input, select } from "./dom.js";
import { snifferDevice } from "../../testdata/sniffer.js";

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- DOM fake nodes retain mutable children so assertions inspect the current render.
function visibleButton(root: Readonly<TestElement>, text: string): TestElement | undefined {
  for (const node of root.children) {
    if (node.textContent === text) {
      return node;
    }

    const found = visibleButton(node, text);

    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}

function prepareDom() {
  const document = createTestDocument();

  for (const id of [
    "scan",
    "reconnect",
    "disconnect",
    "status",
    "advertisement",
    "presets",
    "gatt",
    "pause",
    "add-marker",
    "export",
    "log",
  ]) {
    document.add(id);
  }

  for (const id of ["filter", "firmware", "notes", "marker"]) {
    document.add(id, "input");
  }

  document.add("devices", "select");
  vi.stubGlobal("document", document);
  vi.stubGlobal("HTMLElement", TestElement);
  vi.stubGlobal("HTMLInputElement", TestInput);
  vi.stubGlobal("HTMLSelectElement", TestSelect);
  vi.stubGlobal("location", { search: "?replay=/replay.json" });
  vi.stubGlobal("window", { addEventListener: () => {} });
  vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify(SNIFFER_FIXTURE))));

  return document;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("sniffer browser composition", () => {
  it("connects replay, explores, captures while paused and exports", async () => {
    const dom = prepareDom();
    await import("./main.js");
    dom.find("FTMS Sim 5 %").click();
    await vi.advanceTimersByTimeAsync(0);
    expect(dom.querySelector("#status")?.textContent).toContain("Zuerst Gerät wählen");
    dom.querySelector("#scan")?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(dom.querySelector("#status")?.textContent).toContain("ready");
    dom.find("Read").click();
    dom.find("Subscribe").click();
    await vi.advanceTimersByTimeAsync(500);
    expect(dom.querySelector("#log")?.textContent).toContain("powerW");
    input("marker").value = "RS";
    dom.querySelector("#add-marker")?.click();
    await vi.advanceTimersByTimeAsync(0);
    input("filter").value = "RS";
    dom.querySelector("#filter")?.fire("input");
    expect(dom.querySelector("#log")?.textContent).toContain("RS");
    expect(dom.querySelector("#log")?.textContent).not.toContain("2b 14");
    dom.querySelector("#pause")?.click();
    dom.querySelector("#add-marker")?.click();
    await vi.advanceTimersByTimeAsync(0);
    dom.querySelector("#pause")?.click();
    dom.querySelector("#export")?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(dom.created.some((node: TestNodeView) => node.download.endsWith(".json"))).toBe(true);
  });
});

describe("sniffer connection operations", () => {
  it("runs FTMS presets and reconnects manually", async () => {
    const dom = prepareDom();
    await import("./main.js");
    dom.querySelector("#scan")?.click();
    await vi.advanceTimersByTimeAsync(0);
    dom.find("FTMS Sim 5 %").click();
    await vi.advanceTimersByTimeAsync(0);
    expect(dom.querySelector("#status")?.textContent).toContain("Zuerst FTMS");
    dom.find("FTMS Request Control + Sim 0 %").click();
    await vi.advanceTimersByTimeAsync(1300);
    dom.find("FTMS Sim 5 %").click();
    await vi.advanceTimersByTimeAsync(250);
    expect(dom.querySelector("#log")?.textContent).toContain("11 00 00 f4 01 28 33");
    dom.querySelector("#disconnect")?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(dom.querySelector("#status")?.textContent).toBe("disconnected");
    dom.querySelector("#reconnect")?.click();
    await vi.advanceTimersByTimeAsync(0);
    select("devices").value = "0";
    dom.querySelector("#devices")?.fire("change");
    expect(dom.querySelector("#status")?.textContent).toBe("ready");
  });
});

describe("sniffer boundary errors", () => {
  it("rejects missing and mistyped DOM targets", () => {
    prepareDom();
    expect(() => element("absent")).toThrow("Missing");
    expect(() => input("scan")).toThrow("Expected input");
    expect(() => select("scan")).toThrow("Expected select");
    downloadJson("{}");
  });

  it("reports malformed replay files", async () => {
    const dom = prepareDom();
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("null")));
    await import("./main.js");
    dom.querySelector("#scan")?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(dom.querySelector("#status")?.textContent).toContain("fixture rejected");
  });
});

async function twoDevices(notificationsReady: Readonly<Promise<void>> = Promise.resolve()) {
  const dom = prepareDom();
  const a = snifferDevice("A", notificationsReady);
  const b = snifferDevice("B");
  const devices = [a.device, b.device];
  vi.stubGlobal("location", { search: "" });
  vi.stubGlobal("navigator", {
    userAgent: "synthetic",
    bluetooth: { requestDevice: () => Promise.resolve(devices.shift()) },
  });
  await import("./main.js");
  dom.querySelector("#scan")?.click();
  await vi.advanceTimersByTimeAsync(0);
  dom.querySelector("#scan")?.click();
  await vi.advanceTimersByTimeAsync(0);

  const choose = (index: number): void => {
    select("devices").value = String(index);
    dom.querySelector("#devices")?.fire("change");
  };

  const click = (text: string): void => {
    const root = dom.querySelector("#gatt");

    if (root === null) {
      throw new Error("Missing explorer");
    }

    const button = visibleButton(root, text);

    if (button === undefined) {
      throw new Error(`Missing visible ${text}`);
    }

    button.click();
  };

  choose(0);
  const root = dom.querySelector("#gatt");

  if (root === null) {
    throw new Error("Missing explorer");
  }

  return { dom, a, b, choose, click, root };
}

describe("sniffer multi-device ownership", () => {
  it("keeps queued presets on the device selected at click time", async () => {
    const { dom, a, b, choose, click } = await twoDevices();
    click("Read");
    await vi.advanceTimersByTimeAsync(0);
    dom.find("FTMS Request Control + Sim 0 %").click();
    choose(1);
    a.finishRead();
    await vi.advanceTimersByTimeAsync(200);
    expect(a.writes).toEqual([[0], [17, 0, 0, 0, 0, 40, 51]]);
    expect(b.writes).toEqual([]);
  });

  it("keeps queued disconnects on their device without overwriting the selected status", async () => {
    const { dom, a, b, choose, click } = await twoDevices();
    click("Read");
    await vi.advanceTimersByTimeAsync(0);
    dom.querySelector("#disconnect")?.click();
    choose(1);
    const status = dom.querySelector("#status")?.textContent;
    a.finishRead();
    await vi.advanceTimersByTimeAsync(0);
    expect(a.disconnects()).toBe(1);
    expect(b.disconnects()).toBe(0);
    expect(dom.querySelector("#status")?.textContent).toBe(status);
  });

  it("records A in the background and unsubscribes A after switching A/B/A", async () => {
    const { dom, a, choose, click } = await twoDevices();
    click("Subscribe");
    await vi.advanceTimersByTimeAsync(0);
    choose(1);
    a.emit();
    choose(0);
    expect(dom.querySelector("#log")?.textContent?.match(/"kind":"data"/gu)).toHaveLength(1);
    click("Unsubscribe");
    await vi.advanceTimersByTimeAsync(0);
    a.emit();
    expect(dom.querySelector("#log")?.textContent?.match(/"kind":"data"/gu)).toHaveLength(1);
  });
});

describe("sniffer delayed operation context", () => {
  it("attributes a delayed read failure only to A while B remains selected", async () => {
    const { dom, a, choose, click } = await twoDevices();
    click("Read");
    await vi.advanceTimersByTimeAsync(0);
    choose(1);
    const status = dom.querySelector("#status")?.textContent;
    a.failRead();
    await vi.advanceTimersByTimeAsync(0);
    expect(dom.querySelector("#status")?.textContent).toBe(status);
    expect(dom.querySelector("#log")?.textContent).not.toContain("read failed");
    choose(0);
    expect(dom.querySelector("#log")?.textContent).toContain("error: read failed");
  });

  it("keeps queued markers and their text on the clicked device", async () => {
    const { dom, a, choose, click } = await twoDevices();
    click("Read");
    await vi.advanceTimersByTimeAsync(0);
    input("marker").value = "A marker";
    dom.querySelector("#add-marker")?.click();
    input("marker").value = "B marker";
    choose(1);
    a.finishRead();
    await vi.advanceTimersByTimeAsync(0);
    expect(dom.querySelector("#log")?.textContent).not.toContain("A marker");
    choose(0);
    expect(dom.querySelector("#log")?.textContent).toContain("A marker");
    expect(dom.querySelector("#log")?.textContent).not.toContain("B marker");
  });
});

describe("sniffer pending observation controls", () => {
  it("derives pending Subscribe and Unsubscribe controls from A after rerender", async () => {
    let ready: (() => void) | undefined;

    const pending = new Promise<void>((resolve) => {
      ready = resolve;
    });

    const { dom, a, choose, click, root } = await twoDevices(pending);
    click("Subscribe");
    await vi.advanceTimersByTimeAsync(0);
    choose(1);
    choose(0);
    expect(visibleButton(root, "Subscribe")?.disabled).toBe(true);
    expect(visibleButton(root, "Unsubscribe")?.disabled).toBe(false);
    click("Unsubscribe");
    ready?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(visibleButton(root, "Subscribe")?.disabled).toBe(false);
    expect(visibleButton(root, "Unsubscribe")?.disabled).toBe(true);
    a.emit();
    expect(dom.querySelector("#log")?.textContent).not.toContain('"kind":"data"');
  });
});
