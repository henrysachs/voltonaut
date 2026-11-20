import { expect, it } from "vitest";

import { oidcBrowserBinding } from "./oidc-cookie.js";

it("rejects extra cookie content rather than accepting a valid token prefix", () => {
  const binding = "a".repeat(43);

  expect(() => oidcBrowserBinding(`voltonaut-oidc=${binding}=extra`, false)).toThrow(
    "login is invalid",
  );
});
