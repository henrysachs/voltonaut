import { expect, it } from "vitest";

import { PHYSICS_REVISION } from "./revision.js";

it("names the physics revision existing journals were recorded with", () => {
  expect(PHYSICS_REVISION).toBe("engine-v1");
});
