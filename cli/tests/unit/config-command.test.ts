import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  configGetCommand,
  configSetCommand,
  configShowCommand,
} from "../../src/commands/config.js";

/**
 * Command-level tests for `agconf config`. There are currently no global
 * configuration options, so the contract is: `show` reports that and succeeds,
 * while `get`/`set` reject ANY key with exit 1 (never silently accept one).
 */
describe("config command", () => {
  let mockExit: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as () => never);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // @clack/prompts writes intro/outro straight to stdout.
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    mockExit.mockRestore();
    logSpy.mockRestore();
    errSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  const logOutput = () => logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
  const errorOutput = () => errSpy.mock.calls.map((c) => c.join(" ")).join("\n");

  describe("configShowCommand", () => {
    it("reports that no options are available and exits cleanly", async () => {
      await configShowCommand();

      expect(mockExit).not.toHaveBeenCalled();
      const out = logOutput();
      expect(out).toContain("Global Configuration:");
      expect(out).toContain("No configuration options available.");
      expect(out).toContain("~/.agconf/config.json");
    });
  });

  describe("configGetCommand", () => {
    it("rejects any key with exit 1 and names the key", async () => {
      await expect(configGetCommand("some.key")).rejects.toThrow("process.exit called");

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(errorOutput()).toContain("Unknown config key: some.key");
      expect(logOutput()).toContain("No configuration options available.");
    });
  });

  describe("configSetCommand", () => {
    it("rejects any key/value pair with exit 1 and never echoes the value", async () => {
      await expect(configSetCommand("some.key", "secret-value")).rejects.toThrow(
        "process.exit called",
      );

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(errorOutput()).toContain("Unknown config key: some.key");
      expect(errorOutput()).not.toContain("secret-value");
      expect(logOutput()).not.toContain("secret-value");
    });
  });
});
