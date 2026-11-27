import { vi } from "vitest";
import { createTestDocument, TestElement, TestInput, TestSelect } from "../../../testdata/dom.js";
import { SNIFFER_FIXTURE } from "@voltonaut/ble/testdata";

export function prepareDom() {
  const document = createTestDocument();

  for (const id of [
    "scan",
    "picker-status",
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
    "selected-device",
    "devices",
    "read-all",
    "export-all",
    "guide",
    "guide-title",
    "log-tabs",
    "log-summary",
  ]) {
    document.add(id);
  }

  for (const id of ["filter", "firmware", "notes", "marker"]) {
    document.add(id, "input");
  }

  vi.stubGlobal("document", document);
  vi.stubGlobal("HTMLElement", TestElement);
  vi.stubGlobal("HTMLInputElement", TestInput);
  vi.stubGlobal("HTMLSelectElement", TestSelect);
  vi.stubGlobal("location", { search: "?replay=/replay.json" });
  vi.stubGlobal("window", { addEventListener: () => {} });
  vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify(SNIFFER_FIXTURE))));

  return document;
}

export interface ButtonNode {
  readonly textContent: string;
  readonly disabled: boolean;
  readonly children: readonly ButtonNode[];
  readonly click: () => void;
}

export function visibleButton(root: ButtonNode, text: string): ButtonNode | undefined {
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
