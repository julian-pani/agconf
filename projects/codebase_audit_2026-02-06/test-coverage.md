# Test Coverage Report

## Coverage Metrics

### Source-to-Test File Mapping

| Source File | Test File(s) | Status |
|-------------|-------------|--------|
| `cli/src/core/sync.ts` | `tests/unit/sync.test.ts`, `tests/integration/init.test.ts` | Partial - main `sync()` only tested via integration |
| `cli/src/core/lockfile.ts` | `tests/unit/lockfile.test.ts` | Partial - schema/hash tested, I/O untested |
| `cli/src/core/markers.ts` | `tests/unit/markers.test.ts` | Partial - rules section functions untested |
| `cli/src/core/merge.ts` | `tests/unit/merge.test.ts` | Good |
| `cli/src/core/source.ts` | `tests/integration/init.test.ts` | Partial - only `resolveLocalSource()` via integration |
| `cli/src/core/workflows.ts` | `tests/unit/workflows.test.ts` | Good |
| `cli/src/core/hooks.ts` | `tests/unit/hooks.test.ts` | Partial - only `installPreCommitHook()` directly tested |
| `cli/src/core/targets.ts` | None | **No tests** |
| `cli/src/core/rules.ts` | `tests/unit/rules.test.ts` | Good |
| `cli/src/core/agents.ts` | `tests/unit/agents.test.ts` | Good |
| `cli/src/core/frontmatter.ts` | None (indirectly via skill-metadata, rules, agents) | **No dedicated tests** |
| `cli/src/core/skill-metadata.ts` | `tests/unit/skill-metadata.test.ts`, `tests/unit/check.test.ts` | Good |
| `cli/src/core/schema.ts` | `tests/unit/lockfile.test.ts` | Partial - `checkSchemaCompatibility()` tested |
| `cli/src/core/version.ts` | `tests/unit/version.test.ts` | Partial - pure functions tested, network functions untested |
| `cli/src/utils/git.ts` | `tests/unit/git.test.ts`, `tests/integration/canonical.test.ts` | Good |
| `cli/src/utils/fs.ts` | None | **No tests** |
| `cli/src/utils/logger.ts` | None | **No tests** |
| `cli/src/config/schema.ts` | `tests/unit/downstream-config.test.ts`, `tests/unit/rules-schema.test.ts` | Good - schemas well-tested |
| `cli/src/config/loader.ts` | `tests/unit/downstream-config.test.ts` | Partial - only `loadDownstreamConfig()` tested |
| `cli/src/config/index.ts` | N/A (re-exports only) | N/A |
| `cli/src/schemas/lockfile.ts` | `tests/unit/lockfile.test.ts`, `tests/unit/rules-schema.test.ts` | Good |
| `cli/src/commands/check.ts` | `tests/unit/check.test.ts` | Good |
| `cli/src/commands/completion.ts` | `tests/unit/completion.test.ts` | Good |
| `cli/src/commands/canonical.ts` | `tests/integration/canonical.test.ts` | Good |
| `cli/src/commands/init.ts` | None | **No tests** |
| `cli/src/commands/sync.ts` | None | **No tests** |
| `cli/src/commands/config.ts` | None | **No tests** |
| `cli/src/commands/upgrade-cli.ts` | None | **No tests** |
| `cli/src/commands/shared.ts` | None | **No tests** |
| `cli/src/cli.ts` | None | **No tests** |
| `cli/src/index.ts` | N/A (re-exports only) | N/A |

### Summary by Status

| Status | Count | Percentage |
|--------|-------|------------|
| Good coverage | 12 | 41% |
| Partial coverage | 7 | 24% |
| No tests | 10 | 34% |
| N/A (re-exports) | 2 | - |

### Test Suite Composition

| Type | Count | Files |
|------|-------|-------|
| Unit tests | 15 | `agents`, `check`, `completion`, `downstream-config`, `git`, `hooks`, `lockfile`, `markers`, `merge`, `rules`, `rules-schema`, `skill-metadata`, `sync`, `version`, `workflows` |
| Integration tests | 2 | `canonical`, `init` |
| E2E tests | 0 | None |

## Coverage Gaps

### Untested Files

The following source files have zero dedicated test coverage:

