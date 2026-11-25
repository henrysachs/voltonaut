import { afterEach, expect, it, vi } from "vitest";
import type { AccountDataView } from "../sync/accountDataView.js";
import { createTestDocument } from "../testdata/dom.js";
import type { TestElement } from "../testdata/dom.js";
import { mountAccountDataPanel } from "./accountDataPanel.js";

const user = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "rider@example.com",
  createdAt: "2026-11-20T00:00:00.000Z",
};

const accountView: AccountDataView = {
  kind: "account",
  user,
  profile: { kind: "ready", value: { status: "missing" } },
  history: { kind: "ready", value: { rides: [], nextCursor: null } },
  outbox: { kind: "ready", value: [] },
  identities: {
    kind: "ready",
    value: [
      { providerId: "cloudflare", displayName: "Cloudflare Access" },
      { providerId: "authentik", displayName: "authentik" },
    ],
  },
  local: [],
  message: "",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

type TextNode = Readonly<{
  readonly textContent: string;
  readonly children: readonly TextNode[];
}>;

function renderedText(element: TextNode): string {
  return [element.textContent, ...element.children.map((child) => renderedText(child))].join(" ");
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing test element");

  return value;
}

type PublishAccountView = Parameters<Parameters<typeof mountAccountDataPanel>[0]["subscribe"]>[0];

function setupPanel() {
  const dom = createTestDocument();
  vi.stubGlobal("document", dom);
  const host = dom.add("account-data");

  const deleteAccount = vi.fn<(confirmation: string) => Promise<boolean>>(() =>
    Promise.resolve(true),
  );

  let publish: PublishAccountView | undefined;

  const commands: Parameters<typeof mountAccountDataPanel>[0] = {
    subscribe: (listener) => {
      publish = listener;
      listener(accountView);

      return () => {};
    },
    refresh: () => Promise.resolve(),
    retry: () => Promise.resolve(),
    claim: () => Promise.resolve(),
    queueProfile: () => Promise.resolve(),
    applyProfile: () => Promise.resolve(),
    nextHistory: () => Promise.resolve(),
    exportAccount: () => Promise.reject(new Error("not requested")),
    deleteAccount,
  };

  mountAccountDataPanel(commands);

  const input = required(
    dom.created.find(
      (element: Readonly<Pick<TestElement, "getAttribute">>) =>
        element.getAttribute("aria-label") === "E-Mail zur Löschbestätigung",
    ),
  );

  const checkbox = required(
    dom.created.find((element: Readonly<Pick<TestElement, "type">>) => element.type === "checkbox"),
  );

  const button = required(dom.find("Konto endgültig löschen"));

  return { host, input, checkbox, button, deleteAccount, publish };
}

it("requires the exact email and an explicit acknowledgement before deleting", () => {
  const { host, input, checkbox, button, deleteAccount, publish } = setupPanel();
  expect(button.disabled).toBe(true);
  input.value = "other@example.com";
  input.fire("input");
  checkbox.checked = true;
  checkbox.fire("change");
  expect(button.disabled).toBe(true);
  input.value = user.email.toUpperCase();
  input.fire("input");
  expect(button.disabled).toBe(false);
  button.click();
  expect(deleteAccount).toHaveBeenCalledWith(user.email.toUpperCase());
  expect(renderedText(host)).toContain(
    "Bereits an Strava übertragene Aktivitäten werden nicht gelöscht",
  );
  expect(renderedText(host)).toContain(
    "Lokale Fahrtarchive und das gemeinsame Gastprofil bleiben erhalten",
  );
  expect(renderedText(host)).toContain(
    "Konkret verknüpfte Anbieter: Cloudflare Access, authentik.",
  );
  expect(renderedText(host)).toContain("Volts-Kontostand und vollständiges Volts-Journal");
  expect(renderedText(host)).toContain(
    "Fortschrittszustimmung mit bestätigten Fortschrittsbereichen",
  );
  expect(renderedText(host)).toContain("Fortschrittszustimmung und Fortschrittsbereiche");

  publish?.({ kind: "guest", message: "Konto gelöscht. Outbox bereinigt." });
  expect(renderedText(host)).toContain("Konto gelöscht. Outbox bereinigt.");
});
