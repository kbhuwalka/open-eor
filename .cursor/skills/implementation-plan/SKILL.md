---
name: implementation-plan
description: Use before non-mechanical code changes when the implementation approach, scope, risks, and verification goals must be planned. Do not use for feature definition, PR review, or status reporting.
---

# Implementation Plan

Use this skill only for planning code implementation work before edits begin.
Do not use it for general repository analysis, EM orchestration, PR review,
status updates, or non-code planning.

Planning is discovery-driven design. Bias hard toward simplicity. Do not add
abstractions, options, generalized helpers, or future-proofing for hypothetical
scenarios.

## Discover First

Before choosing an approach:

- Read the user request or GitHub issue.
- Search the codebase for similar behavior, names, types, hooks, components,
  tests, and scripts.
- Read the relevant existing implementation and tests in context.
- Identify the domain owner and public API boundaries before proposing moves or
  new exports.
- Read relevant standards after you know what kind of code is touched:
  `standards/engineering.md`, `standards/testing.md`.

The plan should be based on observed codebase facts, not assumptions.

## Simplest Viable Approach

- Reuse existing types, utilities, hooks, components, and test patterns.
- Prefer extending the local pattern over introducing a parallel one.
- Avoid new abstractions unless the current change has real duplication or
  ownership complexity.
- Keep the edit set narrow. Leave nearby issues for follow-up when not needed.

If two approaches both work, choose fewer moving parts, fewer public API
changes, and clearer tests.

## Architecture Self-Review

For changes that touch application boundaries:

```md
architecture_self_review:
- owner module/submodule:
- relevant architecture docs:
- boundary introduced or consumed:
- old path/state/import made unreachable:
```

If the old path cannot be removed in the same change, name the follow-up owner
and prove the old path is not a parallel production authority.

## Verifiable Goals

Define goals reviewers can verify:

- Observable behavior that must change or remain unchanged.
- Error paths, edge cases, and boundary conditions.
- Public contracts, types, or APIs preserved or intentionally changed.
- Verification evidence (focused tests, manual checks, local commands). Do not
  design the test implementation here — `implement-issue` owns test-first.
- Concurrency impact when overlapping operations or shared resources are
  touched; otherwise explicitly record `None`.

## Contract And Risk Matrix

For non-mechanical changes, include a compact issue-specific matrix:

Use rows for touched behavior involving:

- lifecycle or state-machine transitions
- persistence, retries, recovery, or stale/deleted state
- SDK, runtime, database, browser, or provider boundaries
- exported domain types, branded identifiers, or typed errors
- cross-module ownership, public barrels, or import boundaries

Shape:

```md
| Contract | Illegal/failure case | Enforcement | Required proof |
|---|---|---|---|
| ... | ... | type, guard, owner boundary, or runtime check | failing test, type test, existing coverage, or manual verification |
```

## Plan Shape

- `observed_context`
- `approach`
- `architecture_self_review` (when boundaries are touched)
- `contract_and_risk_matrix`
- `verifiable_goals`
- `risks`
- `concurrency_impact` (or `None`)

## Output

Use the plan in private notes, an issue comment when useful, or the PR body.
For implementation PRs, carry the final plan into the PR template sections.
