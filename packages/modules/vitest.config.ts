import { TEST_DB_COUNT, testOnMysql } from "@gcs/db/test/url";
import { defineConfig } from "vitest/config";

// Pe MySQL (ediția Lite) pluginurile cu bază de date proprie (rol + schemă PostgreSQL) nu sunt suportate: suitele lor
// (și portarea, care predă pluginul instalatorului) rulează doar pe PostgreSQL.
const PG_ONLY = ["src/plugins/host.test.ts", "src/plugins/integration.test.ts", "src/plugins/tickets.integration.test.ts", "src/plugins/vipStudio.integration.test.ts", "src/porting/service.test.ts"];

// Aceeași infrastructură de test ca în `@gcs/core`: PostgreSQL embedded (o bază per worker) și Redis local.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    exclude: ["**/node_modules/**", ...(testOnMysql() ? PG_ONLY : [])],
    globalSetup: ["../db/test/globalSetup.ts", "../core/test/redisSetup.ts"],
    pool: "forks",
    poolOptions: { forks: { minForks: 1, maxForks: TEST_DB_COUNT } },
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
