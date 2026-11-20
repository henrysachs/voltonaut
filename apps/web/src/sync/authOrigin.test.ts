import { expect, it } from "vitest";

import { apiOrigin, isPreviewOrigin, parseApiOrigin } from "./authOrigin.js";
import { takeAuthHandoff } from "./authHandoff.js";

it("keeps the loopback hostname and selects the canonical production API", () => {
  expect(apiOrigin("http://localhost:5187")).toBe("http://localhost:3000");
  expect(apiOrigin("http://127.0.0.1:5187")).toBe("http://127.0.0.1:3000");
  expect(apiOrigin("https://voltonaut.stammkneipe.dev")).toBe(
    "https://api.voltonaut.stammkneipe.dev",
  );
  expect(apiOrigin("http://localhost:5187", "http://localhost:4321")).toBe("http://localhost:4321");
  expect(isPreviewOrigin("https://branch.voltonaut.pages.dev")).toBe(true);
});

it.each([
  "https://name:password@example.com",
  "https://example.com/path",
  "https://example.com/?next=evil",
  "https://example.com/#fragment",
  "https://example.com?",
  "https://example.com#",
  "https://@example.com",
  "javascript:alert(1)",
  "relative",
])("rejects non-origin API configuration %s", (value) => {
  expect(() => parseApiOrigin(value)).toThrow(/./u);
});

it("consumes only a single valid handoff and scrubs URL even for invalid input", () => {
  const replaced: string[] = [];

  const replace = (path: string): void => {
    replaced.push(path);
  };

  expect(
    takeAuthHandoff(`http://localhost/auth/finish?code=${"a".repeat(43)}#secret`, replace),
  ).toEqual({ kind: "code", code: "a".repeat(43) });
  expect(takeAuthHandoff("http://localhost/auth/finish?code=bad", replace)).toEqual({
    kind: "invalid",
  });
  expect(
    takeAuthHandoff(
      `http://localhost/auth/finish?code=${"a".repeat(43)}&code=${"b".repeat(43)}`,
      replace,
    ),
  ).toEqual({ kind: "invalid" });
  expect(takeAuthHandoff("http://localhost/auth/finish", replace)).toEqual({ kind: "invalid" });
  expect(takeAuthHandoff("http://localhost/?sim=1", replace)).toEqual({ kind: "none" });
  expect(replaced).toEqual(["/", "/", "/", "/"]);
});
