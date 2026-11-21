import { expect, it } from "vitest";
import { parseServerConfig } from "../config.js";

it("requires explicit source policy, not Strava or a client claim", () => {
  expect(parseServerConfig({}, "test").rideSourcePolicy).toBe("disabled");
  expect(
    parseServerConfig({ RIDE_SOURCE_POLICY: "declared_ble_v1" }, "test").rideSourcePolicy,
  ).toBe("declared_ble_v1");
  expect(() => parseServerConfig({ RIDE_SOURCE_POLICY: "hardware_attested" }, "test")).toThrow(
    "Invalid enum value",
  );
});
