## [0.22.2](https://github.com/julian-pani/agconf/compare/v0.22.1...v0.22.2) (2026-08-16)

### Bug Fixes

* **propose:** dedupe skill names before asset diffing ([a276f3f](https://github.com/julian-pani/agconf/commit/a276f3f61bf5df97b4486f7a9521123193fc20ab))

## [0.22.1](https://github.com/julian-pani/agconf/compare/v0.22.0...v0.22.1) (2026-08-16)

### Bug Fixes

* **security:** redact embedded git token from clone error messages ([e5a54d9](https://github.com/julian-pani/agconf/commit/e5a54d97e84e6892e9973e58cde142dbca859da2))

## [0.22.0](https://github.com/julian-pani/agconf/compare/v0.21.0...v0.22.0) (2026-08-16)

### Features

* **propose:** rebase proposals onto canonical HEAD ([21362a0](https://github.com/julian-pani/agconf/commit/21362a0c85947d15d5d7796409f2ca99e8ece195))

## [0.21.0](https://github.com/julian-pani/agconf/compare/v0.20.1...v0.21.0) (2026-08-16)

### Features

* **autosync:** auto-refresh the user store at session start ([#73](https://github.com/julian-pani/agconf/issues/73)) ([7e5c2db](https://github.com/julian-pani/agconf/commit/7e5c2db86586adbcfb9a6f95031700fba0f857d1))
* **session-check:** cross-scope duplication guard + SessionStart hook ([#72](https://github.com/julian-pani/agconf/issues/72)) ([6b85720](https://github.com/julian-pani/agconf/commit/6b85720348d65bcf9d3367404adb299b09e285d1))
* **sync:** user-scope sync (--scope user) for company instructions ([#70](https://github.com/julian-pani/agconf/issues/70)) ([d17443f](https://github.com/julian-pani/agconf/commit/d17443f9904669f104aa15d81d9e269cbe12be8a))

## [0.20.1](https://github.com/julian-pani/agconf/compare/v0.20.0...v0.20.1) (2026-08-06)

### Bug Fixes

* **canonical:** push synced workflow files via the app token ([f291295](https://github.com/julian-pani/agconf/commit/f291295885d66ce88b85c2540f57fd723a1ff585))

## [0.20.0](https://github.com/julian-pani/agconf/compare/v0.19.0...v0.20.0) (2026-08-05)

### Features

* **compile:** auto-bump plugin versions on content change ([04b5291](https://github.com/julian-pani/agconf/commit/04b529121a4f4ba15b77cf05b02fc5e3f7eb9e1f))

## [0.19.0](https://github.com/julian-pani/agconf/compare/v0.18.0...v0.19.0) (2026-08-05)

### Features

* **sync:** add per-type delivery map (skills/agents/mcps) ([2cbc01a](https://github.com/julian-pani/agconf/commit/2cbc01ae7cb86178646167d09cc7495a8b0149b1))

## [0.18.0](https://github.com/julian-pani/agconf/compare/v0.17.0...v0.18.0) (2026-08-04)

### Features

* **codex:** align skills path + sync subagents to current Codex CLI ([#67](https://github.com/julian-pani/agconf/issues/67)) ([b0a3d0e](https://github.com/julian-pani/agconf/commit/b0a3d0e9316168b3a8222f5935b184e52f960682))

## [0.17.0](https://github.com/julian-pani/agconf/compare/v0.16.2...v0.17.0) (2026-08-03)

### Features

* **hooks:** integrate with pre-commit framework instead of appending dead code ([#66](https://github.com/julian-pani/agconf/issues/66)) ([6d1bea2](https://github.com/julian-pani/agconf/commit/6d1bea2aa420dee36aa3fbfb858bf0647b751795))

## [0.16.2](https://github.com/julian-pani/agconf/compare/v0.16.1...v0.16.2) (2026-08-02)

### Bug Fixes

* **sync:** skip redundant force-push when PR branch is already current ([#65](https://github.com/julian-pani/agconf/issues/65)) ([8ab6f6f](https://github.com/julian-pani/agconf/commit/8ab6f6f0b41fc581fdde1f9f84adb5ec1aae48a1))

## [0.16.1](https://github.com/julian-pani/agconf/compare/v0.16.0...v0.16.1) (2026-07-02)

### Bug Fixes

* **sync:** resolve git hooks dir for worktrees instead of crashing ([#64](https://github.com/julian-pani/agconf/issues/64)) ([337b874](https://github.com/julian-pani/agconf/commit/337b87418000e5231db1a21ef6b66ae9456c1695))

## [0.16.0](https://github.com/julian-pani/agconf/compare/v0.15.0...v0.16.0) (2026-06-30)

### Features

* **cli:** compile installable Claude Code & Codex plugins from canonical content ([#63](https://github.com/julian-pani/agconf/issues/63)) ([61867a2](https://github.com/julian-pani/agconf/commit/61867a290833bbfa8c50c2a663f04611f4b64d17))

## [0.15.0](https://github.com/julian-pani/agconf/compare/v0.14.1...v0.15.0) (2026-06-09)

### Features

* **cli:** delete orphaned rules/agents on sync and detect orphans in check ([#62](https://github.com/julian-pani/agconf/issues/62)) ([e958908](https://github.com/julian-pani/agconf/commit/e9589083253dd16fe11179f45e37acb727d8eda8))

## [0.14.1](https://github.com/julian-pani/agconf/compare/v0.14.0...v0.14.1) (2026-06-03)

### Bug Fixes

* honor configured canonical content dirs (skills_dir/instructions/rules_dir/agents_dir) ([#59](https://github.com/julian-pani/agconf/issues/59)) ([4554b80](https://github.com/julian-pani/agconf/commit/4554b80169b140caaf4d49e8e34b77a558511175))

## [0.14.0](https://github.com/julian-pani/agconf/compare/v0.13.3...v0.14.0) (2026-06-02)

### Features

* **cli:** propose new content upstream and guard sync from overwriting local edits ([#58](https://github.com/julian-pani/agconf/issues/58)) ([2041ffa](https://github.com/julian-pani/agconf/commit/2041ffadb1200c935d15f47755a9e99e67497b7e))

## [0.13.3](https://github.com/julian-pani/agconf/compare/v0.13.2...v0.13.3) (2026-05-13)

### Bug Fixes

* **cli:** propose all files in managed skill dirs, not just SKILL.md ([#56](https://github.com/julian-pani/agconf/issues/56)) ([23525cc](https://github.com/julian-pani/agconf/commit/23525ccd230af5de232bd8ee920cd6dc481284d7))

## [0.13.2](https://github.com/julian-pani/agconf/compare/v0.13.1...v0.13.2) (2026-02-19)

### Bug Fixes

* **cli:** detect silent upgrade failure for Volta and similar tool managers ([#37](https://github.com/julian-pani/agconf/issues/37)) ([5f75480](https://github.com/julian-pani/agconf/commit/5f75480334efa40ace439cd97c1ea5f4927b389d))

## [0.13.1](https://github.com/julian-pani/agconf/compare/v0.13.0...v0.13.1) (2026-02-19)

### Bug Fixes

* **cli:** use regex matching for propose --files filter ([#36](https://github.com/julian-pani/agconf/issues/36)) ([58afa0d](https://github.com/julian-pani/agconf/commit/58afa0d2fc223eb576849c2d5c4515707336a6b8))

## [0.13.0](https://github.com/julian-pani/agconf/compare/v0.12.0...v0.13.0) (2026-02-19)

### Features

* **cli:** add propose command and smart pre-commit hook ([#35](https://github.com/julian-pani/agconf/issues/35)) ([56e822d](https://github.com/julian-pani/agconf/commit/56e822df1178acae2fa2a1b60541a0a1225ed66a))

## [0.12.0](https://github.com/julian-pani/agconf/compare/v0.11.2...v0.12.0) (2026-02-16)

### Features

* **cli:** auto-detect package manager for upgrade-cli command ([f295785](https://github.com/julian-pani/agconf/commit/f295785016ec8ecfa441615eebb22735758e8246))

## [0.11.2](https://github.com/julian-pani/agconf/compare/v0.11.1...v0.11.2) (2026-02-10)

### Bug Fixes

* **cli:** scope GitHub App token to canonical repository in sync workflow ([2881037](https://github.com/julian-pani/agconf/commit/2881037d7838b7539907087c61cfb51deacce2bf))

## [0.11.1](https://github.com/julian-pani/agconf/compare/v0.11.0...v0.11.1) (2026-02-10)

### Bug Fixes

* **cli:** skip pre-commit hook in sync workflow commits ([4861781](https://github.com/julian-pani/agconf/commit/4861781c3bc0999f542aa2f21d750db8309456aa))

## [0.11.0](https://github.com/julian-pani/agconf/compare/v0.10.2...v0.11.0) (2026-02-09)

### Features

* **cli:** append agconf hook to existing pre-commit hooks ([#30](https://github.com/julian-pani/agconf/issues/30)) ([9d52614](https://github.com/julian-pani/agconf/commit/9d526145fc0055bb26044e66a4f9b3de04d693f7))

## [0.10.2](https://github.com/julian-pani/agconf/compare/v0.10.1...v0.10.2) (2026-02-09)

### Bug Fixes

* only show AGENTS.md as updated when content actually changed ([a96a42b](https://github.com/julian-pani/agconf/commit/a96a42b89a2ddf1324d7e4cdebc9976c51cde8db))

## [0.10.1](https://github.com/julian-pani/agconf/compare/v0.10.0...v0.10.1) (2026-02-09)

### Bug Fixes

* use step output instead of secrets context in reusable workflow if condition ([7260791](https://github.com/julian-pani/agconf/commit/72607912f5b4bce5202e41e878a6cfeeb6f41c17))

## [0.10.0](https://github.com/julian-pani/agconf/compare/v0.9.0...v0.10.0) (2026-02-09)

### Features

* improve canonical init defaults and AGENTS.md handling ([bb76d70](https://github.com/julian-pani/agconf/commit/bb76d706f6d136435d82c613aac62c4058a3e28c))

## [0.9.0](https://github.com/julian-pani/agconf/compare/v0.8.0...v0.9.0) (2026-02-09)

### Features

* support GitHub App authentication in sync workflows ([#29](https://github.com/julian-pani/agconf/issues/29)) ([adf2f12](https://github.com/julian-pani/agconf/commit/adf2f129eeeaeca40c8f046df5c2227547f4abd9))

## [0.8.0](https://github.com/julian-pani/agconf/compare/v0.7.2...v0.8.0) (2026-02-08)

### Features

* add plan-review skill for pre-implementation plan review ([53affe4](https://github.com/julian-pani/agconf/commit/53affe4858b52d962bea67c53499c2fa9b03f47b))

### Bug Fixes

* remove context:fork and fix doc-planner subagent invocation ([b346ede](https://github.com/julian-pani/agconf/commit/b346ede17cdadaaefb712549784561b5c0ecce50))

## [0.7.2](https://github.com/julian-pani/agconf/compare/v0.7.1...v0.7.2) (2026-02-08)

### Bug Fixes

* broaden check workflow path filters to cover all managed content ([1bb485f](https://github.com/julian-pani/agconf/commit/1bb485f69312b4829992c6ad72f7df6cf1413922))

## [0.7.1](https://github.com/julian-pani/agconf/compare/v0.7.0...v0.7.1) (2026-02-08)

### Bug Fixes

* add worktrees to gitignore ([b1d919d](https://github.com/julian-pani/agconf/commit/b1d919d5c9976ebee277e0262773a9e9e271f5df))

## [0.7.0](https://github.com/julian-pani/agconf/compare/v0.6.2...v0.7.0) (2026-02-08)

### Features

* add documentation standards skill and doc maintenance agents ([e01f7d5](https://github.com/julian-pani/agconf/commit/e01f7d56777a870e6de335b4536e51257440c6da))

### Bug Fixes

* add some skills ([5f465e1](https://github.com/julian-pani/agconf/commit/5f465e11fb2fb54d4f7c579a728e77d7799272f4))

## [0.6.2](https://github.com/julian-pani/agconf/compare/v0.6.1...v0.6.2) (2026-02-06)

### Bug Fixes

* **cli:** remove dead code and fix hash format inconsistency ([7f1cd0d](https://github.com/julian-pani/agconf/commit/7f1cd0dba42006f9b68895008c6633e80f06aac3))
* **cli:** remove unused getModifiedSkillFiles and getModifiedRuleFiles ([9e9bd50](https://github.com/julian-pani/agconf/commit/9e9bd501efab8bf21bc01034d6a957b7195139ee))

## [0.6.1](https://github.com/julian-pani/agconf/compare/v0.6.0...v0.6.1) (2026-02-06)

### Bug Fixes

* **cli:** simplify sync workflow branch management ([025861e](https://github.com/julian-pani/agconf/commit/025861ec192688696d7210c29f656baebbcfd34d))

## [0.6.0](https://github.com/julian-pani/agconf/compare/v0.5.0...v0.6.0) (2026-02-06)

### Features

* **cli:** add agents sync support ([2e99f19](https://github.com/julian-pani/agconf/commit/2e99f19371d4d72dbabb16eaeedc01413a023824))

## [0.5.0](https://github.com/julian-pani/agconf/compare/v0.4.4...v0.5.0) (2026-02-06)

### Features

* **cli:** add per-downstream-repo workflow configuration ([6537599](https://github.com/julian-pani/agconf/commit/653759953501e8643e03abcb9e4a179693db763f))

## [0.4.4](https://github.com/julian-pani/agconf/compare/v0.4.3...v0.4.4) (2026-02-04)

### Bug Fixes

* **cli:** prevent duplicate check workflow runs on PRs ([11108b5](https://github.com/julian-pani/agconf/commit/11108b59799939b79ba02f95512264ef0e0f0db7))

## [0.4.3](https://github.com/julian-pani/agconf/compare/v0.4.2...v0.4.3) (2026-02-03)

### Bug Fixes

* **cli:** stabilize rules order in lockfile ([d106937](https://github.com/julian-pani/agconf/commit/d106937675876e1265ee5ec4274bca944eeed4c9))

## [0.4.2](https://github.com/julian-pani/agconf/compare/v0.4.1...v0.4.2) (2026-02-03)

### Bug Fixes

* fix package.json install command for dev ([99a0279](https://github.com/julian-pani/agconf/commit/99a02799f6e858a49766857bcf2b988ffa699062))

## [0.4.1](https://github.com/julian-pani/agconf/compare/v0.4.0...v0.4.1) (2026-02-03)

### Bug Fixes

* **cli:** hash mismatch for rules without frontmatter ([d776656](https://github.com/julian-pani/agconf/commit/d77665646cc7ba89d181bcefb936ad83ed012c23))

## [0.4.0](https://github.com/julian-pani/agconf/compare/v0.3.5...v0.4.0) (2026-02-03)

### Features

* **cli:** consolidate both CLAUDE.md locations during sync ([f744fb4](https://github.com/julian-pani/agconf/commit/f744fb4dac471702ff401f40be6a07133dc4991d))

### Bug Fixes

* **cli:** remove confusing status command ([52e07d3](https://github.com/julian-pani/agconf/commit/52e07d305e0533c6e27569f917d85b941101a154))

## [0.3.5](https://github.com/julian-pani/agconf/compare/v0.3.4...v0.3.5) (2026-02-03)

### Bug Fixes

* **cli:** use markerPrefix for workflow filenames and names ([1cc042a](https://github.com/julian-pani/agconf/commit/1cc042a420bad350e9b7bb5930e866177bca6ff4))

## [0.3.4](https://github.com/julian-pani/agconf/compare/v0.3.3...v0.3.4) (2026-02-02)

### Bug Fixes

* **cli:** pass markerPrefix to syncWorkflows ([fcec3de](https://github.com/julian-pani/agconf/commit/fcec3dea8098260682a6bfe06f3330a3606000ad))

## [0.3.3](https://github.com/julian-pani/agconf/compare/v0.3.2...v0.3.3) (2026-02-02)

### Bug Fixes

* **cli:** use markerPrefix for workflow secret name ([bb05ac6](https://github.com/julian-pani/agconf/commit/bb05ac6adfd3ddc7e40c263130ccc568a913da43))

## [0.3.2](https://github.com/julian-pani/agconf/compare/v0.3.1...v0.3.2) (2026-02-02)

### Bug Fixes

* **cli:** rename agent-conf references to agconf throughout codebase ([d5802a8](https://github.com/julian-pani/agconf/commit/d5802a827b738a85cd914399ed63fc8ba67631ec))

## [0.3.1](https://github.com/julian-pani/agconf/compare/v0.3.0...v0.3.1) (2026-02-02)

### Bug Fixes

* **cli:** use lockfile targets when --target not specified in sync ([f5ab1f3](https://github.com/julian-pani/agconf/commit/f5ab1f3390e55d06ae685870c7cb88d3a1d88707))

## [0.3.0](https://github.com/julian-pani/agconf/compare/v0.2.0...v0.3.0) (2026-02-02)

### Features

* **cli:** improve sync output status indicators and clarify counts ([b1d71d6](https://github.com/julian-pani/agconf/commit/b1d71d604ed432f5f75d7977dc6e734abd44ae1b))

## [0.2.0](https://github.com/julian-pani/agconf/compare/v0.1.0...v0.2.0) (2026-02-02)

### Features

* **cli:** add rules sync feature and fix check command integrity ([4146f0f](https://github.com/julian-pani/agconf/commit/4146f0f462fce5beb5e2a9a6888f0f75f7f6fe1f))
* **cli:** implement schema-based versioning and simplify architecture ([d9ebe2c](https://github.com/julian-pani/agconf/commit/d9ebe2cf83437535a0ec9b222ff12e6314680d36))
* **release:** change npm package name to agconf ([efd86fd](https://github.com/julian-pani/agconf/commit/efd86fd27d0770f194e678ec7c7698231a79396e))

## [0.2.0](https://github.com/julian-pani/agconf/compare/v0.1.0...v0.2.0) (2026-02-02)

### Features

* **cli:** add rules sync feature and fix check command integrity ([4146f0f](https://github.com/julian-pani/agconf/commit/4146f0f462fce5beb5e2a9a6888f0f75f7f6fe1f))
* **cli:** implement schema-based versioning and simplify architecture ([d9ebe2c](https://github.com/julian-pani/agconf/commit/d9ebe2cf83437535a0ec9b222ff12e6314680d36))
* **release:** change npm package name to agconf ([efd86fd](https://github.com/julian-pani/agconf/commit/efd86fd27d0770f194e678ec7c7698231a79396e))

## [0.2.0](https://github.com/julian-pani/agconf/compare/v0.1.0...v0.2.0) (2026-02-02)

### Features

* **cli:** add rules sync feature and fix check command integrity ([4146f0f](https://github.com/julian-pani/agconf/commit/4146f0f462fce5beb5e2a9a6888f0f75f7f6fe1f))
* **cli:** implement schema-based versioning and simplify architecture ([d9ebe2c](https://github.com/julian-pani/agconf/commit/d9ebe2cf83437535a0ec9b222ff12e6314680d36))

## [0.2.0](https://github.com/julian-pani/agconf/compare/v0.1.0...v0.2.0) (2026-02-01)

### Features

* **cli:** implement schema-based versioning and simplify architecture ([e6ae828](https://github.com/julian-pani/agconf/commit/e6ae8280b1bfb569aeff08321bde03deb65adc00))

## [0.1.0](https://github.com/julian-pani/agconf/compare/v0.0.3...v0.1.0) (2026-02-01)

### Features

* **cli:** pin CLI version in generated workflows and add canonical command ([7669899](https://github.com/julian-pani/agconf/commit/7669899a16b3a693aca6acc1cb680c119c7158a0))

## [0.0.3](https://github.com/julian-pani/agconf/compare/v0.0.2...v0.0.3) (2026-02-01)

### Bug Fixes

* **tests:** skip built CLI version test when dist doesn't exist ([ac13c18](https://github.com/julian-pani/agconf/commit/ac13c18ba8e0838f5c5feae60637f0b41eedd447))

## [0.0.2](https://github.com/julian-pani/agconf/compare/v0.0.1...v0.0.2) (2026-02-01)

### Bug Fixes

* **release:** block major releases without manual approval ([32af1b4](https://github.com/julian-pani/agconf/commit/32af1b42004d0dab5557366fec6bee0ef1c578e9))

## [2.2.2](https://github.com/julian-pani/agconf/compare/v2.2.1...v2.2.2) (2026-02-01)

### Bug Fixes

* **workflows:** remove token requirement from check workflow ([7f9a7f7](https://github.com/julian-pani/agconf/commit/7f9a7f73fefdfe44c0e490cb941466078747f752))

## [2.2.1](https://github.com/julian-pani/agconf/compare/v2.2.0...v2.2.1) (2026-02-01)

### Bug Fixes

* **workflows:** reuse existing PR branch instead of creating duplicates ([3a3b9df](https://github.com/julian-pani/agconf/commit/3a3b9df347e03acb1eade3f9d81ee28d71adea21))

## [2.2.0](https://github.com/julian-pani/agconf/compare/v2.1.1...v2.2.0) (2026-02-01)

### Features

* **sync:** add detailed sync summary for workflow PR descriptions ([5562f9a](https://github.com/julian-pani/agconf/commit/5562f9a728b60e9b390eca6f3b0469433cfce0ca))

## [2.1.1](https://github.com/julian-pani/agconf/compare/v2.1.0...v2.1.1) (2026-02-01)

### Bug Fixes

* **lockfile:** inject CLI version from package.json at build time ([9b308e0](https://github.com/julian-pani/agconf/commit/9b308e0fd96e0ef435980419a0be0b8c8488faa4))

## [2.1.0](https://github.com/julian-pani/agconf/compare/v2.0.4...v2.1.0) (2026-02-01)

### Features

* **markers:** wire custom marker prefix through entire sync pipeline ([3c7b76b](https://github.com/julian-pani/agconf/commit/3c7b76b06c0540427a4f54a4a0ca93cf71ed0e26))

## [2.0.4](https://github.com/julian-pani/agconf/compare/v2.0.3...v2.0.4) (2026-02-01)

### Bug Fixes

* **workflows:** ignore lockfile when detecting meaningful changes in sync workflow ([fa70eff](https://github.com/julian-pani/agconf/commit/fa70effe3ca2044ffe5cdfc492a771775e663e09))

## [2.0.3](https://github.com/julian-pani/agconf/compare/v2.0.2...v2.0.3) (2026-02-01)

### Bug Fixes

* **source:** use gh CLI for authenticated git clone in CI ([2404eac](https://github.com/julian-pani/agconf/commit/2404eacab568a27cea2ebf2742c9809174f78b0d))

## [2.0.2](https://github.com/julian-pani/agconf/compare/v2.0.1...v2.0.2) (2026-02-01)

### Bug Fixes

* **workflows:** use default github.token for downstream repo operations ([2f12f45](https://github.com/julian-pani/agconf/commit/2f12f4590125f1183bea7c1fc50621e464d0b9e2))

## [2.0.1](https://github.com/julian-pani/agconf/compare/v2.0.0...v2.0.1) (2026-02-01)

### Bug Fixes

* **tests:** handle global git config in getGitOrganization test ([9333213](https://github.com/julian-pani/agconf/commit/93332137b1753dc75213379bd0a26137e8978846))

## [2.0.0](https://github.com/julian-pani/agconf/compare/v1.0.2...v2.0.0) (2026-02-01)

### ⚠ BREAKING CHANGES

* **cli:** The `update` command has been removed. The `sync` command
now fetches the latest release by default (like `update` did).

- `sync` without flags now fetches latest and syncs (was: use lockfile version)
- `sync --pinned` uses lockfile version without fetching (old `sync` behavior)
- `sync --ref <version>` pins to specific version (unchanged)

Migration:
- `agconf update` → `agconf sync`
- `agconf sync` (old) → `agconf sync --pinned`

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>

### Bug Fixes

* **cli:** consolidate update command into sync ([7b156ec](https://github.com/julian-pani/agconf/commit/7b156ec2b80a4b536d0cb24ace915eb29bd2b597))

---
layout: default
title: Changelog
nav_order: 7
---

## [Unreleased]

### Changed

- **BREAKING**: Consolidated `update` command into `sync`. The `sync` command now fetches the latest release by default (like `update` did). Use `--pinned` to sync using the lockfile version without fetching.

### Removed

- `update` command (functionality merged into `sync`)

## [1.0.2](https://github.com/julian-pani/agconf/compare/v1.0.1...v1.0.2) (2026-02-01)

### Bug Fixes

* bump version ([41c3ccf](https://github.com/julian-pani/agconf/commit/41c3ccf34746ba358e676b577cba9be8f8bf65f7))

## [1.0.1](https://github.com/julian-pani/agconf/compare/v1.0.0...v1.0.1) (2026-02-01)

### Bug Fixes

* **cli:** use full GitHub URLs for documentation references ([5b623a5](https://github.com/julian-pani/agconf/commit/5b623a5993c45cf88becfd5989e0ac7b49ad7906))

## 1.0.0 (2026-02-01)

### Features

* agconf CLI, initial work, partial MVP ([bbb9472](https://github.com/julian-pani/agconf/commit/bbb9472f0f5fb1aa092fd63e91187adb3bb0d6b9))
* prepare CLI for npm publishing ([a151423](https://github.com/julian-pani/agconf/commit/a151423ff4c76e1a82dbcb2461bca5d341df3522))

### Bug Fixes

* **release:** fixing the release from github ([e5d4628](https://github.com/julian-pani/agconf/commit/e5d462836cb5cc615705b42c91b120105b8db789))

# Changelog

## 0.1.2

### Patch Changes

- Cleaned up history

## 0.1.1

### Patch Changes

- 0d90f29: Fix changeset publishing

## 0.1.0

### Minor Changes

- 46abea1: Initial release, MVP

### Patch Changes

- 46abea1: Improve npm readme

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **BREAKING**: Consolidated `update` command into `sync`. The `sync` command now fetches the latest release by default (like `update` did). Use `--pinned` to sync using the lockfile version without fetching.

### Removed

- `update` command (functionality merged into `sync`)

## [0.1.0] - 2025-01-30

### Added

- **Core Commands**

  - `agconf init` - Initialize a repository with standards from a canonical repository
  - `agconf sync` - Sync content from the canonical repository (fetches latest by default)
  - `agconf status` - Show current sync status
  - `agconf check` - Check if managed files have been modified

- **Repository Management**

  - `agconf init-canonical-repo` - Scaffold a new canonical repository structure
  - `agconf upgrade-cli` - Upgrade the CLI itself to the latest version
  - `agconf config` - Manage global CLI configuration

- **Architecture**

  - 3-repository model: CLI, Canonical, and Downstream repositories
  - Independent versioning of CLI and canonical content
  - Plugin system with providers (GitHub, Local) and targets (Claude, Codex)
  - Configurable marker prefixes for multi-org support

- **File Management**

  - AGENTS.md with managed global and repo-specific sections
  - Skills directory sync (`.claude/skills/`)
  - GitHub Actions workflows for auto-sync and integrity checks
  - Lockfile tracking (`.agconf/lockfile.json`)

- **Developer Experience**

  - Pre-commit hook integration for file integrity
  - Support for local canonical repositories (development mode)
  - Shell completion support via tabtab

- **CI/CD Integration**
  - Reusable GitHub Actions workflows
  - `agconf-sync.yml` for scheduled syncing
  - `agconf-check.yml` for PR validation

[Unreleased]: https://github.com/julian-pani/agconf/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/julian-pani/agconf/releases/tag/v0.1.0
