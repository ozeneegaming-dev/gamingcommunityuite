import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: process.env.GCS_E2E_BASE_URL ?? "http://localhost:3000" },
});
