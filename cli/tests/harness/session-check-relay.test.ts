/**
 * Harness tests: do the real coding agents actually surface `session-check`'s
 * notes to the developer?
 *
 * Everything else about session-check is unit-tested. What those tests cannot
 * cover is the part that has broken twice in practice, because it lives in
 * another program:
 *   1. whether the harness ACCEPTS the hook's output (Codex validates SessionStart
 *      stdout against its `session-start.command.output` schema and silently
 *      discards anything else), and
 *   2. whether the agent then RELAYS the note to the human instead of reading it
 *      as background context and staying silent.
 *
 * So these drive the installed `claude` / `codex` CLIs against a throwaway HOME.
 * They are opt-in (`pnpm test:harness`) because they cost real model calls, and
 * they SKIP rather than fail when the harness isn't usable here — a missing CLI,
 * missing credentials, or a CLI that won't run — so CI without harnesses stays
 * green while a developer's machine (or a CI image with the CLIs installed and
 * authenticated) gets the coverage.
 *
 * Model output is not deterministic, so the relay assertions retry.
 */
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { syncUserScopeCommand } from "../../src/commands/user-scope.js";
import { writeLockfile } from "../../src/core/lockfile.js";
import { installSessionStartHooks } from "../../src/core/session-check.js";
import type { Target } from "../../src/core/targets.js";

const CLI_ENTRY = path.resolve(__dirname, "../../dist/index.js");
/** Codex reads credentials from HOME, and these tests replace HOME. */
const codexAuth = path.join(os.homedir(), ".codex", "auth.json");
const HARNESS_TIMEOUT = 240_000;
/** Retries per relay assertion: the agent's phrasing (and compliance) varies. */
const RELAY_RETRIES = 3;

/** Is this executable on PATH? */
function onPath(binary: string): boolean {
  try {
    execFileSync("which", [binary], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

interface Fixture {
  home: string;
  repo: string;
  dirs: string[];
}

/**
 * A throwaway HOME with the user store synced, plus a git repo to run the agent
 * in. `duplicated` also writes a repo lockfile carrying a DIFFERENT instructions
 * block, which is what session-check reports as a divergent cross-scope
 * duplication; `clean` leaves the repo unmanaged so there is nothing to report.
 *
 * The installed hook command is rewritten to run this working copy: a shim named
 * `agconf` on a prepended PATH, so the command string still reads
 * `agconf session-check --hook` and session-check's own hook-state detection sees
 * a current install (an absolute `node …` path would read as missing and add a
 * note of its own).
 */
async function makeFixture(kind: "duplicated" | "clean", targets: Target[]): Promise<Fixture> {
  const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "agconf-harness-"));
  const [home, repo, canonical, bin] = await Promise.all([tmp(), tmp(), tmp(), tmp()]);

  await fs.mkdir(path.join(canonical, "instructions"), { recursive: true });
  await fs.mkdir(path.join(canonical, "skills", "shared-skill"), { recursive: true });
  await fs.writeFile(
    path.join(canonical, "instructions", "AGENTS.md"),
    "# Company Standards\n\nBe excellent.\n",
    "utf-8",
  );
  await fs.writeFile(
    path.join(canonical, "skills", "shared-skill", "SKILL.md"),
    "---\nname: shared-skill\ndescription: A skill present in both scopes.\n---\n\nDo the thing.\n",
    "utf-8",
  );

  execFileSync("git", ["init", "-q"], { cwd: repo });
  await syncUserScopeCommand({ scope: "user", local: canonical, home, target: targets });

  if (targets.includes("codex")) {
    // Codex is run with HOME=fixture, so it needs credentials there. Borrow the
    // real install's — the availability gate above already required them.
    await fs.mkdir(path.join(home, ".codex"), { recursive: true });
    await fs.copyFile(codexAuth, path.join(home, ".codex", "auth.json"));
  }

  if (kind === "duplicated") {
    await writeLockfile(repo, {
      source: { type: "local", path: canonical },
      globalBlockContent: "A DIFFERENT COMPANY BLOCK",
      skills: ["shared-skill"],
      targets,
      markerPrefix: "agconf",
    });
  }

  const shim = path.join(bin, "agconf");
  await fs.writeFile(shim, `#!/bin/sh\nexec node ${CLI_ENTRY} "$@"\n`, "utf-8");
  await fs.chmod(shim, 0o755);

  const results = await installSessionStartHooks(home, targets);
  for (const result of results) {
    const config = JSON.parse(await fs.readFile(result.filePath, "utf-8"));
    for (const entry of config.hooks.SessionStart) {
      for (const hook of entry.hooks) {
        // Codex runs with HOME=fixture, so its hook needs no HOME override;
        // Claude keeps the developer's real HOME (credentials) and gets the hook
        // through the fixture repo's project settings instead — see below.
        hook.command = `PATH="${bin}:$PATH" ${hook.command}`;
      }
    }
    await fs.writeFile(result.filePath, JSON.stringify(config, null, 2), "utf-8");
  }

  // Claude Code must run against the developer's real HOME to stay logged in, so
  // point it at the fixture store through a project-level SessionStart hook.
  await fs.mkdir(path.join(repo, ".claude"), { recursive: true });
  await fs.writeFile(
    path.join(repo, ".claude", "settings.json"),
    JSON.stringify(
      {
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: "command",
                  command: `HOME="${home}" PATH="${bin}:$PATH" agconf session-check --hook`,
                  timeout: 10,
                },
              ],
            },
          ],
        },
      },
      null,
      2,
    ),
    "utf-8",
  );

  return { home, repo, dirs: [home, repo, canonical, bin] };
}

