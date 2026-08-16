# Reference: the "parent launch directory" idea (and why we don't use it)

> **Status: rejected.** This is a durable record of the analysis so we don't
> re-litigate it. Short version: aggregating multiple **separate git repos** under
> one "launcher" parent directory and starting agent sessions from the parent does
> **not** deliver canonical config into the child repos on either Claude Code or
> Codex, because both harnesses treat a git repository as a hard config boundary.
> Use **user scope** (`sync --scope user`) instead. This nesting *does* work inside
> a single **monorepo**, which is a different thing.

## The idea

Put the canonical config once in a parent folder and start every session from
there, with the real work repos as children:

```
~/code/launcher/            # canonical: CLAUDE.md / AGENTS.md, .claude/skills, hooks, .mcp.json, ...
  repo1/                    # a SEPARATE git repo (own .git), own CLAUDE.md / skills / hooks / mcp
  repo2/                    # another separate git repo
```

The hope: the parent provides company standards to everything under it, while
each child repo keeps its own project-specific config. It doesn't work for
separate repos.

## The one rule that governs everything

**Both harnesses anchor config discovery to a git repository and won't cross the
`.git` boundary.**

- **Claude Code** resolves the project to the **innermost `.git`** (the repo
  closest to the file being worked on). The "walk up for `CLAUDE.md`" stops at
  that git boundary; project settings/hooks/MCP are read only at that git root.
  (Open feature requests ask for cross-boundary discovery — anthropics/claude-code
  #37344 and #35561 — i.e. it is not supported today.)
- **Codex** builds its instruction chain **once at session start**, walking from
  the **git root down to `cwd`**. It never reads files **below `cwd`** (children)
  and never reads files **above the git root** (a nested `.git` is a hard ceiling —
  openai/codex #15683, closed as *intended*; mechanism confirmed in #12128). There
  is **no** Claude-style on-demand subdirectory loading.

Consequence: there is **no single launch position** where both `launcher/*` and
`repo1/*` config load together for separate git repos.

- **Launch at the parent** → you get the parent's canonical config, but each
  child repo's config is (largely) invisible.
- **Launch inside a child** → you get that child's config, but the parent's
  canonical is above the child's `.git` ceiling and is not read (except the
  genuinely global `~/.claude` / `~/.codex` / `~/.agents` layer).

## Per-feature compatibility (launch from parent, work inside a child repo)

Goal = the child's own config works **and** the launcher's canonical reaches it.

| Feature | Claude Code | Codex |
|---|---|---|
| Instructions — child's own | ✅ loads on demand | ❌ from parent launch (below cwd); ✅ only if launched inside the child |
| Instructions — **parent canonical reaching the child** | ⚠️ fragile — parent file loads at launch and tends to persist, but once the child is the active project this is undocumented/gappy | ❌ never (frozen root→cwd; parent is above the child's `.git`) |
| Rules | follows `.claude/` discovery → same as instructions | concatenated into AGENTS.md → same (❌ children below cwd) |
| Skills | ✅ child's load on demand; parent's at launch | ❌ scan is cwd→root **upward**; children below cwd never scanned |
| Subagents | ✅ child's on demand; parent's at launch | ❌ children below cwd not loaded |
| **Hooks** | ❌ git-root scoped — child's hooks don't load from a parent launch | ❌ children below cwd; also trust-gated |
| **MCP servers** | ❌ git-root scoped — child's `.mcp.json` doesn't load from a parent launch | ❌ children below cwd |

**Reading it:** Codex is a clean *no*. Claude is *partial but fragile* —
instructions/skills/subagents can partly work, but **hooks and MCP are a hard
break on both**, and the nested-git-repo behavior is an acknowledged gap.

## The monorepo exception (this part *does* work)

If the whole thing is **one** git repo (a monorepo, packages as real
subdirectories with no nested `.git`), then nesting works as designed: launch
anywhere inside it and the root canonical + per-package `CLAUDE.md` / `AGENTS.md` /
skills / agents load. (Claude hooks/MCP are still root-only.) This is the intended
use of nested memory files — but it is "one repo," not "aggregate my separate
repos."

## Why user scope wins instead

| | Parent-launcher (separate repos) | **User scope** (`sync --scope user`) |
|---|---|---|
| Canonical reaches every repo | ❌ blocked at the git boundary | ✅ the global scope loads for every session, any cwd |
| Child repo's own config (incl. hooks/MCP) | ❌ hooks/MCP break; Codex loses everything | ✅ full — you launch **inside** the repo, so its config loads through normal discovery |
| Works identically on both harnesses | ❌ (Codex much worse) | ✅ same model both |
| Directory-layout constraint | must nest all repos under one parent; nested `.git`s confuse git tooling | none — repos live anywhere |
| Selective scope (only *some* repos) | ✅ only repos under the launcher | ❌ applies to *all* repos you open |
| Git-managed canonical | ✅ (launcher dir) | ✅ (the `~/.agconf` store) |

The launcher's **only** real advantage is selective scoping (only repos under it
get the canonical), which user scope lacks (it's global). If we ever want
selective application, the right answer is a per-repo opt-in/opt-out on user scope
— **not** a launcher. The compatibility gaps sink the launcher for separate repos.

## Caveats

These are **version-dependent, fast-moving** surfaces (especially Codex's config
layering). Re-verify against the installed `claude` / `codex --version` before
relying on any edge. Key source issues: claude-code #37344 / #35561 (cross-boundary
discovery, open); codex #15683 (ancestor AGENTS.md above git root, closed as
intended), #12128 (`project_root_markers` vs nested `.git`).