| File | Criticality | Reason for Concern |
|------|-------------|-------------------|
| `cli/src/core/targets.ts` | High | Validates target names (`isValidTarget`, `parseTargets`, `getTargetConfig`). Incorrect parsing could cause silent sync failures. |
| `cli/src/core/frontmatter.ts` | High | Shared YAML frontmatter parsing/serialization used by skills, rules, and agents. Bugs here cascade to all content types. Only tested indirectly. |
| `cli/src/commands/shared.ts` | High | Contains `performSync()`, `resolveSource()`, `resolveVersion()`, `checkModifiedFilesBeforeSync()`, `promptMergeOrOverride()`. This is the main orchestration layer between CLI and core. |
| `cli/src/commands/init.ts` | Medium | Init command - delegates to shared.ts but has its own argument handling. |
| `cli/src/commands/sync.ts` | Medium | Sync command - delegates to shared.ts but has its own argument handling. |
| `cli/src/commands/config.ts` | Medium | Config get/set/show commands. File I/O and YAML manipulation untested. |
| `cli/src/commands/upgrade-cli.ts` | Medium | CLI upgrade logic including version comparison and npm install. |
| `cli/src/utils/fs.ts` | Low | Simple wrappers (`ensureDir`, `fileExists`, etc.) but still worth testing for edge cases. |
| `cli/src/utils/logger.ts` | Low | `createLogger()` and `formatPath()` - mostly cosmetic. |
| `cli/src/cli.ts` | Low | Entry point, primarily commander.js setup. |

### Untested Functions in Partially-Tested Files

#### `cli/src/core/sync.ts` (Critical gaps)
- `sync()` - The main sync orchestrator. Only tested via integration test (`init.test.ts`). No unit test isolation for error paths, edge cases, or individual branches.
- `getSyncStatus()` - Only tested in integration test. No unit test for error handling (e.g., corrupt lockfile, missing files).
- `copySkillDirectory()` - No test. Handles recursive directory copy with metadata injection.
- `syncSkillsToTarget()` - No test. Orchestrates skill copying for a single target.
- `computeRulesHash()` - No test. Computes aggregate hash for all rules.
- `computeAgentsHash()` - No test. Computes aggregate hash for all agents.
- `discoverRules()` - No test. Discovers rule files from source directory.
- `discoverAgents()` - No test. Discovers agent files from source directory.
- `syncAgents()` - Tested in `agents.test.ts` but only basic paths.

#### `cli/src/core/lockfile.ts`
- `readLockfile()` - No test. Reads and validates lockfile from disk. Error handling for corrupt/missing files untested.
- `writeLockfile()` - No test. Writes lockfile to disk. No test for directory creation, write failures.
- `checkCliVersionMismatch()` - No test. Compares current CLI version against lockfile. Version comparison edge cases untested.

#### `cli/src/core/markers.ts`
- `parseRulesSection()` - No unit test (only tested indirectly via `check.test.ts`).
- `parseRulesSectionMetadata()` - No test.
- `stripRulesSectionMetadata()` - No test.
- `computeRulesSectionHash()` - No unit test (only tested indirectly via `check.test.ts`).
- `hasRulesSectionChanges()` - No test.

#### `cli/src/core/hooks.ts`
- `generatePreCommitHook()` - Not directly tested; only the install function which calls it.
- `getHookConfig()` - No test.

#### `cli/src/core/version.ts`
- `getLatestRelease()` - No test (makes HTTP calls to GitHub API).
- `getReleaseByTag()` - No test (makes HTTP calls).
- `getGitHubToken()` - No test.

#### `cli/src/core/source.ts`
- `resolveGithubSource()` - No test. Resolves GitHub repos via git clone. Critical for remote sync.
- `findCanonicalRepo()` - No test. Walks up directory tree to find canonical config.
- `isCanonicalRepo()` - No test.
- `validateCanonicalRepo()` - No test. Validates canonical config structure.
- `formatSourceString()` - No test. Pure string formatting function.
- `resolveLocalSource()` - Only tested indirectly via `init.test.ts` integration test.

#### `cli/src/config/loader.ts`
- `loadCanonicalRepoConfig()` - No test. Loads and validates the `agconf.yaml` canonical config.

## Missing Test Types

### Unit Tests Needed

**Priority 1 (High Impact, High Risk):**

1. **`core/source.ts`** - `resolveLocalSource()`, `resolveGithubSource()`, `findCanonicalRepo()`, `validateCanonicalRepo()`, `isCanonicalRepo()`, `formatSourceString()`
   - These functions are the gateway to all sync operations. Bugs here can cause data loss or silent failures.
   - `resolveGithubSource()` needs tests with mocked git operations (clone, fetch, checkout).
   - `validateCanonicalRepo()` needs tests for malformed configs, missing required fields.

