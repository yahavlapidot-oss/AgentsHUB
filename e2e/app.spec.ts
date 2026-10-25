import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const state = () => JSON.parse(readFileSync("e2e/.state.json", "utf8")) as { token: string; coderId: string };

test("the dashboard asks for the password", async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ httpCredentials: undefined });
  const res = await ctx.request.get(`${baseURL}/`);
  expect(res.status()).toBe(401);
  const wrong = await browser.newContext({ httpCredentials: { username: "you", password: "nope" } });
  expect((await wrong.request.get(`${baseURL}/`)).status()).toBe(401);
  await ctx.close();
  await wrong.close();
});

test("security headers are sent", async ({ request }) => {
  const res = await request.get("/");
  expect(res.headers()["x-frame-options"]).toBe("SAMEORIGIN");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  expect(res.headers()["x-powered-by"]).toBeUndefined();
});

test("create a task on the board", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "+ New task" }).first().click();
  await page.getByLabel("Title").fill("E2E: add a health page");
  await page.getByRole("button", { name: "Create task" }).click();
  await expect(page.getByText("E2E: add a health page").first()).toBeVisible();
});

test("approve an agent's request", async ({ page }) => {
  await page.goto("/approvals");
  const item = page.locator("li", { hasText: "Send the launch email to 240 customers" });
  await expect(item).toBeVisible();
  await item.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("History")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
});

test("live workspace shows the command output and takes an instruction", async ({ page, request }) => {
  await page.goto("/live");
  await expect(page.getByText("$ npm test → exit 1")).toBeVisible();
  await expect(page.getByText("Tests: 1 failed, 11 passed")).toBeVisible();
  await expect(page.getByText(/Cloud computer running/)).toBeVisible();
  await page.getByPlaceholder(/Step in/).fill("Fix the failing test first");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(/the agent reads it after the current step/)).toBeVisible();

  // The agent gets it as a command through its API.
  const res = await request.get("/api/v1/commands", { headers: { authorization: `Bearer ${state().token}` } });
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(JSON.stringify(body)).toContain("Fix the failing test first");
});

test("set a monthly cap and a project budget", async ({ page }) => {
  await page.goto("/usage");
  await page.getByLabel("Monthly cap (USD)").fill("40");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("of $40.00")).toBeVisible();

  await page.goto("/projects");
  await page.getByRole("link", { name: /Shop/ }).first().click();
  await page.waitForURL(/\/projects\/.+/);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Budget (USD)").fill("5");
  await expect(page.getByLabel("Budget (USD)")).toHaveValue("5");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Spent of $5.00")).toBeVisible();
});

test("filter files by project", async ({ page }) => {
  await page.goto("/artifacts");
  await expect(page.getByText("src/invoice.ts")).toBeVisible();
  await expect(page.getByText("guide.md")).toBeVisible();
  await page.getByLabel("Project").selectOption({ label: "Docs site" });
  await expect(page.getByText("guide.md")).toBeVisible();
  await expect(page.getByText("src/invoice.ts")).toHaveCount(0);
});

test("emergency stop and resume", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Stop all agents" }).click();
  await page.getByRole("button", { name: "Click again to stop all" }).click();
  const resume = page.getByRole("button", { name: /Resume \d+ agent|Turn off the emergency stop/ });
  await expect(resume).toBeVisible();
  await resume.click();
  await expect(resume).toHaveCount(0);
});

test("agents connect over REST and MCP with their key", async ({ request }) => {
  const auth = { authorization: `Bearer ${state().token}` };
  expect((await request.get("/api/v1/me")).status()).toBe(401);
  const me = await request.get("/api/v1/me", { headers: auth });
  expect((await me.json()).agent.name).toBe("Coder");
  const mcp = await request.post("/api/mcp", { headers: auth, data: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  const tools = (await mcp.json()).result.tools.map((t: { name: string }) => t.name);
  expect(tools).toContain("claim_task");
  const big = await request.post("/api/v1/events", { headers: { ...auth, "content-type": "application/json" }, data: "x".repeat(11 * 1024 * 1024) });
  expect(big.status()).toBe(413);
});

test("health check and status page", async ({ browser, baseURL, page }) => {
  const anon = await browser.newContext({ httpCredentials: undefined });
  const health = await anon.request.get(`${baseURL}/api/health`);
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ ok: true, database: "ok", runner: "off" });
  await anon.close();

  await page.goto("/status");
  await expect(page.getByRole("heading", { name: "System status" })).toBeVisible();
  await expect(page.locator("li", { hasText: /^Database/ })).toContainText("Working");
});