interface HarnessRun {
  /** stdout: the agent's reply, and nothing else. */
  reply: string;
  /** stdout + stderr: harness diagnostics live here (Codex's `hook:` lines). */
  all: string;
}

/**
 * Run a harness CLI in the fixture repo. Returns `null` when the harness itself
 * could not run — spawn failure, timeout, or an exit that looks like a login
 * problem — so the caller skips instead of reporting our code broken. A CLI that
 * runs and answers is always asserted against, whatever its exit code (Codex can
 * exit non-zero on an otherwise fine turn).
 */
function runHarness(
  command: string,
  args: string[],
  options: { cwd: string; home?: string },
): HarnessRun | null {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: HARNESS_TIMEOUT - 30_000,
    ...(options.home ? { env: { ...process.env, HOME: options.home } } : {}),
  });
  if (result.error) return null;
  const reply = result.stdout ?? "";
  const all = `${reply}\n${result.stderr ?? ""}`;
  if (reply.trim() === "" && /log ?in|auth|credential|unauthorized|api key/i.test(all)) {
    return null; // not signed in here
  }
  return { reply, all };
}

const fixtures: Fixture[] = [];

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await Promise.all(fixture.dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  }
});

async function fixture(kind: "duplicated" | "clean", targets: Target[]): Promise<Fixture> {
  const created = await makeFixture(kind, targets);
  fixtures.push(created);
  return created;
}

const built = await exists(CLI_ENTRY);
const claudeAvailable = built && onPath("claude");
const codexAvailable = built && onPath("codex") && (await exists(codexAuth));

describe.skipIf(!claudeAvailable)("Claude Code relays session-check notes", () => {
  it(
    "surfaces a cross-scope duplication note in its reply",
    { timeout: HARNESS_TIMEOUT, retry: RELAY_RETRIES },
    async (ctx) => {
      const { repo } = await fixture("duplicated", ["claude"]);

      const run = runHarness("claude", ["-p", "What is 2+2?", "--model", "sonnet"], { cwd: repo });
      if (run === null) ctx.skip();

      expect(run?.reply).toMatch(/scope|agconf/i);
    },
  );

  it("says nothing when there is nothing to report", { timeout: HARNESS_TIMEOUT }, async (ctx) => {
    const { repo } = await fixture("clean", ["claude"]);

    const run = runHarness("claude", ["-p", "What is 2+2?", "--model", "sonnet"], { cwd: repo });
    if (run === null) ctx.skip();

    expect(run?.reply).not.toMatch(/agconf|more than one scope/i);
  });
});

describe.skipIf(!codexAvailable)("Codex relays session-check notes", () => {
  // A hook that was never trusted interactively does not run under `codex exec`,
  // and these fixtures build a fresh hooks.json every time. The bypass is scoped
  // to this invocation and to a throwaway HOME whose only hook is the one written
  // three lines up.
  const codexArgs = (prompt: string) => [
    "exec",
    "--skip-git-repo-check",
    "--dangerously-bypass-hook-trust",
    prompt,
  ];

  it(
    "accepts the hook envelope and surfaces the note in its reply",
    { timeout: HARNESS_TIMEOUT, retry: RELAY_RETRIES },
    async (ctx) => {
      const { repo, home } = await fixture("duplicated", ["codex"]);

      const run = runHarness("codex", codexArgs("What is 2+2?"), { cwd: repo, home });
      if (run === null) ctx.skip();

      expect(run?.all).toContain("hook: SessionStart Completed");
      expect(run?.reply).toMatch(/scope|agconf/i);
    },
  );

  it(
    "accepts the envelope and stays quiet when there is nothing to report",
    { timeout: HARNESS_TIMEOUT },
    async (ctx) => {
      const { repo, home } = await fixture("clean", ["codex"]);

      const run = runHarness("codex", codexArgs("What is 2+2?"), { cwd: repo, home });
      if (run === null) ctx.skip();

      // The clean path emits an envelope with an empty `additionalContext`:
      // bare-empty stdout is not valid hook output either.
      expect(run?.all).toContain("hook: SessionStart Completed");
      expect(run?.reply).not.toMatch(/agconf|more than one scope/i);
    },
  );

  it(
    "rejects a hook that prints plain text — why --hook exists",
    { timeout: HARNESS_TIMEOUT },
    async (ctx) => {
      const { repo, home } = await fixture("duplicated", ["codex"]);
      const hooksPath = path.join(home, ".codex", "hooks.json");
      const config = JSON.parse(await fs.readFile(hooksPath, "utf-8"));
      for (const entry of config.hooks.SessionStart) {
        for (const hook of entry.hooks) {
          hook.command = hook.command.replace(" --hook", "");
        }
      }
      await fs.writeFile(hooksPath, JSON.stringify(config, null, 2), "utf-8");

      const run = runHarness("codex", codexArgs("What is 2+2?"), { cwd: repo, home });
      if (run === null) ctx.skip();

      // If this ever starts passing plain text through, `--hook` could become
      // optional for Codex — worth knowing, hence the assertion.
      expect(run?.all).toContain("hook: SessionStart Failed");
      expect(run?.reply).not.toMatch(/more than one scope/i);
    },
  );
});
