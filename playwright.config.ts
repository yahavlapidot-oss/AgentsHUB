import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
export const PASSWORD = "e2e-password";

/**
 * Browser tests against the built app (run `npm run build` first). The server
 * gets a fresh database, filled by e2e/seed.ts, and the hosted runner is off.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    httpCredentials: { username: "you", password: PASSWORD },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /phone/ },
    { name: "phone", use: { ...devices["Pixel 7"] }, testMatch: /phone/ },
  ],
  webServer: {
    command: `rm -f e2e/.e2e.db* && node scripts/migrate.mjs && npx tsx e2e/seed.mts && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { DATABASE_URL: "file:e2e/.e2e.db", DASHBOARD_PASSWORD: PASSWORD, RUNNER_ENABLED: "0", NOTIFY_EMAIL: "", RESEND_API_KEY: "" },
  },
});
