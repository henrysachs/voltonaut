import { expect, test, type Page, type TestInfo } from "@playwright/test";

type BillboardPage = Readonly<Pick<Page, "goto" | "getByTestId" | "getByLabel" | "screenshot">>;

async function inView(page: BillboardPage, side: "left" | "right"): Promise<number> {
  return Number(
    await page.getByLabel("Render diagnostics").getAttribute(`data-billboards-${side}`),
  );
}

test("billboards on both road sides are in view at the start of the Sim ride", async ({
  page,
}: { readonly page: BillboardPage }, testInfo: Readonly<Pick<TestInfo, "outputPath">>) => {
  await page.goto("/?sim=1&debug=1");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");
  await expect.poll(() => inView(page, "left")).toBeGreaterThan(0);
  await expect.poll(() => inView(page, "right")).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath("billboards-start.png") });
});

test("the first left-side billboard is visible on approach", async ({
  page,
}: { readonly page: BillboardPage }, testInfo: Readonly<Pick<TestInfo, "outputPath">>) => {
  await page.goto("/?sim=1&clock=fast&debug=1");
  await expect(page.getByTestId("hud-status")).toHaveText("Sim connected");

  const diagnostics = page.getByLabel("Render diagnostics");

  // The first left board stands at 333 m; capture it on approach, before passing it.
  await expect
    .poll(async () => Number(await diagnostics.getAttribute("data-distance-m")), {
      intervals: [25],
      timeout: 20_000,
    })
    .toBeGreaterThan(240);
  await page.screenshot({ path: testInfo.outputPath("billboards-left-approach.png") });
  expect(Number(await diagnostics.getAttribute("data-distance-m"))).toBeLessThan(330);
});
