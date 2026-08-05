import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { compileCommand } from "../../src/commands/compile.js";

interface SetupOptions {
  plugins?: Record<string, unknown> | null;
  withAgent?: boolean;
}

async function setupCanonical(dir: string, options: SetupOptions = {}): Promise<void> {
  await fs.mkdir(path.join(dir, "instructions"), { recursive: true });
  await fs.writeFile(path.join(dir, "instructions", "AGENTS.md"), "# Standards\n");

  const skillDir = path.join(dir, "skills", "alpha");
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, "SKILL.md"),
    "---\nname: alpha\ndescription: The alpha skill\n---\n\n# alpha\n",
  );

  if (options.withAgent) {
    await fs.mkdir(path.join(dir, "agents"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "agents", "reviewer.md"),
      "---\nname: reviewer\ndescription: Reviews things\n---\n\n# reviewer\n",
    );
  }

  const config: Record<string, unknown> = {
    version: "1.0.0",
    meta: { name: "acme" },
    content: {
      instructions: "instructions/AGENTS.md",
      skills_dir: "skills",
      ...(options.withAgent ? { agents_dir: "agents" } : {}),
    },
    targets: ["claude", "codex"],
  };
  if (options.plugins !== null) {
    config.plugins = options.plugins ?? {
      version: "1.0.0",
      marketplace: { name: "acme-tools", owner: { name: "Acme Corp" } },
    };
  }
  await fs.writeFile(path.join(dir, "agconf.yaml"), stringifyYaml(config));
}

async function exists(p: string): Promise<boolean> {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false);
}

