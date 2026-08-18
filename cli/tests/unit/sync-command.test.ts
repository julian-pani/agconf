import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The GitHub-source paths are exercised without any network: the release lookup
 * and the clone are the only two seams that reach out, so both are mocked while
 * the rest of the command (status, version gating, sync, lockfile) runs for real
 * against temp directories.
 */
vi.mock("../../src/core/version.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/core/version.js")>()),
  getLatestRelease: vi.fn(),
}));

vi.mock("../../src/core/source.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/core/source.js")>()),
  resolveGithubSource: vi.fn(),
}));

vi.mock("@clack/prompts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@clack/prompts")>()),
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
}));

import * as prompts from "@clack/prompts";
import { syncCommand } from "../../src/commands/sync.js";
import { resolveGithubSource } from "../../src/core/source.js";
import { getLatestRelease } from "../../src/core/version.js";

/**
 * Command-level tests for `agconf sync`: the mutually-exclusive flag guards, the
 * `cwd`-injected target resolution (no `process.cwd` monkey-patching), and the
 * version-gating branches (up to date / update available / --ref) that the e2e
 * `--local` suite never reaches.
 */
describe("syncCommand", () => {
  let mockExit: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockExit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code ?? 0}) called`);
    }) as () => never);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    mockExit.mockRestore();
    logSpy.mockRestore();
    errSpy.mockRestore();
    vi.mocked(getLatestRelease).mockReset();
    vi.mocked(resolveGithubSource).mockReset();
    vi.mocked(prompts.confirm).mockReset();
    vi.mocked(prompts.isCancel).mockReset().mockReturnValue(false);
  });

  const errorOutput = () => errSpy.mock.calls.map((c) => c.join(" ")).join("\n");
  const logOutput = () => logSpy.mock.calls.map((c) => c.join(" ")).join("\n");

  it("rejects --pinned combined with --ref", async () => {
    await expect(syncCommand({ pinned: true, ref: "v1.2.0" })).rejects.toThrow("process.exit(1)");
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(errorOutput()).toContain("Cannot use --pinned with --ref");
  });

  it("rejects --pinned combined with --local", async () => {
    await expect(syncCommand({ pinned: true, local: true })).rejects.toThrow("process.exit(1)");
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(errorOutput()).toContain("Cannot use --pinned with --local");
  });

  it("rejects an unknown --scope instead of silently repo-syncing", async () => {
    await expect(syncCommand({ scope: "usr" })).rejects.toThrow("process.exit(1)");
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(errorOutput()).toContain('Invalid --scope "usr"');
  });

  it("resolves the target from options.cwd and errors when it is not a git repo", async () => {
    const nonGitDir = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-sync-cmd-"));
    try {
      // If cwd were not threaded through, resolveTargetDirectory would fall back
      // to process.cwd() (this repo, a valid git root) and not exit here.
      await expect(syncCommand({ cwd: nonGitDir })).rejects.toThrow("process.exit(1)");
      expect(mockExit).toHaveBeenCalledWith(1);
      expect(errorOutput()).toContain("Not inside a git repository");
    } finally {
      await fs.rm(nonGitDir, { recursive: true, force: true });
    }
  });

  describe("version gating against a GitHub source", () => {
    let repo: string;
    let canonical: string;

    const release = (version: string) => ({
      tag: `v${version}`,
      version,
      commitSha: "abc1234567890",
      publishedAt: "2026-01-01T00:00:00Z",
      tarballUrl: `https://example.invalid/${version}`,
    });

    /** Write a downstream lockfile recording a GitHub source at `pinnedVersion`. */
    const seedLockfile = async (
      pinnedVersion: string,
      overrides: { schemaVersion?: string; targets?: string[] } = {},
    ) => {
      const lockfile = {
        version: overrides.schemaVersion ?? "1.0.0",
        pinned_version: pinnedVersion,
        synced_at: new Date().toISOString(),
        source: {
          type: "github",
          repository: "acme/standards",
          commit_sha: "abc1234567890",
          ref: `v${pinnedVersion}`,
        },
        content: {
          agents_md: { global_block_hash: "sha256:abc123def456", merged: true },
          skills: [],
          targets: overrides.targets ?? ["claude"],
        },
        cli_version: "0.0.0",
      };
      await fs.mkdir(path.join(repo, ".agconf"), { recursive: true });
      await fs.writeFile(
        path.join(repo, ".agconf", "lockfile.json"),
        JSON.stringify(lockfile, null, 2),
        "utf-8",
      );
    };

    beforeEach(async () => {
      repo = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-sync-repo-"));
      canonical = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-sync-canon-"));
      execFileSync("git", ["init", "-q"], { cwd: repo });

      await fs.mkdir(path.join(canonical, "instructions"), { recursive: true });
      await fs.writeFile(
        path.join(canonical, "instructions", "AGENTS.md"),
        "# Global Standards\n\nBe excellent.",
        "utf-8",
      );
      await fs.mkdir(path.join(canonical, "skills", "code-review"), { recursive: true });
      await fs.writeFile(
        path.join(canonical, "skills", "code-review", "SKILL.md"),
        "---\nname: code-review\ndescription: Review code\n---\n\n# Code Review\n",
        "utf-8",
      );

      // Stand in for the clone: hand back the local canonical fixture.
      vi.mocked(resolveGithubSource).mockImplementation(async ({ repository, ref }) => ({
        source: { type: "github", repository, commit_sha: "abc1234567890", ref },
        basePath: canonical,
        agentsMdPath: path.join(canonical, "instructions", "AGENTS.md"),
        skillsPath: path.join(canonical, "skills"),
        rulesPath: null,
        agentsPath: null,
        mcpsPath: null,
        markerPrefix: "agconf",
      }));
    });

    afterEach(async () => {
      await fs.rm(repo, { recursive: true, force: true });
      await fs.rm(canonical, { recursive: true, force: true });
    });

    const readLockfile = async () =>
      JSON.parse(await fs.readFile(path.join(repo, ".agconf", "lockfile.json"), "utf-8"));

    it("stops early (no clone) when the pinned version is already the latest", async () => {
      await seedLockfile("1.0.0");
      vi.mocked(getLatestRelease).mockResolvedValue(release("1.0.0"));

      await syncCommand({ cwd: repo });

      expect(logOutput()).toContain("Up to date");
      expect(resolveGithubSource).not.toHaveBeenCalled();
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("stops early when the pinned version is NEWER than the latest release", async () => {
      await seedLockfile("2.0.0");
      vi.mocked(getLatestRelease).mockResolvedValue(release("1.0.0"));

      await syncCommand({ cwd: repo });

      expect(logOutput()).toContain("Up to date");
      expect(resolveGithubSource).not.toHaveBeenCalled();
    });

    it("aborts with exit 0 (no clone) when the update prompt is declined", async () => {
      await seedLockfile("1.0.0");
      vi.mocked(getLatestRelease).mockResolvedValue(release("1.1.0"));
      vi.mocked(prompts.confirm).mockResolvedValue(false);

      await expect(syncCommand({ cwd: repo })).rejects.toThrow("process.exit(0)");

      expect(logOutput()).toContain("Update available: 1.0.0 → 1.1.0");
      expect(resolveGithubSource).not.toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it("aborts with exit 0 when the update prompt is cancelled (ctrl-c)", async () => {
      await seedLockfile("1.0.0");
      vi.mocked(getLatestRelease).mockResolvedValue(release("1.1.0"));
      vi.mocked(prompts.confirm).mockResolvedValue(true);
      vi.mocked(prompts.isCancel).mockReturnValue(true);

      await expect(syncCommand({ cwd: repo })).rejects.toThrow("process.exit(0)");

      expect(resolveGithubSource).not.toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it("syncs without prompting under --yes and repins the lockfile", async () => {
      await seedLockfile("1.0.0");
      vi.mocked(getLatestRelease).mockResolvedValue(release("1.1.0"));

      await syncCommand({ cwd: repo, yes: true });

      expect(prompts.confirm).not.toHaveBeenCalled();
      expect(resolveGithubSource).toHaveBeenCalledTimes(1);
      const lockfile = await readLockfile();
      expect(lockfile.pinned_version).toBe("1.1.0");
      expect(lockfile.content.skills).toEqual(["code-review"]);
      await expect(
        fs.access(path.join(repo, ".claude", "skills", "code-review", "SKILL.md")),
      ).resolves.toBeUndefined();
    });

    it("reports the version change and clones that ref when --ref is given", async () => {
      await seedLockfile("1.0.0");

      await syncCommand({ cwd: repo, ref: "v2.0.0", yes: true });

      // --ref bypasses the release lookup entirely.
      expect(getLatestRelease).not.toHaveBeenCalled();
      expect(logOutput()).toContain("Updating version: 1.0.0 → 2.0.0");
      expect(vi.mocked(resolveGithubSource).mock.calls[0]?.[0]).toMatchObject({
        repository: "acme/standards",
        ref: "v2.0.0",
      });
      expect((await readLockfile()).pinned_version).toBe("2.0.0");
    });

    it("stays silent about the version when --ref matches the pinned version", async () => {
      await seedLockfile("1.0.0");

      await syncCommand({ cwd: repo, ref: "v1.0.0", yes: true });

      expect(logOutput()).not.toContain("Updating version");
    });

    it("reuses the lockfile targets when --target is not passed", async () => {
      await seedLockfile("1.0.0", { targets: ["codex"] });
      vi.mocked(getLatestRelease).mockResolvedValue(release("1.1.0"));

      await syncCommand({ cwd: repo, yes: true });

      // Codex skills live under .agents/skills; Claude's dir must not appear.
      await expect(
        fs.access(path.join(repo, ".agents", "skills", "code-review", "SKILL.md")),
      ).resolves.toBeUndefined();
      await expect(fs.access(path.join(repo, ".claude", "skills"))).rejects.toThrow();
      expect((await readLockfile()).content.targets).toEqual(["codex"]);
    });

    it("refuses to sync when the lockfile schema is incompatible", async () => {
      await seedLockfile("1.0.0", { schemaVersion: "2.0.0" });

      await expect(syncCommand({ cwd: repo, yes: true })).rejects.toThrow("process.exit(1)");

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(errorOutput()).toContain("requires a newer CLI");
      expect(resolveGithubSource).not.toHaveBeenCalled();
    });

    it("warns but proceeds when the lockfile schema is a newer minor version", async () => {
      await seedLockfile("1.0.0", { schemaVersion: "1.1.0" });
      vi.mocked(getLatestRelease).mockResolvedValue(release("1.1.0"));

      await syncCommand({ cwd: repo, yes: true });

      expect(logOutput()).toContain("Some features may not work");
      expect(resolveGithubSource).toHaveBeenCalledTimes(1);
    });

    it("warns that the repo was never synced when there is no lockfile", async () => {
      await syncCommand({ cwd: repo, local: canonical, yes: true });

      expect(logOutput()).toContain("has not been synced yet");
      expect(mockExit).not.toHaveBeenCalled();
    });

    // ── Post-sync reporting / guard paths (shared performSync) ──────────────
    // Driven through `sync --local` so no clone is involved.

    it("writes a markdown summary file for CI when --summary-file is given", async () => {
      const summaryFile = path.join(repo, "summary.md");

      await syncCommand({ cwd: repo, local: canonical, yes: true, summaryFile });

      const summary = await fs.readFile(summaryFile, "utf-8");
      expect(summary).toContain("## Changes");
      expect(summary).toContain("`AGENTS.md`");
      expect(summary).toContain("**Source:** local:");
      // No release version for a local source → the ref is reported instead.
      expect(summary).toContain("**Version:** local");
    });

    it("reports skills with invalid frontmatter without failing the sync", async () => {
      await fs.mkdir(path.join(canonical, "skills", "broken"), { recursive: true });
      await fs.writeFile(
        path.join(canonical, "skills", "broken", "SKILL.md"),
        "# No frontmatter here\n",
        "utf-8",
      );

      await syncCommand({ cwd: repo, local: canonical, yes: true });

      const out = logOutput();
      expect(out).toContain("skill(s) have invalid frontmatter");
      expect(out).toContain("broken/SKILL.md");
      expect(mockExit).not.toHaveBeenCalled();
      // The valid skill still synced.
      await expect(
        fs.access(path.join(repo, ".claude", "skills", "code-review", "SKILL.md")),
      ).resolves.toBeUndefined();
    });

    it("adopts a pre-existing unmanaged skill that already matches canonical", async () => {
      const local = path.join(repo, ".claude", "skills", "code-review", "SKILL.md");
      await fs.mkdir(path.dirname(local), { recursive: true });
      await fs.copyFile(path.join(canonical, "skills", "code-review", "SKILL.md"), local);

      await syncCommand({ cwd: repo, local: canonical, yes: true });

      const out = logOutput();
      expect(out).toContain("previously-untracked file(s) as managed");
      expect(out).toContain("code-review");
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("aborts with propose/override guidance on a divergent unmanaged skill", async () => {
      const local = path.join(repo, ".claude", "skills", "code-review", "SKILL.md");
      await fs.mkdir(path.dirname(local), { recursive: true });
      await fs.writeFile(
        local,
        "---\nname: code-review\ndescription: My own local version\n---\n\n# Mine\n",
        "utf-8",
      );

      await expect(syncCommand({ cwd: repo, local: canonical, yes: true })).rejects.toThrow(
        "process.exit(1)",
      );

      const out = logOutput();
      expect(out).toContain("not managed by agconf");
      expect(out).toContain("agconf propose");
      expect(out).toContain("agconf sync --override");
      // The local file is untouched.
      expect(await fs.readFile(local, "utf-8")).toContain("My own local version");
    });

    it("warns (but still completes) when the git hook cannot be installed", async () => {
      // `.git/hooks` as a regular file makes hook installation fail; the content
      // sync already succeeded, so this must not fail the command.
      const hooksDir = path.join(repo, ".git", "hooks");
      await fs.rm(hooksDir, { recursive: true, force: true });
      await fs.writeFile(hooksDir, "not a directory", "utf-8");

      await syncCommand({ cwd: repo, local: canonical, yes: true });

      expect(logOutput()).toContain("Skipped git hook installation");
      expect(mockExit).not.toHaveBeenCalled();
      await expect(
        fs.access(path.join(repo, ".claude", "skills", "code-review", "SKILL.md")),
      ).resolves.toBeUndefined();
    });

    describe("orphaned skills (interactive)", () => {
      /** Sync once, then drop the skill from canonical so it becomes an orphan. */
      const seedOrphan = async () => {
        await syncCommand({ cwd: repo, local: canonical, yes: true });
        await fs.rm(path.join(canonical, "skills", "code-review"), {
          recursive: true,
          force: true,
        });
        logSpy.mockClear();
      };
      const skillPath = () => path.join(repo, ".claude", "skills", "code-review", "SKILL.md");

      it("deletes them when the prompt is confirmed", async () => {
        await seedOrphan();
        vi.mocked(prompts.confirm).mockResolvedValue(true);

        await syncCommand({ cwd: repo, local: canonical });

        expect(logOutput()).toContain("no longer in the source");
        await expect(fs.access(skillPath())).rejects.toThrow();
      });

      it("keeps them when the prompt is declined", async () => {
        await seedOrphan();
        vi.mocked(prompts.confirm).mockResolvedValue(false);

        await syncCommand({ cwd: repo, local: canonical });

        await expect(fs.access(skillPath())).resolves.toBeUndefined();
      });

      it("keeps them when the prompt is cancelled", async () => {
        await seedOrphan();
        vi.mocked(prompts.confirm).mockResolvedValue(true);
        vi.mocked(prompts.isCancel).mockReturnValue(true);

        await syncCommand({ cwd: repo, local: canonical });

        expect(logOutput()).toContain("Skipping orphan deletion");
        await expect(fs.access(skillPath())).resolves.toBeUndefined();
      });
    });

    it("errors when --pinned is used with no pinned version in the lockfile", async () => {
      // A lockfile with a source but no pinned_version (e.g. synced from a branch).
      await fs.mkdir(path.join(repo, ".agconf"), { recursive: true });
      await fs.writeFile(
        path.join(repo, ".agconf", "lockfile.json"),
        JSON.stringify({
          version: "1.0.0",
          synced_at: new Date().toISOString(),
          source: {
            type: "github",
            repository: "acme/standards",
            commit_sha: "abc1234567890",
            ref: "master",
          },
          content: {
            agents_md: { global_block_hash: "sha256:abc123def456", merged: true },
            skills: [],
          },
        }),
        "utf-8",
      );

      await expect(syncCommand({ cwd: repo, pinned: true })).rejects.toThrow("process.exit(1)");
      expect(errorOutput()).toContain("no version pinned in lockfile");
    });
  });
});
