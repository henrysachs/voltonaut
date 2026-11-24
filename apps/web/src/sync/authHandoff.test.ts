import { expect, it } from "vitest";
import { handoffErrorText, takeAuthHandoff } from "./authHandoff.js";

const CODE = "A".repeat(43);

function take(href: string) {
  const replaced: string[] = [];

  return { handoff: takeAuthHandoff(href, (path) => void replaced.push(path)), replaced };
}

it("ignores other paths and extracts a single code", () => {
  expect(take("https://app.example/").handoff).toEqual({ kind: "none" });
  const { handoff, replaced } = take(`https://app.example/auth/finish?code=${CODE}`);
  expect(handoff).toEqual({ kind: "code", code: CODE });
  expect(replaced).toEqual(["/"]);
});

it.each(["identity_conflict", "email_not_verified"] as const)(
  "reports the %s failure with a readable text and scrubs the URL",
  (error) => {
    const { handoff, replaced } = take(`https://app.example/auth/finish?error=${error}`);
    expect(handoff).toEqual({ kind: "error", error });
    expect(replaced).toEqual(["/"]);
    expect(handoffErrorText(error)).toMatch(/Anmeldung abgelehnt/u);
  },
);

it.each(["?error=unknown", "?error=email_not_verified&error=identity_conflict", ""])(
  "treats malformed finish query %j as invalid",
  (query) => {
    expect(take(`https://app.example/auth/finish${query}`).handoff).toEqual({ kind: "invalid" });
  },
);

it("prefers a code over an accompanying error parameter", () => {
  expect(
    take(`https://app.example/auth/finish?error=email_not_verified&code=${CODE}`).handoff,
  ).toEqual({
    kind: "code",
    code: CODE,
  });
});

it("recognises a single account link code and scrubs the URL", () => {
  const { handoff, replaced } = take(`https://app.example/auth/finish?link=${CODE}`);

  expect(handoff).toEqual({ kind: "link", code: CODE });
  expect(replaced).toEqual(["/"]);
});

it.each(["?link=short", `?link=${CODE}&link=${CODE}`])(
  "treats the malformed link query %j as invalid",
  (query) => {
    expect(take(`https://app.example/auth/finish${query}`).handoff).toEqual({ kind: "invalid" });
  },
);