2. **`core/sync.ts`** - `sync()` function in isolation
   - The main sync function has many code paths: first-time sync vs update, with/without rules, with/without agents, single vs multi-target, override mode, etc.
   - Currently only the happy path is tested via integration. Error paths (e.g., source resolution failure, write permission errors, partial sync failures) are completely untested.

3. **`commands/shared.ts`** - `performSync()`, `resolveSource()`, `resolveVersion()`, `checkModifiedFilesBeforeSync()`
   - Core command orchestration. `checkModifiedFilesBeforeSync()` is a safety feature that prevents data loss - it must be tested.
   - `resolveVersion()` has complex logic for version pinning, latest version lookup, and ref resolution.
   - `promptMergeOrOverride()` needs tests for both interactive and non-interactive (--yes flag) modes.

4. **`core/targets.ts`** - `isValidTarget()`, `parseTargets()`, `getTargetConfig()`
   - Straightforward validation functions. Easy to unit test. Critical for correctness since invalid target names would cause silent failures.

5. **`core/frontmatter.ts`** - `parseFrontmatter()`, `serializeFrontmatter()`, `needsQuoting()`, `buildMarkdownWithFrontmatter()`, `hasFrontmatter()`
   - Shared parsing infrastructure. Bugs here silently corrupt content across all content types.
   - Edge cases: special YAML characters, multiline values, empty frontmatter, missing delimiters.

**Priority 2 (Medium Impact):**

6. **`core/markers.ts`** - Rules section functions (`parseRulesSection()`, `computeRulesSectionHash()`, `hasRulesSectionChanges()`)
   - These are already indirectly tested via `check.test.ts` but need direct unit tests for edge cases.

7. **`core/lockfile.ts`** - `readLockfile()`, `writeLockfile()`, `checkCliVersionMismatch()`
   - I/O operations with error handling. Should test corrupt file handling, missing directories, version mismatch scenarios.

8. **`commands/config.ts`** - `configShowCommand()`, `configGetCommand()`, `configSetCommand()`
   - YAML file manipulation commands. Need tests for reading, writing, and modifying `.agconf/config.yaml`.

9. **`commands/upgrade-cli.ts`** - `upgradeCliCommand()`
   - Version comparison and npm install invocation. Needs mocked `exec` tests.

**Priority 3 (Low Impact):**

10. **`utils/fs.ts`** - Thin wrappers but should have basic edge case tests.
11. **`utils/logger.ts`** - `formatPath()` has testable logic (path shortening).

### Integration Tests Needed

The existing integration tests cover:
- Canonical init (`canonical.test.ts`): 20 tests covering directory structure, config generation, workflow files, smart defaults, and YAML validation.
- Init/sync flow (`init.test.ts`): 8 tests covering first sync, subsequent sync with merge, multi-target sync, CLAUDE.md consolidation, custom marker prefixes, and sync status.

**Missing integration tests:**

1. **GitHub source resolution and sync** - End-to-end sync from a GitHub repository (mocked git operations). Tests `resolveGithubSource()` through the full pipeline.

2. **Rules sync end-to-end** - Complete flow: source with rules directory -> sync -> verify rule files in `.claude/rules/` with correct metadata, and verify Codex AGENTS.md rules section.

3. **Agents sync end-to-end** - Complete flow: source with agents directory -> sync -> verify agent files in `.claude/agents/` with correct metadata, plus Codex skip behavior.

4. **Check command after sync** - Integration test verifying `check` correctly passes immediately after `sync`, then fails after modification. Currently only unit-tested with mocked file systems.

5. **Orphan cleanup flow** - Sync with skills/rules/agents, remove some from source, re-sync, verify orphans are deleted.

6. **Config command flow** - End-to-end test of `config show`, `config get`, `config set` modifying `.agconf/config.yaml`.

7. **Pre-commit hook flow** - Sync installs hook -> modify managed file -> hook triggers check -> check fails.

### E2E Tests Needed

There are currently **zero E2E tests**. The following would provide the highest value:

1. **Full CLI invocation** - Test the actual CLI binary (`agconf init`, `agconf sync`, `agconf check`) via child process execution. This validates commander.js argument parsing, error output formatting, and exit codes.

2. **Workflow execution simulation** - Validate that generated GitHub Actions workflow files would execute correctly (e.g., by running the sync/check steps locally).

## Test Quality Issues

### Strengths

