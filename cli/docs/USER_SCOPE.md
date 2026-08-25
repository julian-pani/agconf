# User Scope — company standards, once per machine

Repo scope commits the company standards into every repository. **User scope**
projects them into your per-user agent config instead — `~/.claude`, `~/.codex` —
so they apply in every project on your machine without being committed anywhere.

Use this when you want the standards to follow *you* rather than a repo: personal
projects, scratch checkouts, or repos where committing an `AGENTS.md` isn't
appropriate. It is not either/or — plenty of setups run user scope on the laptop
*and* repo scope in the team's repositories.

> For the design rationale and the full feature × mode comparison, see
> [Distribution Scopes](./DISTRIBUTION_SCOPES.md). This page is the how-to.

## Install

```bash
npm install -g agconf
```

Then, pointing at the canonical repository that holds your company standards:

```bash
agconf init --scope user
```

That asks three things — the canonical repository, which agent harnesses to
project into, and whether to keep it fresh automatically — then does the whole
setup in one go. Answer them and you're done.

To skip the questions (dotfile bootstrap scripts, a scripted laptop setup):

```bash
agconf init --scope user --source your-org/standards --target claude codex --yes
```

Add `--no-autosync` if you don't want the background refresh. Use
`--local /path/to/canonical` instead of `--source` to point at a checkout on disk.

**Restart your agent session afterwards.** Claude Code and Codex read their
config at startup, so a session that was already running won't see the standards.

## What gets installed where

```
~/.claude/CLAUDE.md          company block + a line importing your personal file
~/.claude/skills/            skills from canonical
~/.claude/rules/             rules from canonical
~/.claude/agents/            subagents from canonical
~/.claude/settings.json      SessionStart hook (agconf session-check)

~/.codex/AGENTS.md           company block + a rules section + a personal-file note
~/.agents/skills/            skills (where Codex looks for them, not ~/.codex/skills)
~/.codex/agents/             subagents, as .toml
~/.codex/hooks.json          SessionStart hook

~/.agconf/                   the store — a git repository
├── lockfile.json            what is synced, from where, at which version
├── global.md                a mirror of the canonical instructions, for readable diffs
├── USER.md                  YOUR personal instructions — agconf never overwrites this
├── config.yaml              auto-sync preference
├── backups/                 timestamped copies of anything a sync would have overwritten
└── logs/                    auto-sync run log
```

Only the marked block is managed. In `~/.claude/CLAUDE.md`:

```markdown
<!-- agconf:global:start -->
<!-- DO NOT EDIT THIS SECTION - Managed by agconf CLI -->

# Engineering Standards

Write tests for every behavioural change.

<!-- agconf:global:end -->

@~/.agconf/USER.md
```

Anything you write outside those markers is yours and survives every sync. If a
file you already had would be overwritten, agconf copies it into
`~/.agconf/backups/<timestamp>/` first (the last 10 are kept).

## Your personal layer

Company standards and personal preferences are deliberately separate files.
Put yours in `~/.agconf/USER.md`:

```bash
$EDITOR ~/.agconf/USER.md
```

Claude imports it automatically via the `@~/.agconf/USER.md` line; on Codex it is
referenced by a note, since Codex has no import syntax. agconf scaffolds this
file once and never touches it again — so your preferences can't be clobbered by
a company-standards update, and they aren't proposed upstream by accident.

## Check that it worked

```bash
agconf check --scope user
```

```
✓ User-scope managed files are unchanged
```

If you (or a tool) edited a managed file, it says so and points at both ways out:

```
✗ User-scope managed files are out of sync:
  modified /Users/you/.claude/skills/code-review/SKILL.md
To send your edits to canonical: `agconf propose --scope user`.
Run `agconf sync --scope user` to restore company standards.
```

The store is a git repository, so you can always read the history of what changed:

```bash
git -C ~/.agconf log -p
```

## Staying up to date

