import { afterEach, expect, it, vi } from "vitest";

import type { SessionView } from "../sync/applicationSession.js";
import { createTestDocument } from "../testdata/dom.js";
import { mountAccountPanel } from "./accountPanel.js";

afterEach(() => vi.unstubAllGlobals());

it("marks the login control busy only while the session view is busy", () => {
  const dom = createTestDocument();
  vi.stubGlobal("document", dom);
  dom.add("account-panel");

  let publish: ((view: SessionView) => void) | undefined;

  const session = {
    subscribe: (listener: (view: SessionView) => void) => {
      publish = listener;
      listener({
        kind: "guest",
        message: "Gast",
        providers: [{ id: "test", displayName: "Test" }],
      });

      return () => {};
    },
    login: () => Promise.resolve(),
    logout: () => Promise.resolve(),
  };

  mountAccountPanel(session);

  const login = dom.find("Anmelden");
  const providerLogin = dom.find("Anmelden mit Test");
  expect(login.getAttribute("class")).toBe("btn btn--primary");
  expect(providerLogin.getAttribute("class")).toBe("btn btn--primary");
  expect(login.getAttribute("aria-busy")).toBe("false");

  publish?.({ kind: "busy", operation: "login" });
  expect(login.disabled).toBe(true);
  expect(login.getAttribute("aria-busy")).toBe("true");

  publish?.({ kind: "guest", message: "Gast" });
  expect(login.disabled).toBe(false);
  expect(login.getAttribute("aria-busy")).toBe("false");
});
