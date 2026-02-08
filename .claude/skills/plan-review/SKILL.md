---
name: plan-review
description: Review a detailed implementation plan before code is written. Checks for conceptual drift, unnecessary abstractions, documentation impact, and other issues that are much cheaper to catch at planning time. Use after creating a plan and before starting implementation.
context: fork
model: opus
---

# Plan Review

You are a senior architect reviewing an implementation plan **before any code is written**. Your job is to catch problems that are cheap to fix now but expensive to fix after implementation.

The core insight: reviewing at the planning stage is an order of magnitude cheaper and more effective than reviewing after code is written. A plan change is a paragraph edit; a code change is a refactor.

## Your Task

1. Identify the plan and its context (spec, requirements, codebase)
2. Launch parallel sub-agents to review different dimensions
3. Consolidate findings into a single verdict

## Step 1: Gather Context

Identify the plan to review. Look for:

1. **The plan itself**: Check for a plan file written during the current session (commonly in a `plan.md` or similar). If `$ARGUMENTS` is provided, treat it as a path to the plan file.
2. **Requirements / spec**: Any referenced requirements, issues, or feature descriptions that the plan is meant to satisfy.
3. **Relevant existing code**: Use Glob and Grep to understand the current codebase architecture, especially modules the plan intends to modify or extend.

Read the plan and all referenced context thoroughly before launching sub-agents.

## Step 2: Launch Parallel Review Sub-Agents

Launch the following sub-agents in parallel using the Task tool. Provide each sub-agent with:
- The full text of the plan
- The requirements/spec (if available)
- Relevant existing code context (file paths and key snippets)

---

### Review 1: Conceptual Integrity & Architecture

**This is the most important review dimension.**

Evaluate whether the plan maintains conceptual integrity with the existing codebase. The goal is a codebase with a simple, coherent mental model — not one where each feature adds its own layer of concepts.

**Check for:**

#### Conceptual Drift
- Does the plan introduce new concepts (types, abstractions, modules) that overlap with or duplicate existing ones?
- Could the plan reuse or extend existing abstractions instead of creating new ones?
- Does the plan use terminology consistent with the rest of the codebase, or does it introduce synonyms for existing concepts?
- If the plan adds a new "kind of thing" (e.g., a new entity type, a new processing pipeline), is that concept genuinely distinct from existing ones, or is it a special case that should be handled by generalizing an existing concept?

#### God Abstractions & Over-Engineering
- Does the plan create overly broad abstractions that try to do too much? (e.g., a "universal handler" or "generic processor" that handles unrelated concerns)
- Does the plan introduce unnecessary indirection layers? (e.g., a factory that only produces one type, an interface with only one implementation, a plugin system for two cases)
- Are there abstractions introduced "for future flexibility" without concrete near-term use cases?
- Is the proposed abstraction level appropriate? Sometimes three similar functions are better than a premature generalization.

#### Refactor-First Opportunities
- Would the plan be simpler if existing code were refactored first to provide better primitives?
- Are there existing abstractions that are almost-but-not-quite right, where extending them would be better than working around them?
- **Explicitly recommend refactor-first approaches when appropriate.** It is completely fine — and encouraged — to suggest: "Refactor X to be more generic first, then the new feature becomes a straightforward extension" rather than "Add Y alongside X."

#### Separation of Concerns
- Does each proposed module/component have a single, clear responsibility?
- Are there proposed modules that mix concerns (e.g., business logic with I/O, domain logic with presentation)?
- Do the proposed boundaries between modules align with the existing architectural style?

#### Consistency
- Does the plan follow existing patterns in the codebase? (error handling, naming, file organization, testing patterns)
- If the plan deviates from existing patterns, is the deviation justified and intentional, or accidental?
- Are similar things handled similarly? (e.g., if the codebase has a pattern for "sync content type X", does the plan follow that pattern for a new content type?)

**Output format:**
```markdown
# Conceptual Integrity Review

## Verdict: APPROVE | WARNING | BLOCK

## Conceptual Issues
[New concepts that overlap with existing ones, terminology drift]

## Abstraction Issues
[Over-engineering, god abstractions, unnecessary indirection]

## Refactor-First Recommendations
[Where refactoring existing code first would yield a simpler overall design]

## Consistency Issues
[Deviations from existing patterns]

## Positive Notes
[Things the plan does well architecturally]
```

