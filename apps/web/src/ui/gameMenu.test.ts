import { afterEach, expect, it, vi } from "vitest";
import { mountGameMenu } from "./gameMenu.js";

// Native focus containment, editing, Escape cancellation and running rides are covered by game-menu.spec.ts.
class MenuNode extends EventTarget {
  readonly attributes = new Map<string, string>();
  readonly children: MenuNode[] = [];
  hidden = false;
  disabled = false;
  tabIndex = 0;
  textContent = "";
  focused = false;
  open = false;
  readonly nodes = new Map<string, MenuNode>();
  readonly tabs: MenuNode[] = [];

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  focus(): void {
    this.focused = true;
  }
  click(): void {
    this.dispatchEvent(new Event("click"));
  }
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- This DOM test host retains the existing mutable node, like the real header.
  prepend(node: MenuNode): void {
    this.children.unshift(node);
  }
  showModal(): void {
    this.open = true;
  }
  close(): void {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  }
  querySelector(selector: string): MenuNode | null {
    if (selector === "dialog[open]") {
      return (
        [...this.nodes.values()].find((node: Readonly<Pick<MenuNode, "open">>) => node.open) ?? null
      );
    }

    return this.nodes.get(selector) ?? null;
  }
  querySelectorAll(selector: string): readonly MenuNode[] {
    return selector === ".game-menu [role=tab]" ? this.tabs : [];
  }
}

function keyEvent(type: "keydown" | "keyup", key: string) {
  return Object.assign(new Event(type, { cancelable: true }), { key });
}

function fixture(withDevices = true) {
  const document = new MenuNode();
  const dialog = new MenuNode();
  const open = new MenuNode();
  const close = new MenuNode();
  const devices = new MenuNode();
  const shortcut = new MenuNode();
  const header = new MenuNode();
  document.nodes.set("#game-menu", dialog);
  document.nodes.set("#game-menu-open", open);
  document.nodes.set("#game-menu-close", close);
  document.nodes.set("#game-menu-devices", devices);
  document.nodes.set("#game-header-actions", header);

  if (withDevices) document.nodes.set('[data-game-action="devices"]', shortcut);

  vi.stubGlobal("document", document);
  vi.stubGlobal("HTMLElement", MenuNode);
  vi.stubGlobal("HTMLButtonElement", MenuNode);
  vi.stubGlobal("HTMLDialogElement", MenuNode);

  return { document, dialog, open, close, devices, shortcut, header };
}

afterEach(() => vi.unstubAllGlobals());

it("mounts navigation without copying the device shortcut or invoking it automatically", () => {
  const view = fixture();
  let deviceOpens = 0;
  view.shortcut.addEventListener("click", () => {
    deviceOpens += 1;
  });
  mountGameMenu();
  expect(view.header.children).toEqual([view.shortcut]);
  expect(deviceOpens).toBe(0);
  view.open.click();
  expect(view.dialog.open).toBe(true);
  expect(view.open.getAttribute("aria-expanded")).toBe("true");
  view.devices.click();
  expect(view.dialog.open).toBe(false);
  expect(view.open.getAttribute("aria-expanded")).toBe("false");
  expect(deviceOpens).toBe(1);
  view.open.click();
  view.close.click();
  expect(view.dialog.open).toBe(false);
});

it("does not offer an unavailable device dialog or replace its guidance with a success", () => {
  const view = fixture(false);
  mountGameMenu();
  expect(view.devices.disabled).toBe(true);
  expect(view.devices.textContent).toBe("Bluetooth nicht verfügbar");
  expect(view.header.children).toEqual([]);
});

it("opens on Escape release, never above another modal and never for a cancelled key", () => {
  const view = fixture();
  const other = new MenuNode();
  view.document.nodes.set("#other-dialog", other);
  mountGameMenu();
  view.document.dispatchEvent(keyEvent("keydown", "Escape"));
  expect(view.dialog.open).toBe(false);
  view.document.dispatchEvent(keyEvent("keyup", "Escape"));
  expect(view.dialog.open).toBe(true);
  view.close.click();
  other.showModal();
  view.open.click();
  expect(view.dialog.open).toBe(false);
  view.document.dispatchEvent(keyEvent("keydown", "Escape"));
  other.close();
  view.document.dispatchEvent(keyEvent("keyup", "Escape"));
  expect(view.dialog.open).toBe(false);
  const cancelled = keyEvent("keydown", "Escape");
  cancelled.preventDefault();
  view.document.dispatchEvent(cancelled);
  view.document.dispatchEvent(keyEvent("keyup", "Escape"));
  view.document.dispatchEvent(keyEvent("keydown", "c"));
  view.document.dispatchEvent(keyEvent("keyup", "c"));
  expect(view.dialog.open).toBe(false);
});

it("selects only the requested existing panel and navigates tabs without changing input defaults", () => {
  const view = fixture();
  const profile = new MenuNode();
  const recordings = new MenuNode();
  const profilePanel = new MenuNode();
  const recordingPanel = new MenuNode();
  profile.setAttribute("aria-controls", "profile");
  recordings.setAttribute("aria-controls", "recordings");
  view.document.tabs.push(profile, recordings);
  view.document.nodes.set("#profile", profilePanel);
  view.document.nodes.set("#recordings", recordingPanel);
  mountGameMenu();
  recordings.click();
  expect(profilePanel.hidden).toBe(true);
  expect(recordingPanel.hidden).toBe(false);
  expect(recordings.getAttribute("aria-selected")).toBe("true");
  expect(profile.tabIndex).toBe(-1);
  const textKey = keyEvent("keydown", "c");
  recordings.dispatchEvent(textKey);
  expect(textKey.defaultPrevented).toBe(false);
  const left = keyEvent("keydown", "ArrowLeft");
  recordings.dispatchEvent(left);
  expect(left.defaultPrevented).toBe(true);
  expect(profile.focused).toBe(true);
  expect(profilePanel.hidden).toBe(false);
  expect(recordingPanel.hidden).toBe(true);
});
