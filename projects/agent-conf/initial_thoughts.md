I'm trying to find a good solution to manage coding agents for a team of developers working on multiple repositories and programming languages.



I want to ensure they team has common agents.md/claude.md files, skills, subagents, MCP servers, etc. These would include company's standards, best practices, and engineering culture.

In addition, each repository can have additional instructions and context specific to that repo.



One thing I want to be able to do is self improve: as agents work on a repo, they encounter friction (missing background knowledge, missing permissions, etc) and submit it for future improvement. Then some process picks those up and makes the necessary improvements.



Another thing is that I want to support multiple coding agents, like Claude code, codex, etc.





One way to manage this is to have an agent-configs repo with the shared stuff, and a script to sync it to the home folder (~/.claude, ~/.codex, etc) on every engineers computer.

Another option is to have a copy of the global instructions to every repository and keep them in sync.



The advantages of the first approach (single repo + sync to home folder) are:

1. The self improvement is easier to do, since there is one shared "global context", I can have agents introspect to find the best way to make improvements, either global or to the specific repo.

2. The global context is one place, easier to manage as a whole.

3. Built in way to mix global context with repo-specific context, supported by all coding agents.



The disadvantages:

1. These global instructions apply to all repos always. But maybe this is not alwsys what I want? For example if I'm experimenting with something on the side to learn some new tech, or prototype something, I may not want the global instructions of "always write production code, fully tested", etc. It doesn't leave much flexibility.

2. Need to keep the instructions in sync across dev machines, managed outside git. This becomes even more complicated as we start thinking about CI, coding agents working in the cloud, etc.

3. The self improvement may be complicated by the fact that the global instructions may be out of sync in a developers' machine.



The advantages of the second approach (copy of instructions in every repo):

1. Easier to sync changes to developers machines (via git, within the repo). Can be synced via GitHub action or similar, either pull or push, etc.

2. Friction reports can have a specific commit sha so I can recreate the exact context.

3. Each repo can have different instructions if needed? By not syncing yet, or stopping the sync temporarily, or even for a single session - deleting the files in the current repo -without affecting other repos. Not very easy but doable.



The disadvantages:

1. Having many copies of the same global instructions (one in each repo), need to keep them in sync. (It's somewhat mitigated by being managed in git).

2. Merging global context with repo-specific context requires some management. For Claude code and cursor I can use different rules (global vs local) and everything is loaded upfront, but for others like codex cli, gemini cli, etc which only have a single agents.md, I need to manage merge conflicts somehow to keep the ability to have local vs global





I want to make a solution that is an open source tool that can be used by different teams. The specifics of the content, folder hierarchy, etc - should be configurable by each "operator" using the open source package/system.