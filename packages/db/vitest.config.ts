import { defineConfig } from "vitest/config";
import { TEST_DB_COUNT } from "./test/url";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    globalSetup: ["./test/globalSetup.ts"],
    pool: "forks",
    poolOptions: { forks: { minForks: 1, maxForks: TEST_DB_COUNT } },
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
