import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      // `server-only` aruncă eroare în afara React Server Components; în teste rulăm direct pe server.
      "server-only": path.resolve(__dirname, "test/server-only.ts"),
    },
  },
  test: {
    include: ["lib/**/*.test.ts", "app/**/*.test.ts", "cli/**/*.test.ts", "scripts/**/*.test.ts"],
    globalSetup: ["../../packages/db/test/globalSetup.ts", "../../packages/core/test/redisSetup.ts"],
    setupFiles: ["./test/setup-env.ts"],
    // Serviciile web sunt singleton-uri pe proces; un singur worker ține testele simple și deterministe.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
