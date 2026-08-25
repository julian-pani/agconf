import { execSync } from "node:child_process";
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import {
  buildInstallCommand,
  buildReshimCommand,
  detectFromBinaryPath,
  detectFromNpmPrefix,
  detectFromUserAgent,
  detectPackageManager,
  detectToolManager,
  isPackageManager,
  PACKAGE_MANAGERS,
} from "../../src/utils/package-manager.js";

// package-manager only imports `execSync` from node:child_process, so a
// minimal mock is safe and keeps the tier-3 probe from shelling out for real.
vi.mock("node:child_process", () => ({ execSync: vi.fn() }));

const execSyncMock = vi.mocked(execSync);

describe("package-manager", () => {
  let originalEnv: NodeJS.ProcessEnv;
  let originalArgv: string[];

  beforeEach(() => {
    originalEnv = { ...process.env };
    originalArgv = [...process.argv];
  });

  afterEach(() => {
    process.env = originalEnv;
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  describe("buildInstallCommand", () => {
    it("builds npm install command", () => {
      expect(buildInstallCommand("npm", "agconf")).toBe("npm install -g agconf@latest");
    });

    it("builds pnpm install command", () => {
      expect(buildInstallCommand("pnpm", "agconf")).toBe("pnpm add -g agconf@latest");
    });

    it("builds yarn install command", () => {
      expect(buildInstallCommand("yarn", "agconf")).toBe("yarn global add agconf@latest");
    });

    it("builds bun install command", () => {
      expect(buildInstallCommand("bun", "agconf")).toBe("bun install -g agconf@latest");
    });

    it("builds volta install command", () => {
      expect(buildInstallCommand("volta", "agconf")).toBe("volta install agconf@latest");
    });
  });

  describe("isPackageManager", () => {
    it("accepts every advertised manager", () => {
      for (const pm of PACKAGE_MANAGERS) {
        expect(isPackageManager(pm)).toBe(true);
      }
    });

    it("rejects anything else", () => {
      expect(isPackageManager("cargo")).toBe(false);
      expect(isPackageManager("")).toBe(false);
      expect(isPackageManager("NPM")).toBe(false);
    });
  });

  describe("buildReshimCommand", () => {
    it("returns null for volta (volta install writes its own shims)", () => {
      expect(buildReshimCommand("volta")).toBeNull();
    });

    // No plugin argument: `asdf reshim <plugin>` fails outright when that
    // plugin is not installed, and this command is executed, not just printed.
    it("returns a plugin-agnostic asdf reshim command", () => {
      expect(buildReshimCommand("asdf")).toBe("asdf reshim");
    });

    it("returns the mise reshim command", () => {
      expect(buildReshimCommand("mise")).toBe("mise reshim");
    });
  });

  describe("detectToolManager", () => {
    let realpathSyncSpy: MockInstance;

    beforeEach(() => {
      realpathSyncSpy = vi.spyOn(fs, "realpathSync");
      process.argv[1] = "/usr/local/bin/agconf";
      // The host's own tool-manager roots must not leak into these assertions.
      for (const v of ["VOLTA_HOME", "ASDF_DATA_DIR", "MISE_DATA_DIR", "XDG_DATA_HOME"]) {
        delete process.env[v];
      }
    });

    it("detects volta", () => {
      realpathSyncSpy.mockReturnValue("/home/user/.volta/tools/image/packages/agconf/bin/agconf");
      expect(detectToolManager()).toBe("volta");
    });

    it("detects asdf", () => {
      realpathSyncSpy.mockReturnValue("/home/user/.asdf/installs/nodejs/20.0.0/bin/agconf");
      expect(detectToolManager()).toBe("asdf");
    });

    it("detects mise from the XDG data path", () => {
      realpathSyncSpy.mockReturnValue(
        "/home/user/.local/share/mise/installs/node/20.0.0/bin/agconf",
      );
      expect(detectToolManager()).toBe("mise");
    });

    it("detects mise from a ~/.mise path", () => {
      realpathSyncSpy.mockReturnValue("/home/user/.mise/installs/node/20.0.0/bin/agconf");
      expect(detectToolManager()).toBe("mise");
    });

    it("detects asdf at its XDG data location", () => {
      realpathSyncSpy.mockReturnValue(
        "/home/user/.local/share/asdf/installs/nodejs/20.0.0/bin/agconf",
      );
      expect(detectToolManager()).toBe("asdf");
    });

    it("detects a relocated install root from the manager's home variable", () => {
      process.env.MISE_DATA_DIR = "/opt/tools/mise";
      realpathSyncSpy.mockReturnValue("/opt/tools/mise/installs/node/20.0.0/bin/agconf");
      expect(detectToolManager()).toBe("mise");
    });

    it("honors XDG_DATA_HOME", () => {
      process.env.XDG_DATA_HOME = "/opt/xdg";
      realpathSyncSpy.mockReturnValue("/opt/xdg/asdf/installs/nodejs/20.0.0/bin/agconf");
      expect(detectToolManager()).toBe("asdf");
    });

    // Matching is per path segment, so a directory that merely embeds the name
    // cannot masquerade as an install root.
    it("does not match a directory that only contains the name", () => {
      realpathSyncSpy.mockReturnValue("/home/user/projects/my.volta-notes/node_modules/agconf.js");
      expect(detectToolManager()).toBeNull();
    });

    it("returns null for a plain global install", () => {
      realpathSyncSpy.mockReturnValue("/usr/local/lib/node_modules/agconf/dist/index.js");
      expect(detectToolManager()).toBeNull();
    });

    it("returns null when realpathSync throws", () => {
      realpathSyncSpy.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      expect(detectToolManager()).toBeNull();
    });

    it("returns null when argv[1] is undefined", () => {
      process.argv = [process.argv[0]];
      expect(detectToolManager()).toBeNull();
    });
  });

  describe("detectFromUserAgent", () => {
    it("detects pnpm from user agent", () => {
      process.env.npm_config_user_agent = "pnpm/8.15.0 npm/? node/v20.11.0 darwin arm64";
      expect(detectFromUserAgent()).toBe("pnpm");
    });

    it("detects yarn from user agent", () => {
      process.env.npm_config_user_agent = "yarn/1.22.19 npm/? node/v20.11.0 darwin arm64";
      expect(detectFromUserAgent()).toBe("yarn");
    });

    it("detects bun from user agent", () => {
      process.env.npm_config_user_agent = "bun/1.0.0 npm/? node/v20.11.0 darwin arm64";
      expect(detectFromUserAgent()).toBe("bun");
    });

    it("detects npm from user agent", () => {
      process.env.npm_config_user_agent = "npm/10.2.4 node/v20.11.0 darwin arm64";
      expect(detectFromUserAgent()).toBe("npm");
    });

    it("returns null when env var is not set", () => {
      delete process.env.npm_config_user_agent;
      expect(detectFromUserAgent()).toBeNull();
    });

    it("returns null for unrecognized user agent", () => {
      process.env.npm_config_user_agent = "unknown/1.0.0";
      expect(detectFromUserAgent()).toBeNull();
    });
  });

  describe("detectFromBinaryPath", () => {
    let realpathSyncSpy: MockInstance;

    beforeEach(() => {
      realpathSyncSpy = vi.spyOn(fs, "realpathSync");
    });

    it("detects pnpm from .pnpm-global path", () => {
      process.argv[1] = "/usr/local/bin/agconf";
      realpathSyncSpy.mockReturnValue(
        "/home/user/.local/share/pnpm/.pnpm-global/5/node_modules/agconf/dist/index.js",
      );
      expect(detectFromBinaryPath()).toBe("pnpm");
    });

    it("detects pnpm from node_modules/.pnpm path", () => {
      process.argv[1] = "/usr/local/bin/agconf";
      realpathSyncSpy.mockReturnValue(
        "/home/user/.local/share/pnpm/global/5/node_modules/.pnpm/agconf@1.0.0/node_modules/agconf/dist/index.js",
      );
      expect(detectFromBinaryPath()).toBe("pnpm");
    });

    it("detects bun from .bun path", () => {
      process.argv[1] = "/home/user/.bun/bin/agconf";
      realpathSyncSpy.mockReturnValue(
        "/home/user/.bun/install/global/node_modules/agconf/dist/index.js",
      );
      expect(detectFromBinaryPath()).toBe("bun");
    });

    it("detects yarn from .yarn path", () => {
      process.argv[1] = "/usr/local/bin/agconf";
      realpathSyncSpy.mockReturnValue("/home/user/.yarn/global/node_modules/agconf/dist/index.js");
      expect(detectFromBinaryPath()).toBe("yarn");
    });

    it("detects yarn from yarn/global path", () => {
      process.argv[1] = "/usr/local/bin/agconf";
      realpathSyncSpy.mockReturnValue(
        "/home/user/.config/yarn/global/node_modules/agconf/dist/index.js",
      );
      expect(detectFromBinaryPath()).toBe("yarn");
    });

    it("returns null for unrecognized path", () => {
      process.argv[1] = "/usr/local/bin/agconf";
      realpathSyncSpy.mockReturnValue("/usr/local/lib/node_modules/agconf/dist/index.js");
      expect(detectFromBinaryPath()).toBeNull();
    });

    it("returns null when argv[1] is undefined", () => {
      process.argv = [process.argv[0]];
      expect(detectFromBinaryPath()).toBeNull();
    });

    it("returns null when realpathSync throws", () => {
      process.argv[1] = "/broken/symlink";
      realpathSyncSpy.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      expect(detectFromBinaryPath()).toBeNull();
    });
  });

  describe("detectFromNpmPrefix", () => {
    beforeEach(() => {
      execSyncMock.mockReset();
      process.argv[1] = "/usr/local/bin/agconf";
    });

    it("returns npm when the binary lives under the npm global prefix", () => {
      vi.spyOn(fs, "realpathSync").mockReturnValue(
        "/usr/local/lib/node_modules/agconf/dist/index.js" as never,
      );
      execSyncMock.mockReturnValue("/usr/local\n");
      expect(detectFromNpmPrefix()).toBe("npm");
    });

    it("returns null when the binary lives outside the npm global prefix", () => {
      vi.spyOn(fs, "realpathSync").mockReturnValue(
        "/opt/elsewhere/node_modules/agconf/dist/index.js" as never,
      );
      execSyncMock.mockReturnValue("/usr/local\n");
      expect(detectFromNpmPrefix()).toBeNull();
    });

    it("returns null when `npm prefix -g` fails", () => {
      vi.spyOn(fs, "realpathSync").mockReturnValue(
        "/usr/local/lib/node_modules/agconf/dist/index.js" as never,
      );
      execSyncMock.mockImplementation(() => {
        throw new Error("npm: command not found");
      });
      expect(detectFromNpmPrefix()).toBeNull();
    });

    it("returns null when argv[1] is undefined", () => {
      process.argv = [process.argv[0]];
      expect(detectFromNpmPrefix()).toBeNull();
    });
  });

  describe("detectPackageManager", () => {
    let realpathSyncSpy: MockInstance;

    beforeEach(() => {
      realpathSyncSpy = vi.spyOn(fs, "realpathSync");
      // Pin the binary to a plain global install: tier 0 resolves the real path
      // unconditionally, so an unstubbed test would otherwise read the host's
      // own node install (which may itself sit under mise/asdf/volta).
      process.argv[1] = "/usr/local/bin/agconf";
      realpathSyncSpy.mockReturnValue("/usr/local/lib/node_modules/agconf/dist/index.js");
    });

    it("returns env var detection with highest priority", () => {
      process.env.npm_config_user_agent = "pnpm/8.15.0 npm/? node/v20.11.0";
      // Even if binary path suggests something else
      realpathSyncSpy.mockReturnValue("/home/user/.bun/install/agconf/dist/index.js");

      const result = detectPackageManager("agconf");
      expect(result.name).toBe("pnpm");
      expect(result.detectedVia).toBe("npm_config_user_agent");
    });

    it("falls back to binary path when env var is absent", () => {
      delete process.env.npm_config_user_agent;
      process.argv[1] = "/usr/local/bin/agconf";
      realpathSyncSpy.mockReturnValue(
        "/home/user/.local/share/pnpm/.pnpm-global/5/node_modules/agconf/dist/index.js",
      );

      const result = detectPackageManager("agconf");
      expect(result.name).toBe("pnpm");
      expect(result.detectedVia).toBe("binary path");
    });

    it("falls back to npm default when nothing matches", () => {
      delete process.env.npm_config_user_agent;
      process.argv[1] = "/some/unknown/path/agconf";
      realpathSyncSpy.mockReturnValue("/some/unknown/path/agconf");

      const result = detectPackageManager("agconf");
      expect(result.name).toBe("npm");
      expect(result.detectedVia).toBe("default");
      expect(result.installCommand).toBe("npm install -g agconf@latest");
    });

    it("detects volta ahead of every other tier", () => {
      // Even a pnpm user agent must not win: only `volta install` sticks.
      process.env.npm_config_user_agent = "pnpm/8.15.0 npm/? node/v20.11.0";
      process.argv[1] = "/home/user/.volta/bin/agconf";
      realpathSyncSpy.mockReturnValue("/home/user/.volta/tools/image/packages/agconf/bin/agconf");

      const result = detectPackageManager("agconf");
      expect(result.name).toBe("volta");
      expect(result.detectedVia).toBe("volta shim");
      expect(result.toolManager).toBe("volta");
      expect(result.installCommand).toBe("volta install agconf@latest");
      // Volta writes its own shims, so there is nothing to run afterwards.
      expect(result.postInstallCommand).toBeUndefined();
    });

    it("keeps the installer but adds a reshim step under asdf", () => {
      process.env.npm_config_user_agent = "npm/10.2.4 node/v20.11.0";
      process.argv[1] = "/home/user/.asdf/shims/agconf";
      realpathSyncSpy.mockReturnValue("/home/user/.asdf/installs/nodejs/20.0.0/bin/agconf");

      const result = detectPackageManager("agconf");
      expect(result.name).toBe("npm");
      expect(result.installCommand).toBe("npm install -g agconf@latest");
      expect(result.toolManager).toBe("asdf");
      expect(result.postInstallCommand).toBe("asdf reshim");
    });

    it("adds a reshim step under mise even on the default fallback", () => {
      delete process.env.npm_config_user_agent;
      process.argv[1] = "/home/user/.local/bin/agconf";
      realpathSyncSpy.mockReturnValue(
        "/home/user/.local/share/mise/installs/node/20.0.0/bin/agconf",
      );

      const result = detectPackageManager("agconf");
      expect(result.toolManager).toBe("mise");
      expect(result.postInstallCommand).toBe("mise reshim");
    });

    it("leaves toolManager unset for a plain global install", () => {
      process.env.npm_config_user_agent = "pnpm/8.15.0 npm/?";
      process.argv[1] = "/usr/local/bin/agconf";
      realpathSyncSpy.mockReturnValue("/usr/local/lib/node_modules/agconf/dist/index.js");

      const result = detectPackageManager("agconf");
      expect(result.toolManager).toBeUndefined();
      expect(result.postInstallCommand).toBeUndefined();
    });

    it("includes correct install command for detected PM", () => {
      process.env.npm_config_user_agent = "yarn/1.22.19 npm/?";

      const result = detectPackageManager("agconf");
      expect(result.installCommand).toBe("yarn global add agconf@latest");
    });

    it("uses an override as the installer while still reporting the shim", () => {
      process.env.npm_config_user_agent = "pnpm/8.15.0 npm/?";
      realpathSyncSpy.mockReturnValue("/home/user/.asdf/installs/nodejs/20.0.0/bin/agconf");

      const result = detectPackageManager("agconf", { override: "yarn" });
      expect(result.name).toBe("yarn");
      expect(result.detectedVia).toBe("--package-manager flag");
      expect(result.installCommand).toBe("yarn global add agconf@latest");
      // The flag selects the installer only — the shim still needs rebuilding.
      expect(result.toolManager).toBe("asdf");
      expect(result.postInstallCommand).toBe("asdf reshim");
    });

    it("does not invent a tool manager for an override on a plain install", () => {
      const result = detectPackageManager("agconf", { override: "volta" });
      expect(result.name).toBe("volta");
      expect(result.installCommand).toBe("volta install agconf@latest");
      expect(result.toolManager).toBeUndefined();
      expect(result.postInstallCommand).toBeUndefined();
    });
  });
});
