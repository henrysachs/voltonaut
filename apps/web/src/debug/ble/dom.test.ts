import { expect, it } from "vitest";
import { fileSlug } from "./dom.js";

it("builds a file-system safe download name per device", () => {
  expect(fileSlug("Zwift Click (rechts)")).toBe("zwift-click-rechts");
  expect(fileSlug("Zwift Hub")).toBe("zwift-hub");
  expect(fileSlug("…")).toBe("geraet");
});
