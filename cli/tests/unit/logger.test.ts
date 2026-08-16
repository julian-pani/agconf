import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger, formatPath } from "../../src/utils/logger.js";

describe("logger", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  const logged = () => logSpy.mock.calls.map((c) => c.join(" ")).join("\n");

  describe("createLogger()", () => {
    it("writes info/success/warn/dim to stdout and error to stderr", () => {
      const logger = createLogger();

      logger.info("an info");
      logger.success("a success");
      logger.warn("a warning");
      logger.dim("a dim note");
      logger.error("a failure");

      const out = logged();
      expect(out).toContain("an info");
      expect(out).toContain("a success");
      expect(out).toContain("a warning");
      expect(out).toContain("a dim note");
      // Errors must go to stderr so they survive stdout redirection/piping.
      expect(out).not.toContain("a failure");
      expect(errSpy.mock.calls.map((c) => c.join(" ")).join("\n")).toContain("a failure");
    });
  });

  describe("createLogger(quiet)", () => {
    it("suppresses informational output but still reports warnings and errors", () => {
      const logger = createLogger(true);

      logger.info("an info");
      logger.success("a success");
      logger.dim("a dim note");
      logger.warn("a warning");
      logger.error("a failure");

      // Warnings and errors are never silenced — quiet is about noise, not problems.
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logged()).toContain("a warning");
      expect(logged()).not.toContain("an info");
      expect(logged()).not.toContain("a success");
      expect(logged()).not.toContain("a dim note");
      expect(errSpy.mock.calls.map((c) => c.join(" ")).join("\n")).toContain("a failure");
    });

    it("returns a silent spinner in quiet mode", () => {
      const spinner = createLogger(true).spinner("working");
      expect(spinner.isSilent).toBe(true);

      const loud = createLogger().spinner("working");
      expect(loud.isSilent).toBe(false);
    });
  });

  describe("formatPath", () => {
    it("rewrites paths under cwd as ./-relative", () => {
      expect(formatPath("/repo/src/index.ts", "/repo")).toBe("./src/index.ts");
      expect(formatPath("/repo", "/repo")).toBe(".");
    });

    it("leaves paths outside cwd absolute", () => {
      expect(formatPath("/elsewhere/file.ts", "/repo")).toBe("/elsewhere/file.ts");
    });

    it("defaults to process.cwd()", () => {
      expect(formatPath(path.join(process.cwd(), "pkg.json"))).toBe(`.${path.sep}pkg.json`);
    });
  });
});
