import { expect, it } from "vitest";

import { oidcBrowserBinding, oidcFinishError } from "./oidc-cookie.js";

it("rejects extra cookie content rather than accepting a valid token prefix", () => {
  const binding = "a".repeat(43);

  expect(() => oidcBrowserBinding(`voltonaut-oidc=${binding}=extra`, false)).toThrow(
    "login is invalid",
  );
});

it.each(["identity_conflict", "email_not_verified"] as const)(
  "reports %s to the browser finish page",
  (code) => {
    expect(oidcFinishError(code)).toBe(code);
  },
);

it.each(["invalid_oidc_login", "rate_limited", "internal_error", "not_found"] as const)(
  "keeps %s as an API error",
  (code) => {
    expect(oidcFinishError(code)).toBeUndefined();
  },
);
