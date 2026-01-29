I work at an organization named Acme.com.
Acme.com company has several software developers and many code repositories, microservices, etc in different programming languages.
I am responsible for introducing and managing AI coding agents at the company. Some agents will run in the cloud, others in developers' computers. 
I need to ensure that the experience for developers is smooth, and that the agents behave in a standardize way across the company.

What I currently have:
I have a repo called acme-agents. 
In this repo, I have a collection of all the "global instructions" for coding agents in the company: internal company context, company policies, engineering guidelines, core agent behaviors, curated skills, best practices per programming languages, security standards, etc.
Currently, this is a bunch of claude code modular rules (claude/rules/), and a bunch of skills.
I also have some claude code configurations, like: global allow / deny commands, mcp servers, etc.

Then, I have my many repositories with the code for my applications, business logics, infrastructure, etc.
These repositories also have their own important context, with CLAUDE.md files and/or modular rules, specific skills, etc.

What I do today:
* I have quick script to copy the files from acme-agents to the users' global claude config ~/.claude (because I don't want to override the repo-specific instructions)
* I have to sync it manually whenever I make changes.
* There is no way to track what is currently installed in my machine, prevent accidental changes to the global state, etc.
* I shared the repository with the team, but there is no good way to make sure their state is updated, they need to remember to pull the repo and run the script often.
* While almost all of the time the global context/instructions/condigs must be used, there are occasions in which I want to start a project without them, or with a subset. For example, I want comprehensive tests for all code, but sometimes doing a quick prototype and I don't want tests yet.
* The script only does basic things, but many of the configs remain manual on each developer's machine. For example, configuring claude code, mcp servers, environment variables, secrets, etc. I have no way to validate everything was set up correctly, not at first use, and not when the requirements in acme-agents change (like, if I need a new env var now).
* We also experiment with using Codex CLI. My script can do basic things like copy the skills to the ~/.codex dir, and concatenate my rules into an AGENTS.md file. This works ok for simple things, but I find there are many differences between the tools, different concepts, supported features, etc. Each tool has different ways to achieve the same objective.
* I manually copy-paste instructions, skills, agent definitions, mpc configs, tool configs, usage patterns, etc that I find online in marketplaces, repositories, etc - and add them to my acme-agents repo. I loose track of where I took them from, I don't have a way to check for updates and review them when they happen.
* There are many manual extra things developers have to do, like configuring environment variables


I want to be able to:
1. Manage the company-wide coding agent instructions and configurations in one place.
2. Allow for repo-specific configurations alongside company-wide configurations.
3. Have things be deterministic, pinned to a specific version, and git tracked so I can see the state, review changes, approve them, etc.
4. Have updates to the global instructions propagate to the downstream repositories using them, optionally directly merge to master, or requiring review / manual approval.
5. Have way to prevent manual changes to the global instructions (will be overriden).
6. Have full support for other coding agents such as Codex, Goose, etc. Be able to quickly switch to those, and set up policies for whether I want to fail if some feature is not supported in some tool. For example, if I have a custom agent to do a security review before pushing code, but some tool does not support hooks or doesn't support running sub-agents, I may decide that I don't want to allow that tool, at least for "production" repos.
