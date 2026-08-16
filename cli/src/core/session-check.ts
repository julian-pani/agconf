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
 * The `install*SessionStartHook` installers register `agconf session-check` as a
 * SessionStart hook — Claude Code in `~/.claude/settings.json`, Codex in
 * `~/.codex/hooks.json` — idempotently and preserving any existing config/hooks.
 * `installSessionStartHooks` fans that out to the targets the user store was
 * synced to (`resolveHookTargets`). All paths derive from an injectable
 * `homeDir`. See cli/docs/DISTRIBUTION_SCOPES.md (F5).
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import { readLockfileSafe } from "./lockfile.js";
import { isValidTarget, type Target } from "./targets.js";

const execFileAsync = promisify(execFile);

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
  // Safe reads: a corrupt lockfile in either scope must degrade to "not synced"
  // for that scope, not throw — a thrown error here is swallowed by the session
  // hook's blanket catch and would silently kill the dedup warning, the
  // background auto-sync spawn, and the freshness nudge (leaving the store with
  // no way to self-heal, since auto-sync is the only refresh path).
  const repoLock = options.repoDir
    ? (await readLockfileSafe(options.repoDir))?.lockfile
    : undefined;
  const userLock = (await readLockfileSafe(options.homeDir))?.lockfile;

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
  /** Which target's hook file this result is for. */
  target: Target;
  installed: boolean;
  alreadyPresent: boolean;
  /**
   * Absolute path of the file written: Claude's `settings.json` or Codex's
   * `hooks.json`.
   */
  filePath: string;
}

interface SessionStartEntry {
  matcher?: string;
  hooks?: Array<{ type?: string; command?: string; timeout?: number }>;
}

/** Hard cap (seconds) on the hook so a slow probe/network can't stall session start. */
const HOOK_TIMEOUT_SECONDS = 10;

/**
 * Read a JSON hook-config file, or refuse. Returns `{}` ONLY when the file is
 * genuinely absent (safe to create). If it exists but is unreadable or not a
 * JSON object, throw rather than overwrite the user's real config — a malformed
 * file is theirs to fix, not ours to wipe.
 */
