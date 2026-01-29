import { execSync } from "node:child_process";
import { defineConfig } from "tsup";

// Get git commit SHA at build time
function getBuildCommit(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node20",
  shims: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
  define: {
    __BUILD_COMMIT__: JSON.stringify(getBuildCommit()),
  },
});
