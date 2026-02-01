import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

// Get version from package.json at build time
function getBuildVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));
    return pkg.version;
  } catch {
    return "0.0.0";
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
    __BUILD_VERSION__: JSON.stringify(getBuildVersion()),
  },
});
