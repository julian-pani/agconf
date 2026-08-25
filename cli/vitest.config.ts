import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Harness tests drive the real claude/codex CLIs (model calls, credentials):
    // opt in with `pnpm test:harness` (vitest.harness.config.ts).
    exclude: ["tests/harness/**"],
    setupFiles: ["tests/setup/tmpdir.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
    },
  },
});
