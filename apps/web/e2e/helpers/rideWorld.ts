import type { Page } from "@playwright/test";

/**
 * Distance of the last drawn world frame. The render worker clears `aria-busy` with its
 * first real draw (ADR-019); before that `data-distance-m` is missing and
 * `Number(null) === 0` would become a measurement baseline no frame has shown yet.
 */
export async function drawnDistanceM(page: Readonly<Pick<Page, "locator">>): Promise<number> {
  await page.locator('canvas[aria-label="3D ride scene"][aria-busy="false"]').waitFor();

  return Number(
    await page.locator('[aria-label="Render diagnostics"]').getAttribute("data-distance-m"),
  );
}
