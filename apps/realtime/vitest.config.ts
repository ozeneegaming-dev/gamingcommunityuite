import { TEST_DB_COUNT } from "@gcs/db/test/url";
import { defineConfig } from "vitest/config";

// Aceeași infrastructură de test ca în `@gcs/core`: PostgreSQL embedded (o bază per worker) și Redis local.
// `gcs-realtime` (socket.io + Redis) e doar în ediția VPS: în rularea Lite (`GCS_EDITION=lite`) nu are ce testa.
export default defineConfig({
  test: {
    include: process.env.GCS_EDITION === "lite" ? [] : ["src/**/*.test.ts"],
    passWithNoTests: true,
    globalSetup: ["../../packages/db/test/globalSetup.ts", "../../packages/core/test/redisSetup.ts"],
    pool: "forks",
    poolOptions: { forks: { minForks: 1, maxForks: TEST_DB_COUNT } },
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
