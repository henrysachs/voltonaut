import { expect, it } from "vitest";

import { AccountOutboxRun } from "./accountOutboxRun.js";

it("runs one delivery at a time and coalesces requests into one follow-up", () => {
  const run = new AccountOutboxRun();

  expect(run.claim("resume")).toBe(true);
  expect(run.claim("resume")).toBe(false);
  expect(run.claim("resume")).toBe(false);
  expect(run.release()).toBe("resume");
  expect(run.release()).toBeUndefined();
});

it("lets a manual request win over a queued resume, and not the other way round", () => {
  const run = new AccountOutboxRun();

  run.claim("manual");
  run.claim("resume");
  run.claim("manual");
  run.claim("resume");

  expect(run.release()).toBe("manual");
});

it("remembers a rejected session until a new run replaces it", () => {
  const run = new AccountOutboxRun();

  expect(run.reauth).toBe(false);
  run.rejectSession();
  expect(run.reauth).toBe(true);
  expect(new AccountOutboxRun().reauth).toBe(false);
});
