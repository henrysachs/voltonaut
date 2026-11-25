import { expect, it } from "vitest";
import { DEFAULT_RIDER_PROFILE } from "@voltonaut/shared";

import { createEngineLink } from "./engine-link.js";
import { createFakePort } from "./testdata/enginePort.js";

it("forwards mode requests to the current actor and drops them once disposed", () => {
  const fake = createFakePort();
  const link = createEngineLink(fake.port, {}, () => "id-1");

  link.init({ routeId: "test-loop", profile: DEFAULT_RIDER_PROFILE, source: "sim" });
  link.setMode("fun");
  expect(fake.sent.at(-1)).toEqual({ type: "engine.setMode", actorId: "id-1", mode: "fun" });
  link.dispose();

  const count = fake.sent.length;

  link.setMode("normal");
  expect(fake.sent).toHaveLength(count);
});