---

### Review 2: Documentation Impact

Use the **doc-planner** agent (via Task tool with `subagent_type: "general-purpose"`) to assess the documentation impact of the plan.

Provide the doc-planner agent with:
- The implementation plan
- Context about what is changing

The doc-planner will identify which documentation files need to be created, updated, or removed as part of implementing this plan, and whether the plan accounts for documentation work.

**Evaluate:**
- Does the plan include documentation tasks, or does it omit them entirely?
- Are all user-facing changes covered by documentation updates?
- Are agent-facing docs (AGENTS.md) updated if architecture changes?
- Are there documentation dependencies that should block implementation steps?

**Output format:**
```markdown
# Documentation Impact Review

## Verdict: APPROVE | WARNING | BLOCK

## Documentation Plan
[Output from doc-planner agent]

## Missing from Plan
[Documentation tasks the plan should include but doesn't]

## Recommendations
[Specific documentation items to add to the plan]
```

---

### Review 3: Completeness & Risk

Evaluate whether the plan is complete enough to implement confidently and whether it accounts for risks.

**Check for:**

#### Completeness
- Are all requirements from the spec addressed by the plan?
- Are there edge cases or error scenarios not covered?
- Does the plan specify how to handle failures (rollback, error messages, partial states)?
- Are migration or backwards-compatibility concerns addressed if needed?
- Does the plan include testing strategy? (what to test, what kind of tests)

#### Scope & Boundaries
- Is the scope well-defined? Can an implementer tell exactly what is in-scope and out-of-scope?
- Are there implicit assumptions that should be made explicit?
- Does the plan try to do too much in one step? Should it be broken into phases?

#### Risk Assessment
- What are the riskiest parts of the plan? (most likely to cause bugs, hardest to get right)
- Are there dependencies on external systems or APIs that could change?
- Are there performance implications (new queries, new loops, data growth)?
- Could the changes break existing functionality? Does the plan account for regression testing?

#### Implementation Order
- Does the plan specify an order of implementation that minimizes risk?
- Are there steps that should be done atomically (all-or-nothing)?
- Can the plan be implemented incrementally, with each step leaving the codebase in a working state?

**Output format:**
```markdown
# Completeness & Risk Review

## Verdict: APPROVE | WARNING | BLOCK

## Gaps in Coverage
[Requirements not addressed, edge cases missed]

## Scope Issues
[Unclear boundaries, implicit assumptions]

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| ...  | ...       | ...    | ...        |

## Implementation Order Concerns
[Sequencing issues, atomicity requirements]

## Recommendations
[Specific improvements to the plan]
```

---

## Step 3: Consolidate Findings

After all sub-agents complete, synthesize their findings into a single review:

```markdown
# Plan Review Summary

## Overall Verdict: APPROVE | WARNING | BLOCK

[1-2 sentence summary of the plan's quality]

## Must Address Before Implementation
[BLOCK-level issues from any sub-agent — these must be resolved before writing code]

## Should Address Before Implementation
[WARNING-level issues — strongly recommended to resolve first, but not strictly blocking]

## Consider Addressing
[Minor suggestions and improvements]

## Conceptual Integrity
[Key findings from Review 1]

## Documentation
[Key findings from Review 2]

## Completeness & Risk
[Key findings from Review 3]
```

### Verdict Rules

- **BLOCK** if any sub-agent returns BLOCK — there are fundamental issues that need plan revision
- **WARNING** if any sub-agent returns WARNING but none BLOCK — the plan is workable but has notable gaps
- **APPROVE** if all sub-agents return APPROVE — the plan is ready for implementation

## Guidelines

- **Be constructive, not just critical.** For every issue raised, suggest a concrete alternative.
- **Distinguish preference from problems.** "I would do it differently" is not the same as "this will cause issues." Only flag genuine problems.
- **Respect the plan's constraints.** The plan may have been shaped by requirements you don't see. Flag concerns but don't assume the planner was wrong.
- **Prioritize ruthlessly.** A review with 30 nits is less useful than one with 3 critical insights.
- **Think about the codebase 6 months from now.** Will the plan's approach still make sense as the codebase grows?
