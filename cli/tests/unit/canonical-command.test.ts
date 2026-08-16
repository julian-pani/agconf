import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";

// The interactive scaffolding flow is prompt-driven; stub the prompts so the
// answers (and cancellations) can be scripted.
vi.mock("@clack/prompts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@clack/prompts")>()),
  text: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
}));

import * as prompts from "@clack/prompts";
import { canonicalInitCommand } from "../../src/commands/canonical.js";

/**
 * Unit tests for `agconf canonical init` covering the paths the (mock-free)
 * integration suite cannot reach: the interactive prompt flow, cancellation at
 * each step, and the guards that protect existing files.
 */
describe("canonicalInitCommand", () => {
  let dir: string;
  let mockExit: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-canon-cmd-"));
    mockExit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code ?? 0}) called`);
    }) as () => never);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    mockExit.mockRestore();
    logSpy.mockRestore();
    vi.mocked(prompts.text).mockReset();
    vi.mocked(prompts.confirm).mockReset();
    vi.mocked(prompts.isCancel).mockReset().mockReturnValue(false);
    await fs.rm(dir, { recursive: true, force: true });
  });

  const logOutput = () => logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
  const exists = (p: string) =>
    fs
      .access(p)
      .then(() => true)
      .catch(() => false);
  const readConfig = async () =>
    parseYaml(await fs.readFile(path.join(dir, "agconf.yaml"), "utf-8"));

  /** Script the full interactive questionnaire. */
  const answer = (opts: {
    name: string;
    org: string;
    prefix: string;
    examples: boolean;
    rules: boolean | string;
    plugins: boolean;
  }) => {
    const text = vi.mocked(prompts.text);
    text.mockResolvedValueOnce(opts.name as never);
    text.mockResolvedValueOnce(opts.org as never);
    text.mockResolvedValueOnce(opts.prefix as never);
    if (typeof opts.rules === "string") text.mockResolvedValueOnce(opts.rules as never);

    const confirm = vi.mocked(prompts.confirm);
    confirm.mockResolvedValueOnce(opts.examples as never);
    confirm.mockResolvedValueOnce((opts.rules !== false) as never);
    confirm.mockResolvedValueOnce(opts.plugins as never);
  };

  it("scaffolds from the interactive answers, including a custom rules directory", async () => {
    answer({
      name: "acme-standards",
      org: "ACME Corp",
      prefix: "acme",
      examples: true,
      rules: "guidelines",
      plugins: false,
    });

    await canonicalInitCommand({ dir });

    const config = await readConfig();
    expect(config.meta.name).toBe("acme-standards");
    expect(config.meta.organization).toBe("ACME Corp");
    expect(config.markers.prefix).toBe("acme");
    expect(config.content.rules_dir).toBe("guidelines");
    // `--no-plugins` equivalent: no plugins block was scaffolded.
    expect(config.plugins).toBeUndefined();

    expect(await exists(path.join(dir, "guidelines", ".gitkeep"))).toBe(true);
    expect(await exists(path.join(dir, "skills", "example-skill", "SKILL.md"))).toBe(true);
    expect(await exists(path.join(dir, "instructions", "AGENTS.md"))).toBe(true);
    expect(logOutput()).toContain("guidelines");
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("omits rules_dir when the rules prompt is declined", async () => {
    answer({
      name: "acme-standards",
      org: "",
      prefix: "acme",
      examples: false,
      rules: false,
      plugins: false,
    });

    await canonicalInitCommand({ dir });

    const config = await readConfig();
    expect(config.content.rules_dir).toBeUndefined();
    expect(config.meta.organization).toBeUndefined();
    expect(await exists(path.join(dir, "skills", "example-skill"))).toBe(false);
  });

  it.each([
    ["the name prompt", 0],
    ["the organization prompt", 1],
    ["the marker-prefix prompt", 2],
  ])("aborts with exit 0 when %s is cancelled", async (_label, cancelAt) => {
    const text = vi.mocked(prompts.text);
    text.mockResolvedValue("acme" as never);
    vi.mocked(prompts.confirm).mockResolvedValue(false as never);
    let calls = 0;
    vi.mocked(prompts.isCancel).mockImplementation(() => calls++ === cancelAt);

    await expect(canonicalInitCommand({ dir })).rejects.toThrow("process.exit(0) called");

    expect(mockExit).toHaveBeenCalledWith(0);
    // Nothing was scaffolded.
    expect(await exists(path.join(dir, "agconf.yaml"))).toBe(false);
  });

  it("aborts with exit 0 when a confirm prompt is cancelled", async () => {
    const text = vi.mocked(prompts.text);
    text.mockResolvedValue("acme" as never);
    vi.mocked(prompts.confirm).mockResolvedValue(true as never);
    // First three isCancel calls are the text prompts; the 4th is includeExamples.
    let calls = 0;
    vi.mocked(prompts.isCancel).mockImplementation(() => calls++ === 3);

    await expect(canonicalInitCommand({ dir })).rejects.toThrow("process.exit(0) called");

    expect(mockExit).toHaveBeenCalledWith(0);
    expect(await exists(path.join(dir, "agconf.yaml"))).toBe(false);
  });

  it("refuses to overwrite an existing agconf.yaml when the prompt is declined", async () => {
    const existing = "version: 1.0.0\nmeta:\n  name: mine\n";
    await fs.writeFile(path.join(dir, "agconf.yaml"), existing, "utf-8");
    vi.mocked(prompts.confirm).mockResolvedValue(false as never);

    await expect(canonicalInitCommand({ dir })).rejects.toThrow("process.exit(0) called");

    expect(mockExit).toHaveBeenCalledWith(0);
    expect(await fs.readFile(path.join(dir, "agconf.yaml"), "utf-8")).toBe(existing);
  });

  it("skips --yes past the overwrite prompt", async () => {
    await fs.writeFile(path.join(dir, "agconf.yaml"), "version: 1.0.0\n", "utf-8");

    await canonicalInitCommand({ dir, name: "acme", markerPrefix: "acme", yes: true });

    expect(prompts.confirm).not.toHaveBeenCalled();
    expect((await readConfig()).meta.name).toBe("acme");
  });

  it("keeps an existing instructions/AGENTS.md instead of overwriting it", async () => {
    await fs.mkdir(path.join(dir, "instructions"), { recursive: true });
    const mine = "# My hand-written standards\n";
    await fs.writeFile(path.join(dir, "instructions", "AGENTS.md"), mine, "utf-8");

    await canonicalInitCommand({
      dir,
      name: "acme",
      markerPrefix: "acme",
      yes: true,
      includePlugins: false,
    });

    expect(await fs.readFile(path.join(dir, "instructions", "AGENTS.md"), "utf-8")).toBe(mine);
    expect(logOutput()).toContain("already exists");
  });

  it("records rules_dir passed non-interactively", async () => {
    await canonicalInitCommand({
      dir,
      name: "acme",
      markerPrefix: "acme",
      rulesDir: "rules",
      yes: true,
      includePlugins: false,
    });

    expect((await readConfig()).content.rules_dir).toBe("rules");
    expect(await exists(path.join(dir, "rules", ".gitkeep"))).toBe(true);
  });
});
