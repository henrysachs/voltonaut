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
