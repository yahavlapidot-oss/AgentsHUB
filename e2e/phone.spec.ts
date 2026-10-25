import { expect, test } from "@playwright/test";

for (const path of ["/", "/live", "/approvals", "/artifacts", "/usage", "/agents", "/projects", "/chat", "/status"]) {
  test(`${path} fits a phone screen`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("approve from a phone", async ({ page }) => {
  await page.goto("/approvals");
  await expect(page.getByRole("heading", { name: "Approvals" })).toBeVisible();
});