1. **Thorough assertion patterns**: Tests like `check.test.ts` (30+ test cases), `rules.test.ts`, `workflows.test.ts`, and `agents.test.ts` have comprehensive assertions covering happy paths, edge cases, and error conditions.

2. **Good test isolation**: Unit tests use temp directories (`os.tmpdir()`) with proper `beforeEach`/`afterEach` cleanup. No shared mutable state between tests.

3. **Hash consistency verification**: `skill-metadata.test.ts` includes a critical test ("should produce consistent hash format") that verifies the `sha256:` + 12-char hex format. `rules.test.ts` also has a sync-check consistency test. This is excellent defensive testing.

4. **Custom prefix coverage**: Multiple test files (`check.test.ts`, `markers.test.ts`, `merge.test.ts`, `skill-metadata.test.ts`, `init.test.ts`) test custom marker prefixes, validating the plugin-like extensibility.

5. **Integration tests are realistic**: `init.test.ts` creates real directory structures, runs real sync operations, and validates actual file contents. Not overly mocked.

### Weaknesses

1. **`check.test.ts` relies on `process.cwd()` mocking**: The check command tests mock `process.cwd()` via `vi.spyOn(process, "cwd")`, then manually create file structures in temp dirs. This approach is fragile because:
   - It couples tests to the internal implementation detail of how `checkCommand` resolves paths.
   - If `checkCommand` changes its path resolution strategy, all tests break even if behavior is correct.
   - A `cwd` option parameter (as suggested in AGENTS.md guidelines) would be more robust.

2. **No negative/error path tests for I/O operations**: Functions like `readLockfile()`, `writeLockfile()`, `loadCanonicalRepoConfig()`, `loadDownstreamConfig()` have no tests for:
   - Corrupt file content (malformed JSON/YAML)
   - Permission denied errors
   - Missing parent directories
   - Concurrent access / file locking

3. **Network-dependent functions have zero test coverage**: `getLatestRelease()`, `getReleaseByTag()`, and `getGitHubToken()` in `version.ts` make HTTP calls to the GitHub API. These should be tested with mocked HTTP responses (e.g., using `msw` or `vi.mock`).

4. **No test for the main `sync()` orchestrator in isolation**: The 400+ line `sync()` function in `core/sync.ts` is only tested through the integration test. This means:
   - Individual error branches are not verified
   - Partial failure scenarios (e.g., skills sync succeeds but agents sync fails) are untested
   - The interaction between sync components (lockfile write timing, metadata injection order) is not validated at the unit level

5. **Shallow mocking in some tests**: `hooks.test.ts` tests `installPreCommitHook()` by checking file creation, but does not verify the generated hook script content (e.g., correct command, proper shebang, correct check invocation).

6. **Missing boundary tests for `frontmatter.ts`**: Since this module is a custom YAML parser (not using a library for frontmatter), it needs extensive edge case testing:
   - Frontmatter with `---` inside code blocks
   - Values containing colons, quotes, special characters
   - Empty values, multiline values
   - Files with no frontmatter delimiter
   - Files with only opening `---` but no closing `---`

7. **Integration tests don't verify lockfile content**: `init.test.ts` checks that the lockfile exists but does not validate its internal structure (source type, content hashes, file lists, CLI version).

### Mock/Stub Quality

**Good patterns:**
- `completion.test.ts` properly mocks the `tabtab` library and `os.homedir()`, with individual test assertions verifying mock call arguments.
- `git.test.ts` creates real git repositories in temp dirs rather than mocking git, providing high-fidelity tests.
- `downstream-config.test.ts` tests schema validation and file loading with real temp files.

**Areas for improvement:**
- No HTTP mocking infrastructure exists. Tests that need to test GitHub API interactions have no way to do so.
- `process.exit` is not mocked in command tests, meaning commands that call `process.exit(1)` on failure cannot be tested for exit behavior.
- Console output (`console.log`, `console.error`) is not captured or asserted in most tests, missing opportunities to verify user-facing messages.

## Test Organization

### Naming Conventions

Tests follow a consistent `{module}.test.ts` naming convention. The organization is clean:

```
cli/tests/
  unit/              # 15 files - isolated function tests
  integration/       # 2 files - multi-module flow tests
```

