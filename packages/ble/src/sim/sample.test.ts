import { describe, expect, it } from "vitest";

import { createSimScript } from "./sample.js";

describe("createSimScript", () => {
  it("keeps the scripted samples", () => {
    const script = createSimScript([
      { powerW: 100, cadenceRpm: 80, heartRateBpm: 120 },
      { powerW: 150, cadenceRpm: 90, heartRateBpm: 130 },
    ]);

    expect(script).toHaveLength(2);
  });

  it("rejects an empty script", () => {
    expect(() => createSimScript([])).toThrow(RangeError);
  });
});
