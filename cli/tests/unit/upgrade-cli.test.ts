import { execSync } from "node:child_process";
import fs from "node:fs";
import * as prompts from "@clack/prompts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { upgradeCliCommand } from "../../src/commands/upgrade-cli.js";
import { getCliVersion } from "../../src/core/lockfile.js";

/**
 * Command-level tests for `agconf upgrade-cli`. These exercise the branch logic
 * (registry fetch, version comparison, package-manager validation, install,
 * post-install verification and shim detection) without any real network or
 * subprocess calls. `execSync` and `fetch` are mocked; `getCliVersion` is
 * mocked so the "current" version can be controlled per test. All runs use
 * `--yes` to bypass the interactive confirm.
 */

// upgrade-cli only imports `execSync` from node:child_process, so a minimal mock is safe.
vi.mock("node:child_process", () => ({ execSync: vi.fn() }));

// upgrade-cli only imports `getCliVersion` from lockfile, so a minimal mock is safe.
vi.mock("../../src/core/lockfile.js", () => ({ getCliVersion: vi.fn() }));

// @clack/prompts writes intro/outro/cancel directly to stdout (not console.log).
// Route them through console.log so the spy can observe the final messages, and
// stub confirm/isCancel (unused here since every run passes `--yes`).
vi.mock("@clack/prompts", () => ({
  intro: (msg: string) => console.log(msg),
  outro: (msg: string) => console.log(msg),
  cancel: (msg: string) => console.log(msg),
  confirm: vi.fn(async () => true),
  isCancel: vi.fn(() => false),
}));

const execSyncMock = vi.mocked(execSync);
const getCliVersionMock = vi.mocked(getCliVersion);

const LATEST = "2.0.0";

/** Build a fetch mock that resolves to the npm `latest` payload. */
function mockFetchOk(version: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      statusText: "OK",
      json: async () => ({ version }),
    })),
  );
}

