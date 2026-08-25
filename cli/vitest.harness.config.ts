import { defineConfig } from "vitest/config";

/**
 * Opt-in harness tests (`pnpm test:harness`): they drive the real `claude` /
 * `codex` CLIs, so they cost model calls and need those CLIs installed and
 * authenticated. Excluded from the default suite; each test skips itself when the
 * harness isn't usable here, so an upgraded CI can run this config safely.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/harness/**/*.test.ts"],
    setupFiles: ["tests/setup/tmpdir.ts"],
    // One harness at a time: parallel model calls just fight over rate limits.
    fileParallelism: false,
    testTimeout: 240_000,
    hookTimeout: 120_000,
  },
});
