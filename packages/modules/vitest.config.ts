import { TEST_DB_COUNT } from "@gcs/db/test/url";
import { defineConfig } from "vitest/config";

// Aceeași infrastructură de test ca în `@gcs/core`: PostgreSQL embedded (o bază per worker) și Redis local.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    globalSetup: ["../db/test/globalSetup.ts", "../core/test/redisSetup.ts"],
    pool: "forks",
    poolOptions: { forks: { minForks: 1, maxForks: TEST_DB_COUNT } },
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