If you enabled auto-sync during setup, there is nothing to do — a background
refresh runs at agent-session start, throttled, and only when you are actually
behind the canonical repo. No cron job or launch agent is installed. When an
update lands after your session started, agconf tells you to restart to pick it
up (a running session can't reload config it already read).

```bash
agconf autosync              # refresh now (--force to bypass the throttle)
agconf autosync --disable    # stop background refreshes (--enable to resume)
agconf autosync --install    # turn it on if you declined at setup
```

To sync by hand at any time — the source is remembered, so no flags needed:

```bash
agconf sync --scope user
```

Runs are logged to `~/.agconf/logs/autosync.log` if you need to see what happened.

## Adding a harness later

Started with Claude only and now want Codex too:

```bash
agconf sync --scope user --target claude codex
```

```bash
agconf session-check --install-hook
```

The second command is needed because the SessionStart hook is only registered for
the targets that existed when it was installed. agconf notices this itself and
nudges you at session start:

```
Note for the developer: your user store is synced for codex, but the
session-check hook isn't installed for that target — run
`agconf session-check --install-hook` to add it.
```

Note that *removing* a target is not a cleanup: content already projected into
that harness stays on disk and stops being checked. `init --scope user` warns you
when you de-select one; delete the leftovers by hand if you want it gone.

## Sending changes back

If you improve a skill or rule in `~/.claude`, propose it to the canonical repo
rather than letting the next sync overwrite it:

```bash
agconf propose --scope user
```

For content you authored from scratch, pass its path — at user scope a path is
required, because `~/.claude` also holds your own personal skills and agconf will
not go looking through them:

```bash
agconf propose --scope user --new ~/.claude/skills/my-new-skill
```

`~/.agconf/USER.md` is never proposed, by any path.

## Running user scope and repo scope together

They coexist, but the same skill delivered by both is duplicated context for the
agent — and if the two copies differ, contradictory instructions. The
`session-check` hook installed during setup watches for exactly that and prints a
note naming the overlapping objects. It is advisory: it never blocks, and the
decision of which scope should own a given skill is yours.

## Turning it off

There is no single uninstall command. To back it out:

```bash
agconf autosync --disable
```

Then, by hand:

1. Remove the `agconf session-check` entry from `~/.claude/settings.json` and
   `~/.codex/hooks.json`.
2. Delete the block between `<!-- agconf:global:start -->` and
   `<!-- agconf:global:end -->` in `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md`
   (and the `agconf:rules` block in the Codex file). Leave the rest — it's yours.
3. Delete the projected content: `~/.claude/skills`, `~/.claude/rules`,
   `~/.claude/agents`, `~/.agents/skills`, `~/.codex/agents` — check for your own
   files there first. agconf-managed markdown carries `agconf_managed: "true"`
   under `metadata:` in its frontmatter; managed Codex `.toml` agents carry a
   leading `# agconf_managed: true` comment. Anything without that is yours:

   ```bash
   grep -rL agconf_managed ~/.claude/skills ~/.claude/rules ~/.claude/agents
   ```
4. Delete `~/.agconf` — but **copy `USER.md` out first** if you want to keep your
   personal instructions.

## Troubleshooting

**The standards aren't showing up in my session.** Restart it. Config is read at
startup.

**`No canonical source`.** The first user-scope sync needs `--source owner/repo`
or `--local <path>`; after that it is remembered in `~/.agconf/lockfile.json`.

**`check --scope user` reports files I didn't touch.** A managed file was changed
outside agconf. `agconf sync --scope user` restores it; `agconf propose --scope user`
sends the change upstream instead. Look at `git -C ~/.agconf log` first if you
want to know what changed.

**Auto-sync doesn't seem to run.** It is throttled and only acts when you're
behind canonical. `agconf autosync --force` runs it now;
`~/.agconf/logs/autosync.log` records every attempt and why it stopped.

**Codex hooks don't fire.** Codex's `hooks` feature can be explicitly disabled;
agconf warns when it detects this. Re-enable with `codex features enable hooks`.

**A file of mine got replaced.** It's in `~/.agconf/backups/<timestamp>/`.
