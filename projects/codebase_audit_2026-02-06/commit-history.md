# Commit History (Last 100 Commits)

Gathered on 2026-02-06. Covers full project history from initial release through v0.6.2.

## Key Development Phases

### Recent (2026-02-06)
- Skills system added (code-review, codebase-audit)
- Dead code cleanup (removed unused functions)
- Parallel worktrees documentation
- Sync workflow branch management simplification
- Hash format inconsistency fix
- Agents sync feature added
- Frontmatter parsing consolidated into shared module

### Mid-phase (2026-02-03 - 2026-02-04)
- Per-downstream-repo workflow configuration
- Rules sync feature and check command integrity
- CLAUDE.md consolidation during sync
- Status command removed
- Rules stabilization and hash fixes

### Early phase (2026-02-01 - 2026-02-02)
- Schema-based versioning and architecture simplification
- Plugin system removed in favor of direct implementation
- Custom marker prefix support
- Workflow improvements (auth, branch management)
- Migration from changesets to semantic-release
- Initial release and npm publishing setup

## Active Contributors
- Julian Pani (primary developer)
- semantic-release-bot (automated releases)

## Hotspot Files (Most Frequently Modified)
- cli/src/core/sync.ts
- cli/src/core/skill-metadata.ts
- cli/src/commands/shared.ts
- cli/src/commands/check.ts
- cli/src/core/lockfile.ts
- cli/src/core/workflows.ts
- AGENTS.md
