import { describe, expect, it } from "vitest";

import { serializeRideTcx, rideTcxFilename } from "./rideTcx.js";
import { localRide } from "./testdata/localRide.js";

describe("TCX export", () => {
  it("exports stable UTC bike data, explicit simulation and virtual-distance provenance", () => {
    const xml = serializeRideTcx(localRide);
    expect(serializeRideTcx(localRide)).toBe(xml);
    expect(xml).toContain('Sport="Biking"');
    expect(xml).toContain("2026-11-20T12:00:01.500Z");
    expect(xml).toContain(
      "<TotalTimeSeconds>6</TotalTimeSeconds><DistanceMeters>20</DistanceMeters>",
    );
    expect(xml).toContain("Voltonaut simulation, not a real workout");
    expect(xml).toContain("Virtual distance");
    expect(xml).toContain("route&lt;&amp;&gt;&quot;&apos;");
    expect(xml).toContain("<Cadence>89</Cadence>");
    expect(xml).toContain("<ax:Watts>200</ax:Watts>");
    expect(xml).toContain("<ax:Watts>0</ax:Watts>");
    expect(xml).toContain("<HeartRateBpm><Value>121</Value></HeartRateBpm>");
    expect(xml).not.toMatch(/Position|Latitude|Longitude|Altitude|Creator|RunCadence/u);
    expect(rideTcxFilename(localRide)).toBe(`voltonaut-sim-${localRide.rideId}.tcx`);
  });

  it("omits missing sensors and separates tracks at declared gaps", () => {
    const xml = serializeRideTcx(localRide);
    expect(xml.match(/<Track>/gu)).toHaveLength(2);
    expect(xml.match(/<HeartRateBpm>/gu)).toHaveLength(1);
    expect(xml.match(/<ax:Watts>/gu)).toHaveLength(2);
    expect(xml).toContain("Gaps at elapsed ms: 6000");
    expect(
      serializeRideTcx({ ...localRide, metadata: { ...localRide.metadata, source: "ble" } }),
    ).not.toContain("not a real workout");
  });
});