describe("upgradeCliCommand", () => {
  let mockExit: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let originalArgv: string[];
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as () => never);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    originalArgv = [...process.argv];
    originalEnv = { ...process.env };
    execSyncMock.mockReset();
    getCliVersionMock.mockReset();
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.env = originalEnv;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Strip ANSI color codes: picocolors emits color when CI is set (so the shim
  // hints wrap their command in pc.cyan), which would otherwise break the
  // contiguous-substring assertions on output that spans a color boundary.
  const ESC = String.fromCharCode(27);
  const stripAnsi = (s: string) => s.replaceAll(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), "");

  // logger.info / logger.warn print to console.log; logger.error prints to console.error
  const logOutput = () => stripAnsi(logSpy.mock.calls.map((c) => c.join(" ")).join("\n"));
  const errorOutput = () => stripAnsi(errSpy.mock.calls.map((c) => c.join(" ")).join("\n"));

  it("rejects an invalid --package-manager value (src ~79-83)", async () => {
    // Current 1.0.0 < latest 2.0.0 so we reach the PM validation branch.
    getCliVersionMock.mockReturnValue("1.0.0");
    mockFetchOk(LATEST);

    await expect(upgradeCliCommand({ yes: true, packageManager: "cargo" })).rejects.toThrow(
      "process.exit called",
    );

    expect(mockExit).toHaveBeenCalledWith(1);
    expect(errorOutput()).toContain("Invalid package manager: cargo");
    expect(logOutput()).toContain("Valid options: npm, pnpm, yarn, bun, volta");
    // We must not have attempted an install.
    expect(execSyncMock).not.toHaveBeenCalled();
  });

  it("reports already up to date and returns without installing (src ~62-68)", async () => {
    // Current >= latest, so needsUpdate is false.
    getCliVersionMock.mockReturnValue("2.0.0");
    mockFetchOk(LATEST);

    await expect(upgradeCliCommand({ yes: true })).resolves.toBeUndefined();

    expect(mockExit).not.toHaveBeenCalled();
    expect(logOutput()).toContain("already up to date");
    expect(execSyncMock).not.toHaveBeenCalled();
  });

  it("exits 1 when the registry fetch returns ok:false (src ~50-54)", async () => {
    getCliVersionMock.mockReturnValue("1.0.0");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        statusText: "Not Found",
        json: async () => ({}),
      })),
    );

    await expect(upgradeCliCommand({ yes: true })).rejects.toThrow("process.exit called");

    expect(mockExit).toHaveBeenCalledWith(1);
    expect(errorOutput()).toContain("Failed to fetch package info: Not Found");
    expect(execSyncMock).not.toHaveBeenCalled();
  });

  it("exits 1 when fetch rejects (src ~50-54)", async () => {
    getCliVersionMock.mockReturnValue("1.0.0");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    await expect(upgradeCliCommand({ yes: true })).rejects.toThrow("process.exit called");

    expect(mockExit).toHaveBeenCalledWith(1);
    expect(errorOutput()).toContain("network down");
    expect(execSyncMock).not.toHaveBeenCalled();
  });

  it("performs a successful upgrade with --yes and --package-manager npm (src ~109-168)", async () => {
    getCliVersionMock.mockReturnValue("1.0.0");
    mockFetchOk(LATEST);
    // Install succeeds; `agconf --version` reports the new latest version.
    execSyncMock.mockImplementation(((command: string) => {
      if (command === "agconf --version") {
        return `${LATEST}\n`;
      }
      return "";
    }) as typeof execSync);

    await expect(upgradeCliCommand({ yes: true, packageManager: "npm" })).resolves.toBeUndefined();

    expect(mockExit).not.toHaveBeenCalled();
    // The npm global install command must have been run.
    expect(execSyncMock).toHaveBeenCalledWith(
      "npm install -g agconf@latest",
      expect.objectContaining({ stdio: "pipe" }),
    );
    expect(logOutput()).toContain(`CLI upgraded to ${LATEST}!`);
  });

  it("exits 1 and prints the manual-command hint when install fails (src ~118-126)", async () => {
    getCliVersionMock.mockReturnValue("1.0.0");
    mockFetchOk(LATEST);
    // The install command throws.
    execSyncMock.mockImplementation(((command: string) => {
      if (command === "npm install -g agconf@latest") {
        throw new Error("EACCES: permission denied");
      }
      return "";
    }) as typeof execSync);

    await expect(upgradeCliCommand({ yes: true, packageManager: "npm" })).rejects.toThrow(
      "process.exit called",
    );

    expect(mockExit).toHaveBeenCalledWith(1);
    expect(errorOutput()).toContain("EACCES: permission denied");
    // The manual-command hint goes through logger.info (console.log).
    expect(logOutput()).toContain("You can try manually: npm install -g agconf@latest");
  });

  it("detects a Volta shim on version mismatch (src ~152-162)", async () => {
    getCliVersionMock.mockReturnValue("1.0.0");
    mockFetchOk(LATEST);
    // Install succeeds, but the binary in $PATH still reports the OLD version.
    execSyncMock.mockImplementation(((command: string) => {
      if (command === "agconf --version") {
        return "1.0.0\n";
      }
      return "";
    }) as typeof execSync);

    // process.argv[1] -> a Volta-managed shim path.
    process.argv[1] = "/Users/me/.volta/bin/agconf";
    const realpathSpy = vi
      .spyOn(fs, "realpathSync")
      .mockReturnValue("/Users/me/.volta/tools/image/packages/agconf/bin/agconf" as never);

    await expect(upgradeCliCommand({ yes: true, packageManager: "npm" })).resolves.toBeUndefined();

    expect(mockExit).not.toHaveBeenCalled();
    expect(realpathSpy).toHaveBeenCalledWith("/Users/me/.volta/bin/agconf");
    expect(logOutput()).toContain("Version mismatch");
    expect(logOutput()).toContain("Volta detected. Run: volta install agconf@latest");
  });

  it("detects an asdf shim on version mismatch (bonus, src ~154-155)", async () => {
    getCliVersionMock.mockReturnValue("1.0.0");
    mockFetchOk(LATEST);
    execSyncMock.mockImplementation(((command: string) => {
      if (command === "agconf --version") {
        return "1.0.0\n";
      }
      return "";
    }) as typeof execSync);

    process.argv[1] = "/Users/me/.asdf/shims/agconf";
    vi.spyOn(fs, "realpathSync").mockReturnValue(
      "/Users/me/.asdf/installs/nodejs/20.0.0/bin/agconf" as never,
    );

    await expect(upgradeCliCommand({ yes: true, packageManager: "npm" })).resolves.toBeUndefined();

    // The reshim already ran and did not help, so re-suggesting it is useless.
    expect(logOutput()).toContain("The asdf step already ran");
    expect(logOutput()).toContain("which -a agconf");
  });

  it("auto-detects the package manager when the flag is omitted (src ~90-91)", async () => {
    getCliVersionMock.mockReturnValue("1.0.0");
    mockFetchOk(LATEST);
    execSyncMock.mockImplementation(((command: string) =>
      command === "agconf --version" ? `${LATEST}\n` : "") as typeof execSync);

    // Pin the binary so detection can't read the host's own node install, and
    // clear the agent the test runner itself sets so tier 2 is what answers.
    delete process.env.npm_config_user_agent;
    process.argv[1] = "/usr/local/bin/agconf";
    vi.spyOn(fs, "realpathSync").mockReturnValue(
      "/home/me/.local/share/pnpm/.pnpm-global/5/node_modules/agconf/dist/index.js" as never,
    );

    await expect(upgradeCliCommand({ yes: true })).resolves.toBeUndefined();

    expect(logOutput()).toContain("Package manager: pnpm (binary path)");
    expect(logOutput()).toContain("Will run:");
    expect(logOutput()).toContain("pnpm add -g agconf@latest");
    expect(logOutput()).toContain(`CLI upgraded to ${LATEST}!`);
  });

  it("aborts with exit 0 when the interactive confirm is declined (src ~97-107)", async () => {
    getCliVersionMock.mockReturnValue("1.0.0");
    mockFetchOk(LATEST);
    vi.mocked(prompts.confirm).mockResolvedValue(false as never);

    await expect(upgradeCliCommand({ packageManager: "npm" })).rejects.toThrow(
      "process.exit called",
    );

    expect(mockExit).toHaveBeenCalledWith(0);
    expect(logOutput()).toContain("Upgrade cancelled");
    expect(execSyncMock).not.toHaveBeenCalled();
  });

  it("aborts with exit 0 when the interactive confirm is cancelled (src ~103-106)", async () => {
    getCliVersionMock.mockReturnValue("1.0.0");
    mockFetchOk(LATEST);
    vi.mocked(prompts.confirm).mockResolvedValue(true as never);
    vi.mocked(prompts.isCancel).mockReturnValue(true);

    await expect(upgradeCliCommand({ packageManager: "npm" })).rejects.toThrow(
      "process.exit called",
    );

    expect(mockExit).toHaveBeenCalledWith(0);
    expect(execSyncMock).not.toHaveBeenCalled();
  });

  it("skips post-install verification when `agconf --version` cannot run (src ~133-135)", async () => {
    getCliVersionMock.mockReturnValue("1.0.0");
    mockFetchOk(LATEST);
    execSyncMock.mockImplementation(((command: string) => {
      if (command === "agconf --version") throw new Error("command not found");
      return "";
    }) as typeof execSync);

    await expect(upgradeCliCommand({ yes: true, packageManager: "npm" })).resolves.toBeUndefined();

    // Unverifiable is treated as success, not as a mismatch.
    expect(logOutput()).toContain(`CLI upgraded to ${LATEST}!`);
    expect(logOutput()).not.toContain("Version mismatch");
  });

  it("falls back to a concrete diagnostic for an unrecognized path", async () => {
    getCliVersionMock.mockReturnValue("1.0.0");
    mockFetchOk(LATEST);
    execSyncMock.mockImplementation(((command: string) =>
      command === "agconf --version" ? "1.0.0\n" : "") as typeof execSync);

    process.argv[1] = "/opt/weird/bin/agconf";
    // realpathSync failing must not break the mismatch report.
    vi.spyOn(fs, "realpathSync").mockImplementation((() => {
      throw new Error("ELOOP");
    }) as never);

    await expect(upgradeCliCommand({ yes: true, packageManager: "npm" })).resolves.toBeUndefined();

    expect(logOutput()).toContain("Version mismatch");
    // No tool manager was detected, so the advice must not guess at one.
    expect(logOutput()).not.toContain("tool manager");
    expect(logOutput()).toContain("which -a agconf");
    expect(logOutput()).toContain("Upgrade installed but not active in $PATH");
  });

  it("detects a mise shim on version mismatch (bonus, src ~156-157)", async () => {
    getCliVersionMock.mockReturnValue("1.0.0");
    mockFetchOk(LATEST);
    execSyncMock.mockImplementation(((command: string) => {
      if (command === "agconf --version") {
        return "1.0.0\n";
      }
      return "";
    }) as typeof execSync);

    process.argv[1] = "/Users/me/.local/bin/agconf";
    vi.spyOn(fs, "realpathSync").mockReturnValue(
      "/Users/me/.local/share/mise/installs/node/20.0.0/bin/agconf" as never,
    );

    await expect(upgradeCliCommand({ yes: true, packageManager: "npm" })).resolves.toBeUndefined();

    expect(logOutput()).toContain("The mise step already ran");
  });

  it("upgrades through volta when the binary is a volta shim", async () => {
    getCliVersionMock.mockReturnValue("1.0.0");
    mockFetchOk(LATEST);
    execSyncMock.mockImplementation(((command: string) =>
      command === "agconf --version" ? `${LATEST}\n` : "") as typeof execSync);

    process.argv[1] = "/Users/me/.volta/bin/agconf";
    vi.spyOn(fs, "realpathSync").mockReturnValue(
      "/Users/me/.volta/tools/image/packages/agconf/bin/agconf" as never,
    );

    await expect(upgradeCliCommand({ yes: true })).resolves.toBeUndefined();

    expect(logOutput()).toContain("Package manager: volta (volta shim)");
    // volta is both the installer and the shim — don't print it twice.
    expect(logOutput()).not.toContain("Tool manager:");
    expect(execSyncMock).toHaveBeenCalledWith(
      "volta install agconf@latest",
      expect.objectContaining({ stdio: "pipe" }),
    );
    expect(logOutput()).toContain(`CLI upgraded to ${LATEST}!`);
  });

  it("runs the reshim step after installing under a mise shim", async () => {
    getCliVersionMock.mockReturnValue("1.0.0");
    mockFetchOk(LATEST);
    execSyncMock.mockImplementation(((command: string) =>
      command === "agconf --version" ? `${LATEST}\n` : "") as typeof execSync);

    process.argv[1] = "/Users/me/.local/bin/agconf";
    vi.spyOn(fs, "realpathSync").mockReturnValue(
      "/Users/me/.local/share/mise/installs/node/20.0.0/bin/agconf" as never,
    );

    await expect(upgradeCliCommand({ yes: true, packageManager: "npm" })).resolves.toBeUndefined();

    expect(logOutput()).toContain("Tool manager:");
    // Order matters: a reshim after the verification would read the stale shim.
    expect(execSyncMock.mock.calls.map((c) => c[0])).toEqual([
      "npm install -g agconf@latest",
      "mise reshim",
      "agconf --version",
    ]);
    expect(logOutput()).toContain(`CLI upgraded to ${LATEST}!`);
  });

  it("warns but still succeeds when the reshim step fails", async () => {
    getCliVersionMock.mockReturnValue("1.0.0");
    mockFetchOk(LATEST);
    execSyncMock.mockImplementation(((command: string) => {
      if (command === "asdf reshim") throw new Error("asdf: not found");
      return command === "agconf --version" ? `${LATEST}\n` : "";
    }) as typeof execSync);

    process.argv[1] = "/Users/me/.asdf/shims/agconf";
    vi.spyOn(fs, "realpathSync").mockReturnValue(
      "/Users/me/.asdf/installs/nodejs/20.0.0/bin/agconf" as never,
    );

    await expect(upgradeCliCommand({ yes: true, packageManager: "npm" })).resolves.toBeUndefined();

    expect(mockExit).not.toHaveBeenCalled();
    expect(logOutput()).toContain("asdf: not found");
    expect(logOutput()).toContain("You can try manually: asdf reshim");
    // The install itself worked, so this is not a failure — but it must not be
    // reported as an unqualified success either.
    expect(logOutput()).toContain(`CLI upgraded to ${LATEST}, but the asdf shim rebuild failed`);
    expect(logOutput()).not.toContain(`CLI upgraded to ${LATEST}!`);
  });

  it("does not run a reshim for a plain global install", async () => {
    getCliVersionMock.mockReturnValue("1.0.0");
    mockFetchOk(LATEST);
    execSyncMock.mockImplementation(((command: string) =>
      command === "agconf --version" ? `${LATEST}\n` : "") as typeof execSync);

    process.argv[1] = "/usr/local/bin/agconf";
    vi.spyOn(fs, "realpathSync").mockReturnValue(
      "/usr/local/lib/node_modules/agconf/dist/index.js" as never,
    );

    await expect(upgradeCliCommand({ yes: true, packageManager: "npm" })).resolves.toBeUndefined();

    expect(logOutput()).not.toContain("Tool manager:");
    const commands = execSyncMock.mock.calls.map((c) => c[0]);
    expect(commands).toEqual(["npm install -g agconf@latest", "agconf --version"]);
  });

  it("honors --package-manager volta on a machine with no shim", async () => {
    getCliVersionMock.mockReturnValue("1.0.0");
    mockFetchOk(LATEST);
    execSyncMock.mockImplementation(((command: string) =>
      command === "agconf --version" ? `${LATEST}\n` : "") as typeof execSync);

    process.argv[1] = "/usr/local/bin/agconf";
    vi.spyOn(fs, "realpathSync").mockReturnValue(
      "/usr/local/lib/node_modules/agconf/dist/index.js" as never,
    );

    await expect(
      upgradeCliCommand({ yes: true, packageManager: "volta" }),
    ).resolves.toBeUndefined();

    expect(logOutput()).toContain("Package manager: volta (--package-manager flag)");
    // No shim was detected, so nothing may be reported or run beyond the install.
    expect(logOutput()).not.toContain("Tool manager:");
    expect(execSyncMock.mock.calls.map((c) => c[0])).toEqual([
      "volta install agconf@latest",
      "agconf --version",
    ]);
  });

  it("names the volta installer, not `undefined`, when no shim was detected", async () => {
    getCliVersionMock.mockReturnValue("1.0.0");
    mockFetchOk(LATEST);
    // Install succeeds but $PATH still serves the old binary.
    execSyncMock.mockImplementation(((command: string) =>
      command === "agconf --version" ? "1.0.0\n" : "") as typeof execSync);

    process.argv[1] = "/usr/local/bin/agconf";
    vi.spyOn(fs, "realpathSync").mockReturnValue(
      "/usr/local/lib/node_modules/agconf/dist/index.js" as never,
    );

    await expect(
      upgradeCliCommand({ yes: true, packageManager: "volta" }),
    ).resolves.toBeUndefined();

    expect(logOutput()).toContain("The volta step already ran");
    expect(logOutput()).not.toContain("undefined");
  });

  it("still reshims when --package-manager overrides the installer", async () => {
    getCliVersionMock.mockReturnValue("1.0.0");
    mockFetchOk(LATEST);
    execSyncMock.mockImplementation(((command: string) =>
      command === "agconf --version" ? `${LATEST}\n` : "") as typeof execSync);

    process.argv[1] = "/Users/me/.asdf/shims/agconf";
    vi.spyOn(fs, "realpathSync").mockReturnValue(
      "/Users/me/.asdf/installs/nodejs/20.0.0/bin/agconf" as never,
    );

    await expect(upgradeCliCommand({ yes: true, packageManager: "pnpm" })).resolves.toBeUndefined();

    expect(logOutput()).toContain("Tool manager:");
    expect(execSyncMock.mock.calls.map((c) => c[0])).toEqual([
      "pnpm add -g agconf@latest",
      "asdf reshim",
      "agconf --version",
    ]);
  });

  it("explains why a tool manager is not a --package-manager value", async () => {
    getCliVersionMock.mockReturnValue("1.0.0");
    mockFetchOk(LATEST);

    await expect(upgradeCliCommand({ yes: true, packageManager: "asdf" })).rejects.toThrow(
      "process.exit called",
    );

    expect(mockExit).toHaveBeenCalledWith(1);
    expect(errorOutput()).toContain("Invalid package manager: asdf");
    expect(logOutput()).toContain("asdf is detected automatically");
    expect(execSyncMock).not.toHaveBeenCalled();
  });

  it("suggests an alternate manager only when none was supplied", async () => {
    getCliVersionMock.mockReturnValue("1.0.0");
    mockFetchOk(LATEST);
    execSyncMock.mockImplementation((() => {
      throw new Error("EACCES: permission denied");
    }) as typeof execSync);

    process.argv[1] = "/usr/local/bin/agconf";
    vi.spyOn(fs, "realpathSync").mockReturnValue(
      "/usr/local/lib/node_modules/agconf/dist/index.js" as never,
    );

    // Explicit flag: re-suggesting the flag the user just used is noise.
    await expect(upgradeCliCommand({ yes: true, packageManager: "npm" })).rejects.toThrow(
      "process.exit called",
    );
    expect(logOutput()).not.toContain("If npm is not your package manager");

    logSpy.mockClear();

    // Auto-detected: the override hint is the useful next step.
    await expect(upgradeCliCommand({ yes: true })).rejects.toThrow("process.exit called");
    expect(logOutput()).toContain("--package-manager");
  });
});
