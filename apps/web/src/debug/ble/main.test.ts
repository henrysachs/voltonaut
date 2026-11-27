import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TestNodeView } from "../../testdata/dom.js";
import { downloadJson, element, input } from "./dom.js";
import { snifferDevice } from "../../testdata/sniffer.js";
import { prepareDom, visibleButton } from "./testdata/ui.js";

const RX_LINE = / {2}rx {2}Indoor Bike Data/gu;

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
    expect(dom.querySelector("#status")?.textContent).toContain("Verbunden");
    dom.find("Read").click();
    dom.find("Subscribe").click();
    await vi.advanceTimersByTimeAsync(500);
    expect(dom.querySelector("#log")?.textContent).toContain("powerW");
    // The decoded 0x2ACC line now names "...Parameters", so the marker needs a unique text.
    input("marker").value = "Taste RS";
    dom.querySelector("#add-marker")?.click();
    await vi.advanceTimersByTimeAsync(0);
    input("filter").value = "Taste RS";
    dom.querySelector("#filter")?.fire("input");
    expect(dom.querySelector("#log")?.textContent).toContain("● Taste RS");
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
    dom.find("FTMS Request Control + Start + Sim 0 %").click();
    await vi.advanceTimersByTimeAsync(1550);
    dom.find("FTMS Sim 5 %").click();
    await vi.advanceTimersByTimeAsync(250);
    expect(dom.querySelector("#log")?.textContent).toContain("11 00 00 f4 01 28 33");
    expect(dom.querySelector("#log")?.textContent).toContain("Preset abgeschlossen: FTMS Sim 5 %");
    dom.querySelector("#disconnect")?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(dom.querySelector("#status")?.textContent).toContain("Getrennt");
    dom.querySelector("#reconnect")?.click();
    await vi.advanceTimersByTimeAsync(0);
    dom.querySelector("#devices")?.children[0]?.children[0]?.click();
    expect(dom.querySelector("#status")?.textContent).toContain("Verbunden");
  });
});

describe("sniffer boundary errors", () => {
  it("rejects missing and mistyped DOM targets", () => {
    prepareDom();
    expect(() => element("absent")).toThrow("Missing");
    expect(() => input("scan")).toThrow("Expected input");
    downloadJson("{}", "ble-1-test");
  });

  it("reports malformed replay files", async () => {
    const dom = prepareDom();
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("null")));
    await import("./main.js");
    dom.querySelector("#scan")?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(dom.querySelector("#picker-status")?.textContent).toContain("fixture rejected");
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
  // Settle the connect-time reads, so each test's own Read is the pending one.
  a.finishRead();
  b.finishRead();
  await vi.advanceTimersByTimeAsync(0);

  const choose = (index: number): void => {
    dom.querySelector("#devices")?.children[index]?.children[0]?.click();
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
    dom.find("FTMS Request Control + Start + Sim 0 %").click();
    choose(1);
    a.finishRead();
    await vi.advanceTimersByTimeAsync(200);
    expect(a.writes).toEqual([[0], [7], [17, 0, 0, 0, 0, 40, 51]]);
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
    expect(dom.querySelector("#log")?.textContent?.match(RX_LINE)).toHaveLength(1);
    click("Unsubscribe");
    await vi.advanceTimersByTimeAsync(0);
    a.emit();
    expect(dom.querySelector("#log")?.textContent?.match(RX_LINE)).toHaveLength(1);
  });
});

describe("sniffer delayed operation context", () => {
  it("restores A's error status when returning from B", async () => {
    const { dom, a, choose, click } = await twoDevices();
    click("Read");
    await vi.advanceTimersByTimeAsync(0);
    choose(1);
    a.failRead();
    await vi.advanceTimersByTimeAsync(0);
    choose(0);
    expect(dom.querySelector("#status")?.textContent).toContain("read failed");
  });

  it("does not block B's marker behind A's pending read", async () => {
    const { dom, a, choose, click } = await twoDevices();
    click("Read");
    await vi.advanceTimersByTimeAsync(0);
    choose(1);
    input("marker").value = "B remains usable";
    dom.querySelector("#add-marker")?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(dom.querySelector("#log")?.textContent).toContain("B remains usable");
    a.finishRead();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("does not copy A's capture metadata into B", async () => {
    const { dom, choose } = await twoDevices();
    input("firmware").value = "firmware A";
    dom.querySelector("#firmware")?.fire("input");
    input("notes").value = "notes A";
    dom.querySelector("#notes")?.fire("input");
    choose(1);
    expect(input("firmware").value).toBe("");
    expect(input("notes").value).toBe("");
    choose(0);
    expect(input("firmware").value).toBe("firmware A");
    expect(input("notes").value).toBe("notes A");
  });
});

describe("sniffer delayed operation attribution", () => {
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
    expect(dom.querySelector("#log")?.textContent).not.toMatch(RX_LINE);
  });
});
