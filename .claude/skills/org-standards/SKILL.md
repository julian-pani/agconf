---
name: org-standards                                                                                                                                                                             
description: Helps agents discover, understand, and enforce company-wide engineering standards. Use when checking if organizational standards apply to a task, reporting violations, or handling exception requests.                                                                                                                                                                     
metadata:
---
# Organizational Standards Meta-Skill

## Description
This skill helps agents discover, understand, and enforce company-wide engineering standards. It provides guidance on standards precedence, enforcement policies, and compliance checking.

## When to Use This Skill
- When checking if organizational standards apply to a task
- When reporting potential standards violations
- When an engineer requests an exception to a standard
- When you need to understand the precedence between different standards

## How Standards Work

### Standards Discovery
1. Check `AGENTS.md` in the repository root for the list of all active standards
2. Each standard is implemented as a skill in the `skills/` directory
3. Standards apply automatically based on triggers defined in `AGENTS.md`

### Standards Precedence
When multiple standards could apply:
1. **Explicit user requirements** override standards (if exception is approved)
2. **Security standards** take precedence over convenience
3. **Company-wide standards** take precedence over team preferences
4. **Newer standards** apply to new code; existing code migrates gradually

### Enforcement Levels
Standards have different enforcement levels:
- **REQUIRED**: Must be followed in all new code
- **RECOMMENDED**: Should be followed unless there's a good reason
- **DEPRECATED**: Being phased out; migrate when refactoring

## Compliance Checking

When reviewing code or implementing features, agents should:

1. **Check applicability**: Does this code fall under any standards in `AGENTS.md`?
2. **Verify compliance**: Does the implementation follow the standard's requirements?
3. **Flag violations**: Report any non-compliance clearly
4. **Offer fixes**: Suggest how to bring code into compliance

## Violation Reporting Format

When detecting a standards violation, report it like this:

```
⚠️  STANDARDS VIOLATION DETECTED

Standard: [standard-name]
Location: [file:line]
Issue: [clear description of the violation]
Required: [what the standard requires]
Current: [what the code currently does]

Fix: [how to resolve this]
Exception Process: [how to request an exception if needed]
```

## Exception Process

When an engineer needs to deviate from a standard:

1. **Document the reason**: Why is the standard not applicable?
2. **Propose alternative**: What will be done instead?
3. **Get approval**: Follow the approval process in `AGENTS.md`
4. **Document in code**: Add comments explaining the exception

## Adding New Standards

When creating a new organizational standard:

1. **Create the skill**: Add directory under `skills/`
2. **Write SKILL.md**: Document implementation requirements
3. **Add to AGENTS.md**: Define when it applies
4. **Provide examples**: Include reference implementations
5. **Create migration tools**: Help existing code adopt the standard
6. **Announce**: Communicate to engineering team

## Standards Evolution

Standards should evolve based on:
- **Feedback from engineers**: What's working? What's not?
- **Technology changes**: New tools and best practices
- **Incident learnings**: What would prevent future issues?
- **Industry best practices**: What are others doing?

Review standards quarterly and update as needed.

## Example Agent Workflow

**Example 1: Creating a new service**
```
Engineer: "Create a new Python API service for user management"

Agent internal reasoning:
1. Check AGENTS.md → Python service detected
2. Find applicable standards → python-structlog-datadog required
3. Invoke python-structlog-datadog skill
4. Implement service following the standard
5. Verify compliance before completing task

Result: Service follows logging standard automatically
```

**Example 2: Creating a Git commit**
```
Engineer: "Commit these changes"

Agent internal reasoning:
1. Check AGENTS.md → Git commit detected
2. Find applicable standards → conventional-commits recommended
3. Review changes to determine commit type and scope
4. Generate commit message following Conventional Commits format
5. Present commit message for approval

Result: Commit message follows conventional-commits standard
```

## Key Principles

1. **Standards serve engineers**: They should make work easier, not harder
2. **Automate enforcement**: Agents apply standards automatically
3. **Clear exceptions**: Process is straightforward and well-documented
4. **Living documentation**: Standards evolve with the organization
5. **Consistency over perfection**: Better to have everyone aligned than everyone perfect

## Resources

- Repository standards list: `AGENTS.md`
- Engineer reference: `docs/ENGINEER_QUICK_REFERENCE.md`
- Setup guide: `docs/SETUP_GUIDE.md`
- Repository structure: `README.md`

---

**Remember**: Standards exist to help the team ship better software faster. Enforce them consistently but with understanding of context.
