/**
 * Cross-scope duplication detection + SessionStart hook (F5).
 *
 * When a developer manages agconf content at BOTH the user scope (`~/.agconf`)
 * and a repo they're working in (the repo's `.agconf/lockfile.json`), the same
 * canonical content can load twice — instructions concatenate with no dedup;
 * plugin skills coexist with synced skills. `detectCrossScopeDuplication`
 * surfaces this.
 *
 * Detection is **identity based, never content-equality based**. Instructions
 * are a single block, so presence in both scopes = duplication (the hash only
 * annotates identical vs divergent, never gates the finding). Skills/rules/
 * agents are flagged per-object: only the specific objects present in BOTH
 * scopes are a real double-load — repo skill X alongside user skill Y is not a
 * collision and is not flagged.
 *
 * `installSessionStartHook` registers `agconf session-check` as a Claude Code
 * SessionStart hook in `~/.claude/settings.json`, idempotently and preserving
 * any existing settings/hooks. All paths derive from an injectable `homeDir`.
 * See cli/docs/DISTRIBUTION_SCOPES.md (F5).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { readLockfile } from "./lockfile.js";

export type DuplicatedType = "instructions" | "skills" | "rules" | "agents";

export interface DuplicationFinding {
  type: DuplicatedType;
  /** Scopes in which agconf manages this type (currently "repo" and "user"). */
  scopes: string[];
  /** Instructions only: the two copies differ (worse — conflicting guidance). */
  divergent?: boolean;
  /**
   * skills/rules/agents only: the specific objects present in BOTH scopes (the
   * real overlap). Instructions are a single block, so this is unset for them.
   */
  objects?: string[];
}

export interface CrossScopeResult {
  repoSynced: boolean;
  userSynced: boolean;
  findings: DuplicationFinding[];
}

/**
 * Detect agconf-managed content present in BOTH the current repo and the user
 * store, by reading each scope's lockfile. Requires both scopes to be synced —
 * a single scope cannot duplicate.
 */
export async function detectCrossScopeDuplication(options: {
  /** Repo git root (null if not in an agconf repo). */
  repoDir: string | null;
  /** User home dir (the `~/.agconf` store lives under it). */
  homeDir: string;
}): Promise<CrossScopeResult> {
  const repoLock = options.repoDir ? (await readLockfile(options.repoDir))?.lockfile : undefined;
  const userLock = (await readLockfile(options.homeDir))?.lockfile;

  const repoSynced = Boolean(repoLock);
  const userSynced = Boolean(userLock);
  const findings: DuplicationFinding[] = [];

  if (!repoLock || !userLock) {
    return { repoSynced, userSynced, findings };
  }

  // Instructions: every synced scope carries the global block, so presence in
  // both = duplication. Hash only annotates identical vs divergent.
  const repoHash = repoLock.content.agents_md?.global_block_hash;
  const userHash = userLock.content.agents_md?.global_block_hash;
  if (repoHash && userHash) {
    findings.push({
      type: "instructions",
      scopes: ["repo", "user"],
      divergent: repoHash !== userHash,
    });
  }

  // skills/rules/agents: flag only the objects that actually exist in BOTH
  // scopes (a real double-load), not merely "each scope has some". Repo skill X +
  // user skill Y is not a collision and must not warn.
  const overlap = (a: string[] = [], b: string[] = []): string[] => {
    const other = new Set(b);
    return a.filter((x) => other.has(x));
  };
  const skillOverlap = overlap(repoLock.content.skills, userLock.content.skills);
  if (skillOverlap.length > 0) {
    findings.push({ type: "skills", scopes: ["repo", "user"], objects: skillOverlap });
  }
  const ruleOverlap = overlap(repoLock.content.rules?.files, userLock.content.rules?.files);
  if (ruleOverlap.length > 0) {
    findings.push({ type: "rules", scopes: ["repo", "user"], objects: ruleOverlap });
  }
  const agentOverlap = overlap(repoLock.content.agents?.files, userLock.content.agents?.files);
  if (agentOverlap.length > 0) {
    findings.push({ type: "agents", scopes: ["repo", "user"], objects: agentOverlap });
  }

  return { repoSynced, userSynced, findings };
}

/** Marker in the hook command so re-installs are idempotent by identity. */
const HOOK_COMMAND = "agconf session-check";

export interface HookInstallResult {
  installed: boolean;
  alreadyPresent: boolean;
  settingsPath: string;
}

interface SessionStartEntry {
  matcher?: string;
  hooks?: Array<{ type?: string; command?: string }>;
}

/**
 * Register `agconf session-check` as a Claude Code SessionStart hook in
 * `~/.claude/settings.json`. Idempotent (keyed by the command string) and
 * non-destructive: existing settings and other hooks are preserved.
 */
export async function installSessionStartHook(homeDir: string): Promise<HookInstallResult> {
  const settingsPath = path.join(homeDir, ".claude", "settings.json");

  // Start fresh ONLY when the file is genuinely absent. If it exists but is
  // unreadable or not a JSON object, refuse rather than overwrite the user's
  // real settings — a malformed settings.json is theirs to fix, not ours to wipe.
  let settings: Record<string, unknown> = {};
  let raw: string | null = null;
  try {
    raw = await fs.readFile(settingsPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    // ENOENT: no settings file yet — safe to create one.
  }
  if (raw !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        `Refusing to modify ${settingsPath}: it exists but is not valid JSON. Fix or remove it, then re-run.`,
      );
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(
        `Refusing to modify ${settingsPath}: expected a JSON object at the top level.`,
      );
    }
    settings = parsed as Record<string, unknown>;
  }

  const hooks = (
    settings.hooks && typeof settings.hooks === "object" ? settings.hooks : {}
  ) as Record<string, unknown>;
  const sessionStart: SessionStartEntry[] = Array.isArray(hooks.SessionStart)
    ? (hooks.SessionStart as SessionStartEntry[])
    : [];

  const already = sessionStart.some((entry) =>
    entry.hooks?.some((h) => typeof h.command === "string" && h.command.includes(HOOK_COMMAND)),
  );
  if (already) {
    return { installed: false, alreadyPresent: true, settingsPath };
  }

  sessionStart.push({ hooks: [{ type: "command", command: HOOK_COMMAND }] });
  hooks.SessionStart = sessionStart;
  settings.hooks = hooks;

  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
  return { installed: true, alreadyPresent: false, settingsPath };
}
