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

  beforeEach(() => {
    mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as () => never);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    originalArgv = [...process.argv];
    execSyncMock.mockReset();
    getCliVersionMock.mockReset();
  });

  afterEach(() => {
    process.argv = originalArgv;
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
    expect(logOutput()).toContain("Valid options: npm, pnpm, yarn, bun");
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
    // Manual-command hint and the alternate-PM hint go through logger.info (console.log).
    expect(logOutput()).toContain("You can try manually: npm install -g agconf@latest");
    expect(logOutput()).toContain("--package-manager");
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

    expect(logOutput()).toContain("asdf detected. Run: asdf reshim nodejs");
  });

  it("auto-detects the package manager when the flag is omitted (src ~90-91)", async () => {
    getCliVersionMock.mockReturnValue("1.0.0");
    mockFetchOk(LATEST);
    execSyncMock.mockImplementation(((command: string) =>
      command === "agconf --version" ? `${LATEST}\n` : "") as typeof execSync);

    await expect(upgradeCliCommand({ yes: true })).resolves.toBeUndefined();

    // Whatever is detected, it must be one of the supported managers and be
    // reported with the reason it was chosen.
    expect(logOutput()).toMatch(/Package manager: (npm|pnpm|yarn|bun) \(.+\)/);
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

  it("falls back to a generic shim hint for an unrecognized path (src ~147-150,159-161)", async () => {
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
    expect(logOutput()).toContain("Your tool manager may be shimming the binary");
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

    expect(logOutput()).toContain("mise detected. Run: mise reshim");
  });
});
