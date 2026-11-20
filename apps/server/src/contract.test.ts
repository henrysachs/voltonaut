import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { SessionResponseSchema } from "@voltonaut/shared";

it("accepts the shared auth response fixture", () => {
  const session = SessionResponseSchema.parse(
    JSON.parse(
      readFileSync(
        new URL("../../../fixtures/api/auth-session.response.json", import.meta.url),
        "utf8",
      ),
    ),
  );

  expect(session.user.email).toBe("rider@example.com");
});
