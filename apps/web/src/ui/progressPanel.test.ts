import { afterEach, describe, expect, it, vi } from "vitest";

import {
  mountProgressPanel,
  progressCountsText,
  progressStatusText,
  type ProgressPanelCounts,
  type ProgressPanelPort,
  type ProgressPanelView,
} from "./progressPanel.js";

const counts: ProgressPanelCounts = {
  rows: 12,
  queued: 3,
  sending: 1,
  blocked: 2,
  stored: 1,
  open: 4,
  remaining: 1188,
};

describe("progress panel text", () => {
  it("shows pending, blocked and capacity counts without raw facts", () => {
    expect(progressCountsText(counts)).toBe(
      "Lokal: 6 ausstehend · 3 wartend · 1 im Versand · 2 blockiert · 4 offen · 1 bestätigt · 1188 Kapazität frei.",
    );
    expect(progressStatusText({ kind: "guest", message: "Gast" })).toBe("Gast");
    expect(
      progressStatusText({
        kind: "account",
        consent: { kind: "ready", enabled: true, version: 2, rewardsAvailable: true },
        outbox: { kind: "capacity", counts },
        busy: false,
        message: "Widerrufen.",
      }),
    ).toContain("Kapazität voll. Lokal: 6 ausstehend");
  });

  it("names unconfirmed consent and unavailable storage instead of claiming success", () => {
    expect(
      progressStatusText({
        kind: "account",
        consent: { kind: "failed", message: "Zustimmung nicht erreichbar." },
        outbox: { kind: "failed" },
        busy: false,
        message: "",
      }),
    ).toBe(
      "Zustimmung nicht erreichbar. Lokale Progress-Warteschlange nicht verfügbar. Kein Speicherbeleg.",
    );
  });
});

class PanelNode extends EventTarget {
  readonly attributes = new Map<string, string>();
  readonly children: PanelNode[] = [];
  hidden = false;
  disabled = false;
  type = "";
  textContent = "";

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- This DOM fake owns the mutable child nodes appended by the real panel.
  append(...nodes: readonly PanelNode[]): void {
    this.children.push(...nodes);
  }

  click(): void {
    if (this.disabled) return;

    this.dispatchEvent(new Event("click"));
  }
}

interface PanelPortFixture {
  readonly consents: boolean[];
  readonly retries: { value: number };
  readonly port: ProgressPanelPort;
  readonly publish: (view: ProgressPanelView) => void;
}

function createPanelPort(): PanelPortFixture {
  let view: ProgressPanelView = { kind: "guest", message: "Gast" };
  let listener: ((view: ProgressPanelView) => void) | undefined;
  const consents: boolean[] = [];
  const retries = { value: 0 };

  return {
    consents,
    retries,
    port: {
      subscribe: (next) => {
        listener = next;
        next(view);

        return () => {
          listener = undefined;
        };
      },
      setConsent: (enabled) => {
        consents.push(enabled);

        return Promise.resolve();
      },
      retry: () => {
        retries.value += 1;

        return Promise.resolve();
      },
    },
    publish: (next) => {
      view = next;
      listener?.(next);
    },
  };
}

interface PanelFixture {
  readonly host: PanelNode;
  readonly section: PanelNode;
  readonly port: PanelPortFixture;
}

function fixture(): PanelFixture {
  const host = new PanelNode();
  const port = createPanelPort();
  vi.stubGlobal("document", {
    createElement: () => new PanelNode(),
    querySelector: (selector: string) => (selector === "#progress-panel" ? host : null),
  });
  mountProgressPanel(port.port);
  const section = host.children[0];

  if (section === undefined) throw new Error("Progress panel was not mounted");

  return { host, section, port };
}

afterEach(() => vi.unstubAllGlobals());

it("mounts explicit consent and retry controls inside the account overlay", () => {
  const view = fixture();
  const [title, explanation, status, toggle, retry] = view.section.children;

  expect(title?.textContent).toBe("Automatischer Fahrtfortschritt");
  expect(view.section.attributes.get("aria-label")).toBeUndefined();
  expect(explanation?.textContent).toContain("ohne Herzfrequenz");
  expect(explanation?.textContent).toContain("Die Fahrt läuft");
  expect(toggle?.hidden).toBe(true);
  expect(retry?.hidden).toBe(true);
  expect(status?.attributes.get("role")).toBe("status");

  view.port.publish({
    kind: "account",
    consent: { kind: "ready", enabled: false, version: 0, rewardsAvailable: true },
    outbox: { kind: "ready", counts },
    busy: false,
    message: "",
  });
  expect(toggle?.hidden).toBe(false);
  expect(toggle?.disabled).toBe(false);
  expect(toggle?.textContent).toBe("Automatischen Fahrtfortschritt aktivieren");
  expect(status?.textContent).toContain("6 ausstehend");
  toggle?.click();
  expect(view.port.consents).toEqual([true]);

  view.port.publish({
    kind: "account",
    consent: { kind: "ready", enabled: true, version: 1, rewardsAvailable: true },
    outbox: { kind: "capacity", counts },
    busy: true,
    message: "Aktivierung wird bestätigt …",
  });
  expect(toggle?.disabled).toBe(true);
  expect(retry?.disabled).toBe(true);

  view.port.publish({
    kind: "account",
    consent: { kind: "ready", enabled: true, version: 1, rewardsAvailable: true },
    outbox: { kind: "capacity", counts },
    busy: false,
    message: "",
  });
  expect(toggle?.textContent).toBe("Automatischen Fahrtfortschritt widerrufen");
  expect(status?.textContent).toContain("Kapazität voll");
  toggle?.click();
  retry?.click();
  expect(view.port.consents).toEqual([true, false]);
  expect(view.port.retries.value).toBe(1);
});

it("disables activation when server rewards are unavailable", () => {
  const view = fixture();
  const [, , status, toggle, retry] = view.section.children;

  view.port.publish({
    kind: "account",
    consent: { kind: "ready", enabled: false, version: 0, rewardsAvailable: false },
    outbox: { kind: "ready", counts },
    busy: false,
    message: "",
  });

  expect(toggle?.disabled).toBe(true);
  expect(retry?.disabled).toBe(true);
  expect(status?.textContent).toContain("Serverbelohnungen sind deaktiviert");
  toggle?.click();
  expect(view.port.consents).toEqual([]);
});

it("offers a status reload when consent could not be read", () => {
  const view = fixture();
  const retry = view.section.children[4];
  view.port.publish({
    kind: "account",
    consent: { kind: "failed", message: "Nicht erreichbar." },
    outbox: { kind: "loading" },
    busy: false,
    message: "",
  });
  expect(retry?.hidden).toBe(false);
  expect(retry?.disabled).toBe(false);
  expect(retry?.textContent).toBe("Progress-Status erneut laden");
  retry?.click();
  expect(view.port.retries.value).toBe(1);
});