describe("compile command", () => {
  let tempDir: string;
  let mockExit: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-compile-cmd-"));
    mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as () => never);
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    mockExit.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("error paths", () => {
    it("errors when no agconf.yaml exists", async () => {
      await expect(compileCommand({ cwd: tempDir })).rejects.toThrow("process.exit called");
      expect(mockExit).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("No agconf.yaml"));
    });

    it("errors when agconf.yaml has no plugins block", async () => {
      await setupCanonical(tempDir, { plugins: null });
      await expect(compileCommand({ cwd: tempDir })).rejects.toThrow("process.exit called");
      expect(mockExit).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("plugins"));
    });
  });

  describe("compile", () => {
    it("writes plugin artifacts and both marketplaces", async () => {
      await setupCanonical(tempDir, { withAgent: true });
      await compileCommand({ cwd: tempDir });

      expect(await exists(path.join(tempDir, ".claude-plugin", "marketplace.json"))).toBe(true);
      expect(await exists(path.join(tempDir, ".agents", "plugins", "marketplace.json"))).toBe(true);
      expect(
        await exists(
          path.join(tempDir, "plugins", "claude", "acme-tools", "agents", "reviewer.md"),
        ),
      ).toBe(true);
      // Codex down-converts the agent to a skill
      expect(
        await exists(
          path.join(tempDir, "plugins", "codex", "acme-tools", "skills", "reviewer", "SKILL.md"),
        ),
      ).toBe(true);
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("honors --target to compile a single target", async () => {
      await setupCanonical(tempDir);
      await compileCommand({ cwd: tempDir, target: ["claude"] });

      expect(await exists(path.join(tempDir, ".claude-plugin", "marketplace.json"))).toBe(true);
      expect(await exists(path.join(tempDir, ".agents", "plugins", "marketplace.json"))).toBe(
        false,
      );
    });

    it("honors --out to override the output directory", async () => {
      await setupCanonical(tempDir);
      await compileCommand({ cwd: tempDir, out: "dist-plugins", target: ["claude"] });

      expect(await exists(path.join(tempDir, "dist-plugins", "claude", "acme-tools"))).toBe(true);
      const mkt = JSON.parse(
        await fs.readFile(path.join(tempDir, ".claude-plugin", "marketplace.json"), "utf-8"),
      );
      expect(mkt.plugins[0].source).toBe("./dist-plugins/claude/acme-tools");
    });
  });

  describe("--check", () => {
    it("passes immediately after a compile", async () => {
      await setupCanonical(tempDir, { withAgent: true });
      await compileCommand({ cwd: tempDir });

      await compileCommand({ cwd: tempDir, check: true });
      expect(mockExit).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("up to date"));
    });

    it("fails (exit 1) when committed artifacts are stale", async () => {
      await setupCanonical(tempDir);
      await compileCommand({ cwd: tempDir, target: ["claude"] });

      // Tamper with a committed artifact.
      await fs.writeFile(
        path.join(tempDir, "plugins", "claude", "acme-tools", "skills", "alpha", "SKILL.md"),
        "tampered\n",
      );

      await expect(
        compileCommand({ cwd: tempDir, target: ["claude"], check: true }),
      ).rejects.toThrow("process.exit called");
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("fails (exit 1) when artifacts were never compiled", async () => {
      await setupCanonical(tempDir, { withAgent: true });
      await expect(compileCommand({ cwd: tempDir, check: true })).rejects.toThrow(
        "process.exit called",
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("exits 1 silently in quiet mode when stale", async () => {
      await setupCanonical(tempDir, { withAgent: true });
      await expect(compileCommand({ cwd: tempDir, check: true, quiet: true })).rejects.toThrow(
        "process.exit called",
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe("--bump", () => {
    const stateFile = () => path.join(tempDir, ".agconf", "plugins-state.json");
    const agconfVersion = async (): Promise<string | undefined> => {
      const cfg = parseYaml(await fs.readFile(path.join(tempDir, "agconf.yaml"), "utf-8")) as {
        plugins?: { version?: string; definitions?: Array<{ name: string; version?: string }> };
      };
      return cfg.plugins?.version;
    };
    const claudeManifestVersion = async (plugin: string): Promise<string> => {
      const raw = await fs.readFile(
        path.join(tempDir, "plugins", "claude", plugin, ".claude-plugin", "plugin.json"),
        "utf-8",
      );
      return (JSON.parse(raw) as { version: string }).version;
    };

    it("initializes a fingerprint baseline without bumping on first run", async () => {
      await setupCanonical(tempDir);
      await compileCommand({ cwd: tempDir, bump: true });

      expect(await exists(stateFile())).toBe(true);
      expect(await agconfVersion()).toBe("1.0.0"); // no bump
      expect(await exists(path.join(tempDir, ".claude-plugin", "marketplace.json"))).toBe(true);
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("bumps patch for a plugin whose content changed", async () => {
      await setupCanonical(tempDir);
      await compileCommand({ cwd: tempDir, bump: true }); // baseline

      // Change skill content.
      await fs.writeFile(
        path.join(tempDir, "skills", "alpha", "SKILL.md"),
        "---\nname: alpha\ndescription: The alpha skill\n---\n\n# alpha (edited)\n",
      );

      await compileCommand({ cwd: tempDir, bump: true });

      expect(await agconfVersion()).toBe("1.0.1");
      expect(await claudeManifestVersion("acme-tools")).toBe("1.0.1");
      expect(mockExit).not.toHaveBeenCalled();

      // AC: committed artifacts are fresh at the bumped version -> --check green.
      await compileCommand({ cwd: tempDir, check: true });
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("does not bump when content is unchanged", async () => {
      await setupCanonical(tempDir);
      await compileCommand({ cwd: tempDir, bump: true }); // baseline
      await compileCommand({ cwd: tempDir, bump: true }); // no edits

      expect(await agconfVersion()).toBe("1.0.0");
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("forces a minor bump with --bump=minor", async () => {
      await setupCanonical(tempDir);
      await compileCommand({ cwd: tempDir, bump: true }); // baseline
      await fs.writeFile(
        path.join(tempDir, "skills", "alpha", "SKILL.md"),
        "---\nname: alpha\ndescription: The alpha skill\n---\n\n# alpha (edited)\n",
      );

      await compileCommand({ cwd: tempDir, bump: "minor" });

      expect(await agconfVersion()).toBe("1.1.0");
    });

    it("bumps only the plugin whose content changed (per-plugin definitions)", async () => {
      await fs.mkdir(path.join(tempDir, "skills", "beta"), { recursive: true });
      await fs.writeFile(
        path.join(tempDir, "skills", "beta", "SKILL.md"),
        "---\nname: beta\ndescription: The beta skill\n---\n\n# beta\n",
      );
      await setupCanonical(tempDir, {
        plugins: {
          version: "1.0.0",
          marketplace: { name: "acme-tools", owner: { name: "Acme Corp" } },
          definitions: [
            { name: "alpha-plugin", skills: ["alpha"] },
            { name: "beta-plugin", skills: ["beta"] },
          ],
        },
      });
      await compileCommand({ cwd: tempDir, bump: true }); // baseline

      // Edit only alpha's skill.
      await fs.writeFile(
        path.join(tempDir, "skills", "alpha", "SKILL.md"),
        "---\nname: alpha\ndescription: The alpha skill\n---\n\n# alpha (edited)\n",
      );
      await compileCommand({ cwd: tempDir, bump: true });

      const cfg = parseYaml(await fs.readFile(path.join(tempDir, "agconf.yaml"), "utf-8")) as {
        plugins: { version: string; definitions: Array<{ name: string; version?: string }> };
      };
      const alpha = cfg.plugins.definitions.find((d) => d.name === "alpha-plugin");
      const beta = cfg.plugins.definitions.find((d) => d.name === "beta-plugin");
      expect(alpha?.version).toBe("1.0.1"); // bumped
      expect(beta?.version).toBeUndefined(); // untouched (still uses global 1.0.0)
      expect(await claudeManifestVersion("alpha-plugin")).toBe("1.0.1");
      expect(await claudeManifestVersion("beta-plugin")).toBe("1.0.0");
    });

    it("errors on an invalid --bump level", async () => {
      await setupCanonical(tempDir);
      await expect(compileCommand({ cwd: tempDir, bump: "bogus" })).rejects.toThrow(
        "process.exit called",
      );
      expect(mockExit).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid --bump"));
    });
  });
});
