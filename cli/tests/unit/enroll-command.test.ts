import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stringify as stringifyYaml } from "yaml";
import { enrollCommand } from "../../src/commands/enroll.js";
import { PluginsConfigSchema } from "../../src/config/schema.js";
import { compilePlugins } from "../../src/core/plugins.js";
import type { ResolvedSource } from "../../src/core/source.js";

interface EnrollBlock {
  marketplace: string;
  source: { repository: string; ref?: string };
  plugins: string[];
}

async function writeDownstreamConfig(dir: string, enrollment?: EnrollBlock): Promise<void> {
  await fs.mkdir(path.join(dir, ".agconf"), { recursive: true });
  const config = enrollment ? { experimental: { enrollment } } : { targets: ["claude"] };
  await fs.writeFile(path.join(dir, ".agconf", "config.yaml"), stringifyYaml(config));
}

async function readSettings(dir: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(path.join(dir, ".claude", "settings.json"), "utf-8"));
}

describe("enroll command", () => {
  let dir: string;
  let mockExit: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-enroll-cmd-"));
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
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("errors when there is no enrollment block", async () => {
    await writeDownstreamConfig(dir);
    await expect(enrollCommand({ cwd: dir })).rejects.toThrow("process.exit called");
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("experimental.enrollment"),
    );
  });

  it("writes extraKnownMarketplaces + enabledPlugins to .claude/settings.json", async () => {
    await writeDownstreamConfig(dir, {
      marketplace: "acme-tools",
      source: { repository: "acme/standards", ref: "v2.3.0" },
      plugins: ["base", "frontend"],
    });

    await enrollCommand({ cwd: dir });

    const settings = await readSettings(dir);
    expect(settings.extraKnownMarketplaces).toEqual({
      "acme-tools": { source: { source: "github", repo: "acme/standards", ref: "v2.3.0" } },
    });
    expect(settings.enabledPlugins).toEqual(["base@acme-tools", "frontend@acme-tools"]);
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("preserves existing settings keys", async () => {
    await fs.mkdir(path.join(dir, ".claude"), { recursive: true });
    await fs.writeFile(
      path.join(dir, ".claude", "settings.json"),
      JSON.stringify({ model: "claude-sonnet-5" }),
    );
    await writeDownstreamConfig(dir, {
      marketplace: "acme-tools",
      source: { repository: "acme/standards" },
      plugins: ["base"],
    });

    await enrollCommand({ cwd: dir });

    const settings = await readSettings(dir);
    expect(settings.model).toBe("claude-sonnet-5");
    expect(settings.enabledPlugins).toEqual(["base@acme-tools"]);
  });

  it("surfaces overlap warnings when --local canonical is provided", async () => {
    // Build a compiled canonical with two overlapping plugins.
    const canonical = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-enroll-canon-"));
    try {
      for (const name of ["shared", "a", "b"]) {
        await fs.mkdir(path.join(canonical, "skills", name), { recursive: true });
        await fs.writeFile(
          path.join(canonical, "skills", name, "SKILL.md"),
          `---\nname: ${name}\ndescription: ${name}\n---\n\n# ${name}\n`,
        );
      }
      const cfg = PluginsConfigSchema.parse({
        version: "1.0.0",
        marketplace: { name: "acme-tools", owner: { name: "Acme" } },
        definitions: [
          { name: "frontend", skills: ["shared", "a"] },
          { name: "backend", skills: ["shared", "b"] },
        ],
      });
      const source: ResolvedSource = {
        source: { type: "local", path: canonical },
        basePath: canonical,
        agentsMdPath: path.join(canonical, "instructions", "AGENTS.md"),
        skillsPath: path.join(canonical, "skills"),
        rulesPath: null,
        agentsPath: null,
        mcpsPath: null,
        markerPrefix: "agconf",
      };
      await compilePlugins(canonical, source, cfg, ["claude"]);

      await writeDownstreamConfig(dir, {
        marketplace: "acme-tools",
        source: { repository: "acme/standards" },
        plugins: ["frontend", "backend"],
      });

      const warnSpy = vi.spyOn(console, "log");
      await enrollCommand({ cwd: dir, local: canonical });

      // Warning surfaced via logger.warn -> console.log; assert the shared skill is flagged.
      const logged = warnSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logged).toMatch(/skill "shared" is in multiple/);
      // Settings still written.
      expect((await readSettings(dir)).enabledPlugins).toEqual([
        "frontend@acme-tools",
        "backend@acme-tools",
      ]);
    } finally {
      await fs.rm(canonical, { recursive: true, force: true });
    }
  });

  it("quiet mode writes settings without stdout", async () => {
    await writeDownstreamConfig(dir, {
      marketplace: "acme-tools",
      source: { repository: "acme/standards" },
      plugins: ["base"],
    });

    await enrollCommand({ cwd: dir, quiet: true });

    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect((await readSettings(dir)).enabledPlugins).toEqual(["base@acme-tools"]);
    expect(mockExit).not.toHaveBeenCalled();
  });
});
