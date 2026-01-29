import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock tabtab
vi.mock("tabtab", () => ({
  default: {
    parseEnv: vi.fn(),
    log: vi.fn(),
    install: vi.fn(),
    uninstall: vi.fn(),
  },
}));

// Mock node:fs
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(),
      readFileSync: vi.fn(),
    },
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

// Import mocked modules
import fs from "node:fs";
import tabtab from "tabtab";
import {
  detectShell,
  getShellConfigFile,
  handleCompletion,
  isCompletionInstalled,
} from "../../src/commands/completion.js";

describe("completion", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("detectShell", () => {
    it("should detect fish from SHELL", () => {
      process.env.SHELL = "/bin/fish";
      expect(detectShell()).toBe("fish");
    });

    it("should detect fish from full path", () => {
      process.env.SHELL = "/usr/local/bin/fish";
      expect(detectShell()).toBe("fish");
    });

    it("should detect zsh from SHELL", () => {
      process.env.SHELL = "/bin/zsh";
      expect(detectShell()).toBe("zsh");
    });

    it("should detect zsh from full path", () => {
      process.env.SHELL = "/usr/local/bin/zsh";
      expect(detectShell()).toBe("zsh");
    });

    it("should detect bash from SHELL", () => {
      process.env.SHELL = "/bin/bash";
      expect(detectShell()).toBe("bash");
    });

    it("should return null for unknown shell", () => {
      process.env.SHELL = "/bin/sh";
      expect(detectShell()).toBeNull();
    });

    it("should return null when SHELL is not set", () => {
      delete process.env.SHELL;
      expect(detectShell()).toBeNull();
    });

    it("should return null for empty SHELL", () => {
      process.env.SHELL = "";
      expect(detectShell()).toBeNull();
    });
  });

  describe("getShellConfigFile", () => {
    const home = os.homedir();

    it("should return .zshrc for zsh", () => {
      expect(getShellConfigFile("zsh")).toBe(path.join(home, ".zshrc"));
    });

    it("should return fish config path for fish", () => {
      expect(getShellConfigFile("fish")).toBe(path.join(home, ".config", "fish", "config.fish"));
    });

    it("should return null for unknown shell", () => {
      expect(getShellConfigFile("sh")).toBeNull();
      expect(getShellConfigFile("csh")).toBeNull();
      expect(getShellConfigFile("")).toBeNull();
    });

    describe("bash config file selection", () => {
      const bashProfile = path.join(home, ".bash_profile");
      const bashrc = path.join(home, ".bashrc");

      it("should prefer .bash_profile when it exists", () => {
        vi.mocked(fs.existsSync).mockImplementation((p) => p === bashProfile);

        expect(getShellConfigFile("bash")).toBe(bashProfile);
      });

      it("should fall back to .bashrc when .bash_profile does not exist", () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);

        expect(getShellConfigFile("bash")).toBe(bashrc);
      });
    });
  });

  describe("handleCompletion", () => {
    it("should return false when not in completion mode", () => {
      vi.mocked(tabtab.parseEnv).mockReturnValue({
        complete: false,
        words: 0,
        point: 0,
        line: "",
        partial: "",
        last: "",
        lastPartial: "",
        prev: "",
      });

      expect(handleCompletion()).toBe(false);
      expect(tabtab.log).not.toHaveBeenCalled();
    });

    it("should complete command names when at first position", () => {
      vi.mocked(tabtab.parseEnv).mockReturnValue({
        complete: true,
        words: 1,
        point: 11,
        line: "agent-conf ",
        partial: "",
        last: "",
        lastPartial: "",
        prev: "agent-conf",
      });

      expect(handleCompletion()).toBe(true);
      expect(tabtab.log).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ name: "init" }),
          expect.objectContaining({ name: "sync" }),
          expect.objectContaining({ name: "status" }),
          expect.objectContaining({ name: "config" }),
          expect.objectContaining({ name: "completion" }),
        ]),
      );
    });

    it("should complete config subcommands", () => {
      vi.mocked(tabtab.parseEnv).mockReturnValue({
        complete: true,
        words: 2,
        point: 18,
        line: "agent-conf config ",
        partial: "",
        last: "",
        lastPartial: "",
        prev: "config",
      });

      expect(handleCompletion()).toBe(true);
      expect(tabtab.log).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ name: "show" }),
          expect.objectContaining({ name: "get" }),
          expect.objectContaining({ name: "set" }),
        ]),
      );
    });

    it("should complete completion subcommands", () => {
      vi.mocked(tabtab.parseEnv).mockReturnValue({
        complete: true,
        words: 2,
        point: 22,
        line: "agent-conf completion ",
        partial: "",
        last: "",
        lastPartial: "",
        prev: "completion",
      });

      expect(handleCompletion()).toBe(true);
      expect(tabtab.log).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ name: "install" }),
          expect.objectContaining({ name: "uninstall" }),
        ]),
      );
    });

    it("should complete --target values", () => {
      vi.mocked(tabtab.parseEnv).mockReturnValue({
        complete: true,
        words: 3,
        point: 25,
        line: "agent-conf init --target ",
        partial: "",
        last: "",
        lastPartial: "",
        prev: "--target",
      });

      expect(handleCompletion()).toBe(true);
      expect(tabtab.log).toHaveBeenCalledWith(["claude", "codex"]);
    });

    it("should complete -t values (short form)", () => {
      vi.mocked(tabtab.parseEnv).mockReturnValue({
        complete: true,
        words: 3,
        point: 19,
        line: "agent-conf init -t ",
        partial: "",
        last: "",
        lastPartial: "",
        prev: "-t",
      });

      expect(handleCompletion()).toBe(true);
      expect(tabtab.log).toHaveBeenCalledWith(["claude", "codex"]);
    });

    it("should complete options for init command", () => {
      vi.mocked(tabtab.parseEnv).mockReturnValue({
        complete: true,
        words: 2,
        point: 16,
        line: "agent-conf init ",
        partial: "",
        last: "",
        lastPartial: "",
        prev: "init",
      });

      expect(handleCompletion()).toBe(true);
      expect(tabtab.log).toHaveBeenCalledWith(
        expect.arrayContaining(["--source", "-s", "--yes", "-y", "--target", "-t"]),
      );
    });

    it("should complete options for check command", () => {
      vi.mocked(tabtab.parseEnv).mockReturnValue({
        complete: true,
        words: 2,
        point: 17,
        line: "agent-conf check ",
        partial: "",
        last: "",
        lastPartial: "",
        prev: "check",
      });

      expect(handleCompletion()).toBe(true);
      expect(tabtab.log).toHaveBeenCalledWith(expect.arrayContaining(["-q", "--quiet"]));
    });

    it("should complete options for sync command", () => {
      vi.mocked(tabtab.parseEnv).mockReturnValue({
        complete: true,
        words: 2,
        point: 16,
        line: "agent-conf sync ",
        partial: "",
        last: "",
        lastPartial: "",
        prev: "sync",
      });

      expect(handleCompletion()).toBe(true);
      expect(tabtab.log).toHaveBeenCalledWith(
        expect.arrayContaining(["--source", "-s", "--local", "--ref"]),
      );
    });

    it("should complete options for upgrade-cli command", () => {
      vi.mocked(tabtab.parseEnv).mockReturnValue({
        complete: true,
        words: 2,
        point: 23,
        line: "agent-conf upgrade-cli ",
        partial: "",
        last: "",
        lastPartial: "",
        prev: "upgrade-cli",
      });

      expect(handleCompletion()).toBe(true);
      expect(tabtab.log).toHaveBeenCalledWith(expect.arrayContaining(["-r", "--repo", "-y", "--yes"]));
    });

    it("should fall back to command names for unknown input", () => {
      vi.mocked(tabtab.parseEnv).mockReturnValue({
        complete: true,
        words: 2,
        point: 20,
        line: "agent-conf unknown ",
        partial: "",
        last: "",
        lastPartial: "",
        prev: "unknown",
      });

      expect(handleCompletion()).toBe(true);
      expect(tabtab.log).toHaveBeenCalledWith(
        expect.arrayContaining(["init", "sync", "status", "config", "completion"]),
      );
    });
  });

  describe("isCompletionInstalled", () => {
    const home = os.homedir();

    it("should return false when shell is not detected", () => {
      delete process.env.SHELL;
      expect(isCompletionInstalled()).toBe(false);
    });

    it("should return true when tabtab completion file exists for zsh", () => {
      process.env.SHELL = "/bin/zsh";
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return p === path.join(home, ".config", "tabtab", "agent-conf.zsh");
      });

      expect(isCompletionInstalled()).toBe(true);
    });

    it("should return true when tabtab completion file exists for fish", () => {
      process.env.SHELL = "/bin/fish";
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return p === path.join(home, ".config", "tabtab", "agent-conf.fish");
      });

      expect(isCompletionInstalled()).toBe(true);
    });

    it("should return true when tabtab completion file exists for bash", () => {
      process.env.SHELL = "/bin/bash";
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return p === path.join(home, ".config", "tabtab", "agent-conf.bash");
      });

      expect(isCompletionInstalled()).toBe(true);
    });

    it("should fall back to checking shell config when completion file does not exist", () => {
      process.env.SHELL = "/bin/zsh";
      const zshrc = path.join(home, ".zshrc");
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        // Completion file doesn't exist, but shell config does
        return p === zshrc;
      });
      vi.mocked(fs.readFileSync).mockReturnValue(
        "# some config\n# tabtab source for agent-conf\nsource ~/.config/tabtab/agent-conf.zsh\n",
      );

      expect(isCompletionInstalled()).toBe(true);
      expect(fs.readFileSync).toHaveBeenCalledWith(zshrc, "utf-8");
    });

    it("should return true when fish begin comment is present in config", () => {
      process.env.SHELL = "/bin/fish";
      const fishConfig = path.join(home, ".config", "fish", "config.fish");
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        // Completion file doesn't exist, but shell config does
        return p === fishConfig;
      });
      vi.mocked(fs.readFileSync).mockReturnValue(
        "# some config\n# begin agent-conf\nsource ~/.config/tabtab/agent-conf.fish\n# end agent-conf\n",
      );

      expect(isCompletionInstalled()).toBe(true);
    });

    it("should return false when neither completion file nor config markers exist", () => {
      process.env.SHELL = "/bin/zsh";
      const zshrc = path.join(home, ".zshrc");
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        // Only shell config exists, not completion file
        return p === zshrc;
      });
      vi.mocked(fs.readFileSync).mockReturnValue(
        "# some other config\nexport PATH=/usr/local/bin:$PATH\n",
      );

      expect(isCompletionInstalled()).toBe(false);
    });

    it("should return false when shell config does not exist", () => {
      process.env.SHELL = "/bin/zsh";
      vi.mocked(fs.existsSync).mockReturnValue(false);

      expect(isCompletionInstalled()).toBe(false);
    });

    it("should return false when reading config file throws", () => {
      process.env.SHELL = "/bin/zsh";
      const zshrc = path.join(home, ".zshrc");
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return p === zshrc;
      });
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("Permission denied");
      });

      expect(isCompletionInstalled()).toBe(false);
    });
  });
});
