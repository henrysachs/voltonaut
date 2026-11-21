import { test as base } from "@playwright/test";
import { retainNativeFailureImage, startNativeCapture } from "./nativeFirstFrame.js";

export const nativeMenuTest = base.extend<{ nativeCapture: void }>({
  nativeCapture: [
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright owns the page, use callback and test information fixtures.
    async ({ page }, use, testInfo) => {
      if (testInfo.title !== "menu keeps world and HUD moving") {
        await use();

        return;
      }

      const stopCapture = await startNativeCapture(page, testInfo);

      try {
        await use();
      } finally {
        await stopCapture();

        if (testInfo.status !== "passed") await retainNativeFailureImage(page, testInfo);
      }
    },
    { auto: true },
  ],
});