async function readHookConfigOrRefuse(filePath: string): Promise<Record<string, unknown>> {
  let raw: string | null = null;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return {}; // ENOENT: no file yet — safe to create one.
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `Refusing to modify ${filePath}: it exists but is not valid JSON. Fix or remove it, then re-run.`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Refusing to modify ${filePath}: expected a JSON object at the top level.`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * Add the `agconf session-check` SessionStart entry to a parsed hook-config
 * object. Claude's `settings.json` and Codex's `hooks.json` share the exact same
 * shape here — both key SessionStart under a top-level `hooks` object — so one
 * helper serves both. Mutates `root` in place; idempotent by the command string.
 * `matcher` is passed only for Codex ("*", the form verified against a real
 * install); Claude gets a matcher-less entry.
 *
 * Guards the same "never wipe the user's config" contract as the reader: if
 * `hooks` or `hooks.SessionStart` exists with an unexpected shape (e.g. an array,
 * or a non-array SessionStart), refuse rather than silently replace it. `filePath`
 * is only used to make that error actionable.
 */
function upsertSessionStartHook(
  root: Record<string, unknown>,
  filePath: string,
  matcher?: string,
): { alreadyPresent: boolean } {
  if (
    "hooks" in root &&
    (typeof root.hooks !== "object" || root.hooks === null || Array.isArray(root.hooks))
  ) {
    throw new Error(`Refusing to modify ${filePath}: "hooks" is not a JSON object.`);
  }
  const hooks = (root.hooks ?? {}) as Record<string, unknown>;
  if ("SessionStart" in hooks && !Array.isArray(hooks.SessionStart)) {
    throw new Error(`Refusing to modify ${filePath}: "hooks.SessionStart" is not an array.`);
  }
  const sessionStart: SessionStartEntry[] = Array.isArray(hooks.SessionStart)
    ? (hooks.SessionStart as SessionStartEntry[])
    : [];

  const alreadyPresent = sessionStart.some((entry) =>
    entry?.hooks?.some((h) => typeof h?.command === "string" && h.command.includes(HOOK_COMMAND)),
  );
  if (!alreadyPresent) {
    const entry: SessionStartEntry = {
      hooks: [{ type: "command", command: HOOK_COMMAND, timeout: HOOK_TIMEOUT_SECONDS }],
    };
    if (matcher) entry.matcher = matcher;
    sessionStart.push(entry);
  }
  hooks.SessionStart = sessionStart;
  root.hooks = hooks;
  return { alreadyPresent };
}

/**
 * Where each target's SessionStart hook lives, and the matcher to write there.
 * The exhaustive `switch` makes adding a value to `SUPPORTED_TARGETS` a
 * compile error here until its hook file is defined.
 */
function hookFileSpec(homeDir: string, target: Target): { filePath: string; matcher?: string } {
  switch (target) {
    case "claude":
      return { filePath: path.join(homeDir, ".claude", "settings.json") };
    case "codex":
      return { filePath: path.join(homeDir, ".codex", "hooks.json"), matcher: "*" };
    default: {
      const exhaustive: never = target;
      throw new Error(`Unsupported hook target: ${String(exhaustive)}`);
    }
  }
}

async function installHookForTarget(homeDir: string, target: Target): Promise<HookInstallResult> {
  const { filePath, matcher } = hookFileSpec(homeDir, target);
  const config = await readHookConfigOrRefuse(filePath);
  const { alreadyPresent } = upsertSessionStartHook(config, filePath, matcher);
  if (!alreadyPresent) await writeHookConfig(filePath, config);
  return { target, installed: !alreadyPresent, alreadyPresent, filePath };
}

async function writeHookConfig(filePath: string, config: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

/**
 * Register `agconf session-check` as a Claude Code SessionStart hook in
 * `~/.claude/settings.json`. Idempotent (keyed by the command string) and
 * non-destructive: existing settings and other hooks are preserved.
 */
export async function installClaudeSessionStartHook(homeDir: string): Promise<HookInstallResult> {
  return installHookForTarget(homeDir, "claude");
}

/**
 * Register `agconf session-check` as a Codex SessionStart hook in
 * `~/.codex/hooks.json`. Same idempotent, non-destructive contract as the Claude
 * installer. Codex's `hooks` feature is stable and enabled by default, so no
 * config-flag write is needed here; `getCodexHooksState` lets callers warn if a
 * user has explicitly turned it off.
 */
export async function installCodexSessionStartHook(homeDir: string): Promise<HookInstallResult> {
  return installHookForTarget(homeDir, "codex");
}

/**
 * Install the SessionStart hook for each requested target (Claude →
 * `settings.json`, Codex → `hooks.json`), atomically: every target's config is
 * read and validated FIRST, so a malformed config for one target throws before
 * any file is written and can't leave another target half-installed. Nothing is
 * ever clobbered — each config is refuse-to-modify on a bad shape.
 */
export async function installSessionStartHooks(
  homeDir: string,
  targets: Target[],
): Promise<HookInstallResult[]> {
  // Phase 1: read + validate + stage every target (may throw — before any write).
  const staged = targets.map((target) => ({ target, ...hookFileSpec(homeDir, target) }));
  const prepared = [];
  for (const { target, filePath, matcher } of staged) {
    const config = await readHookConfigOrRefuse(filePath);
    const { alreadyPresent } = upsertSessionStartHook(config, filePath, matcher);
    prepared.push({ target, filePath, config, alreadyPresent });
  }

  // Phase 2: persist the ones that changed.
  const results: HookInstallResult[] = [];
  for (const { target, filePath, config, alreadyPresent } of prepared) {
    if (!alreadyPresent) await writeHookConfig(filePath, config);
    results.push({ target, installed: !alreadyPresent, alreadyPresent, filePath });
  }
  return results;
}

/**
 * The targets whose SessionStart hook agconf should install: exactly the ones the
 * user store was synced to (its lockfile's `content.targets`). Falls back to
 * Claude when no user store exists yet, matching the sync default.
 */
export async function resolveHookTargets(homeDir: string): Promise<Target[]> {
  const lock = (await readLockfileSafe(homeDir))?.lockfile;
  const targets = (lock?.content.targets ?? []).filter(isValidTarget);
  return targets.length > 0 ? targets : ["claude"];
}

export type CodexHooksState = "enabled" | "disabled" | "unknown";

/**
 * Parse `codex features list` output for the effective state of the `hooks`
 * feature. Each line is `<name> <stage> <effective-bool>`, so the last column of
 * the `hooks` row is what matters. Returns "unknown" when the feature isn't
 * listed (older Codex) or the row isn't shaped as expected.
 */
export function parseCodexHooksState(featuresListOutput: string): CodexHooksState {
  for (const line of featuresListOutput.split("\n")) {
    const cols = line.trim().split(/\s+/);
    if (cols[0] !== "hooks" || cols.length < 2) continue;
    const effective = cols[cols.length - 1];
    if (effective === "true") return "enabled";
    if (effective === "false") return "disabled";
    return "unknown";
  }
  return "unknown";
}

/** Runner seam so tests don't shell out. Returns `codex features list` stdout. */
export type CodexFeaturesRunner = () => Promise<string>;

const defaultCodexFeaturesRunner: CodexFeaturesRunner = async () => {
  const { stdout } = await execFileAsync("codex", ["features", "list"], { timeout: 3000 });
  return stdout;
};

/**
 * Best-effort: is Codex's `hooks` feature enabled? Returns "unknown" when Codex
 * isn't installed or the probe fails. Callers MUST NOT warn on "unknown" — a
 * missing Codex is not the same as Codex-with-hooks-disabled.
 */
export async function getCodexHooksState(
  run: CodexFeaturesRunner = defaultCodexFeaturesRunner,
): Promise<CodexHooksState> {
  try {
    return parseCodexHooksState(await run());
  } catch {
    return "unknown";
  }
}

/**
 * If Codex is among the just-installed targets AND its `hooks` feature is
 * explicitly disabled, return a one-line warning (with the exact re-enable
 * command) that the installed hook won't fire; otherwise null. Returns a string
 * for the caller to print, keeping this module free of console output. Never
 * warns when Codex isn't a target or its state can't be determined ("unknown").
 */
export async function codexHooksDisabledWarning(
  results: HookInstallResult[],
  run?: CodexFeaturesRunner,
): Promise<string | null> {
  if (!results.some((r) => r.target === "codex")) return null;
  const state = await getCodexHooksState(run);
  if (state !== "disabled") return null;
  return "Codex hooks are disabled, so the agconf session-check hook won't run. Enable it with: codex features enable hooks";
}
