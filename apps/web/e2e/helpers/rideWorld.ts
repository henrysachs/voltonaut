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

/**
 * Waits, within the test timeout, until the ride shows the rider body. The body joins one frame
 * after the first draw (spec E4-10); until then the diagnostics carry no `data-look`.
 * Contract: once the rider is shown, it wears the server loadout, so look checks follow this
 * wait with their own default window. Start-up time is not checked here: the `data-triangles`
 * poll in `render-worker.spec.ts` "keeps input live while the renderer loads" bounds the first
 * draw (world and bike, without the rider body).
 */
export async function riderShown(page: Readonly<Pick<Page, "locator">>): Promise<void> {
  await page.locator('[aria-label="Render diagnostics"][data-look]').waitFor({ state: "attached" });
}
