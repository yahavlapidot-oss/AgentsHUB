import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const token = () => (JSON.parse(readFileSync("e2e/.state.json", "utf8")) as { token: string }).token;

for (const path of ["/", "/live", "/approvals", "/artifacts", "/usage", "/agents", "/projects", "/chat", "/chat/team", "/notes", "/audit", "/status"]) {
  test(`${path} fits a phone screen`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

/** The element is on screen and not under the bottom tab bar (dialogs cover the bar, so only pages are checked). */
async function expectReachable(page: Page, name: string, { inDialog = false } = {}) {
  const el = page.getByRole("button", { name });
  await expect(el).toBeInViewport();
  if (inDialog) return;
  const box = (await el.boundingBox())!;
  const bar = await page.getByRole("navigation", { name: "Main" }).boundingBox();
  if (bar) expect(box.y + box.height).toBeLessThanOrEqual(bar.y + 1);
}

test("tabs at the bottom and the rest under More", async ({ page }) => {
  await page.goto("/");
  const tabs = page.getByRole("navigation", { name: "Main" });
  await expect(tabs).toBeVisible();
  await tabs.getByRole("link", { name: /Live/ }).click();
  await expect(page).toHaveURL(/\/live$/);
  await tabs.getByRole("button", { name: "More" }).click();
  await page.getByRole("link", { name: "Usage & costs" }).click();
  await expect(page).toHaveURL(/\/usage$/);
  await expect(page.getByRole("heading", { name: "Usage & costs" })).toBeVisible();
});

test("open a task and create one from a phone", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Add invoice PDF export/ }).first().click();
  await expect(page.getByPlaceholder("Write an update or instruction for Coder…")).toBeVisible();
  await page.goto("/");
  await page.getByRole("button", { name: "+ New task" }).first().click();
  await page.getByLabel("Title").fill("Phone task");
  await expectReachable(page, "Create task", { inDialog: true });
  await page.getByRole("button", { name: "Create task" }).click();
  await expect(page.getByText("Phone task").filter({ visible: true }).first()).toBeVisible();
});

test("approve from a phone", async ({ page, request }) => {
  await request.post("/api/v1/approvals", {
    headers: { authorization: `Bearer ${token()}` },
    data: { action: "Deploy to production from the phone test", risk: "high" },
  });
  await page.goto("/approvals");
  const item = page.locator("li", { hasText: "Deploy to production from the phone test" });
  await expect(item).toBeVisible();
  await expectReachable(page, "Approve");
  await item.getByRole("button", { name: "Approve" }).click();
  await expect(item.getByRole("button", { name: "Approve" })).toHaveCount(0);
});

test("chat box stays above the tabs", async ({ page }) => {
  await page.goto("/chat/team");
  await expectReachable(page, "Send");
  await page.getByLabel("Show").selectOption({ label: "Coder" });
});

test("hand a task to a project's work manager from the chat tab", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /Chats/ }).click();
  await page.getByRole("link", { name: /Docs site/ }).click();
  await page.getByRole("button", { name: /Writer/ }).click();
  await page.getByRole("radio", { name: "Task" }).click();
  await page.getByLabel("Task").fill("Add a FAQ page");
  await expectReachable(page, "Add task");
  await page.getByRole("button", { name: "Add task" }).click();
  // The task shows as a live card in the chat and on the project's board.
  await expect(page.locator("li", { hasText: "Add a FAQ page" }).getByText("Ready")).toBeVisible();
  await page.goto("/?project=" + new URL(page.url()).pathname.split("/").pop());
  await expect(page.getByRole("heading", { name: "Docs site" })).toBeVisible();
  await expect(page.getByText("Add a FAQ page").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText("Add invoice PDF export").filter({ visible: true })).toHaveCount(0);
});

test("the app can be added to the home screen", async ({ browser, baseURL }) => {
  const anon = await browser.newContext({ httpCredentials: undefined });
  const res = await anon.request.get(`${baseURL}/manifest.webmanifest`);
  expect(res.ok()).toBe(true);
  expect((await res.json()).display).toBe("standalone");
  expect((await anon.request.get(`${baseURL}/icon-192.png`)).ok()).toBe(true);
  await anon.close();
});
