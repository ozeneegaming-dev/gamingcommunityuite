import { defineConfig, devices } from "@playwright/test";

/**
 * Testele E2E rulează prin `e2e/run.ts` (`pnpm test:e2e`), care pornește PostgreSQL, Redis și aplicația
 * și setează `GCS_E2E_BASE_URL`. Pentru o aplicație deja pornită: `GCS_E2E_BASE_URL=… playwright test`.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.GCS_E2E_BASE_URL ?? "http://localhost:3100",
    locale: "ro-RO",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
