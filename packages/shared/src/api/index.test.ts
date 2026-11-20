import { describe, expect, it } from "vitest";

import { HealthResponseSchema } from "./index.js";

describe("HealthResponseSchema", () => {
  it("accepts the contract response", () => {
    const parsed = HealthResponseSchema.safeParse({
      status: "ok",
      version: "0.1.0",
      uptimeS: 12.5,
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown status", () => {
    const parsed = HealthResponseSchema.safeParse({
      status: "starting",
      version: "0.1.0",
      uptimeS: 12.5,
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects a missing field and a negative uptime", () => {
    const missingVersion = HealthResponseSchema.safeParse({ status: "ok", uptimeS: 1 });

    const negativeUptime = HealthResponseSchema.safeParse({
      status: "ok",
      version: "0.1.0",
      uptimeS: -1,
    });

    expect(missingVersion.success).toBe(false);
    expect(negativeUptime.success).toBe(false);
  });
});