**Issue**: Some test files test functions from multiple source modules:
- `downstream-config.test.ts` tests both `config/schema.ts` (schemas) and `config/loader.ts` (loading)
- `rules-schema.test.ts` tests both `config/schema.ts` and `schemas/lockfile.ts`
- `lockfile.test.ts` tests both `core/lockfile.ts` and `core/schema.ts`
- `check.test.ts` tests `commands/check.ts` plus indirectly tests `core/skill-metadata.ts` checking functions

This is not necessarily a problem -- grouping by feature rather than source file can improve readability -- but it makes it harder to identify coverage gaps through file mapping alone.

### Describe Block Organization

Tests use nested `describe` blocks consistently. Example from `check.test.ts`:
```
describe("check command")
  describe("when repo is not synced")
  describe("when repo is synced with no changes")
  describe("when managed skill is modified")
  describe("when AGENTS.md global block is modified")
  ...
```

This pattern is used across all test files and provides good test discoverability.

## Recommendations

### Priority 1: Critical (Immediate)

1. **Add unit tests for `core/source.ts`** - This module handles all source resolution (local and GitHub). It is on the critical path for every sync operation. Focus on: `resolveLocalSource()` validation errors, `resolveGithubSource()` with mocked git, `validateCanonicalRepo()` with malformed configs, `findCanonicalRepo()` directory traversal, `isCanonicalRepo()` detection.

2. **Add unit tests for `core/frontmatter.ts`** - As a custom YAML parser shared by skills, rules, and agents, any parsing bug silently corrupts all synced content. Test: special characters, empty frontmatter, malformed delimiters, roundtrip (parse then serialize), `needsQuoting()` edge cases.

3. **Add unit tests for `commands/shared.ts`** - This is the command-layer orchestration. Especially: `checkModifiedFilesBeforeSync()` (safety-critical), `resolveVersion()` (complex version resolution), `performSync()` error handling.

### Priority 2: High (This Sprint)

4. **Add unit tests for `core/sync.ts` main `sync()` function** - Test individual code paths: first sync vs update, with/without rules, with/without agents, override mode, error recovery. Use dependency injection or module mocking to isolate from file system.

5. **Add unit tests for `core/targets.ts`** - Simple to write, high value. Test `isValidTarget()` with valid/invalid names, `parseTargets()` with comma-separated strings, `getTargetConfig()` for each target type.

6. **Add unit tests for markers.ts rules section functions** - `parseRulesSection()`, `computeRulesSectionHash()`, `hasRulesSectionChanges()` need direct unit tests with various AGENTS.md content shapes.

7. **Add unit tests for `core/lockfile.ts` I/O functions** - `readLockfile()` with corrupt JSON, missing file, valid file. `writeLockfile()` with various lockfile states. `checkCliVersionMismatch()` with version edge cases.

8. **Set up HTTP mocking** - Add `msw` or similar to enable testing `version.ts` network functions and future GitHub API integrations.

### Priority 3: Medium (Backlog)

9. **Add integration test for rules sync end-to-end** - Source with rules -> sync -> verify Claude rule files and Codex AGENTS.md rules section.

10. **Add integration test for agents sync end-to-end** - Source with agents -> sync -> verify agent files and Codex skip behavior.

11. **Add integration test for check-after-sync** - Verify that `check` passes immediately after `sync` and fails after content modification.

12. **Add command tests for `config.ts`, `upgrade-cli.ts`** - Both have user-facing behavior that should be verified.

13. **Refactor `check.test.ts` to use `cwd` parameter** - Replace `process.cwd()` mocking with an explicit `cwd` option on `checkCommand`, as recommended by the project's own AGENTS.md testing guidelines.

14. **Add lockfile content validation to integration tests** - Verify lockfile structure (source, content hashes, file lists) after sync operations.

### Priority 4: Low (Future)

15. **Add E2E tests** - Test the actual CLI binary via child process execution to validate argument parsing, error formatting, and exit codes.

16. **Add tests for `utils/fs.ts` and `utils/logger.ts`** - Low risk but good for completeness.

17. **Add console output assertions** - Capture and verify user-facing messages in command tests.

18. **Consider adding test coverage tooling** - Configure Vitest coverage reporting (`pnpm test:coverage` exists but no coverage thresholds are enforced). Set minimum coverage thresholds for `core/` modules (e.g., 80% line coverage).

## Estimated Effort

| Priority | Item Count | Estimated Effort |
|----------|-----------|-----------------|
| Critical | 3 items | 2-3 days |
| High | 5 items | 3-4 days |
| Medium | 6 items | 3-4 days |
| Low | 4 items | 2-3 days |
| **Total** | **18 items** | **10-14 days** |
