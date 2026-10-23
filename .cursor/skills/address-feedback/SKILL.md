---
name: address-feedback
description: Use when acting on pull request review feedback, requested changes, or blocking findings. Treat findings as symptoms, identify the failure class, inspect sibling paths, plan the scoped fix, update proof, and prepare the PR for fresh review.
---

# Address Feedback

Review feedback is evidence of a failure class, not a line-edit checklist.
Before changing code, understand why the finding exists and what would prevent
the same bug shape from surviving elsewhere in the PR's scope.

For background workers, use `silent-mode` for human-facing chat.

## Required Context

Before editing, read:

- The linked issue and acceptance criteria.
- The PR body (approach, contract/risk matrix, risks, tests, verification).
- The latest reviewer verdict and every blocking finding.
- Relevant implementation plan notes.
- `standards/engineering.md` and `standards/testing.md`.
- Changed files in full context, not only the cited diff lines.
- Existing tests around the touched behavior.

## Feedback Analysis

For each finding, answer before editing:

1. What user-visible behavior, module contract, architecture rule, type
   invariant, or concurrency rule is actually broken?
2. Why did the current implementation allow that break?
3. Where else can the same failure class exist in the touched flow?
4. Is the plan or contract/risk matrix missing a row that would have caught this?
5. What fix shape eliminates the class within this PR's scope?

Do not proceed if the finding is only restated as "change file X line Y."

## Fix Shape

Choose the smallest scoped fix that eliminates the failure class:

- Local correction, when tracing proves isolation.
- Behavior extraction, when duplicated or hook-local logic caused inconsistency.
- Type or contract change, when invalid states are representable.
- Boundary validation change, when bad external input enters trusted code.
- Test strategy change, when existing tests passed while the bug existed.
- PR approach change, when the plan was wrong or incomplete.

If the correct fix would exceed issue scope, fix what is required for
correctness, document residual risk, and leave genuine out-of-scope work as
follow-up.

## Proof

- Add or update behavior tests for the original finding and sibling cases.
- Prefer public module contract or user-facing behavior.
- Document manual verification only when automation is not practical.

## Execution Loop

1. Re-read required context.
2. Analyze every finding as a symptom; identify the failure class.
3. Trace sibling paths before editing.
4. Pick the scoped fix shape.
5. Update the plan or PR body if approach/matrix/risks/tests changed.
6. Implement the fix for the whole failure class within scope.
7. Add or update proof.
8. Run focused verification, then full local verify when appropriate:
   `pnpm lint && pnpm test && pnpm build` (and `pnpm test:e2e` when UI flows
   changed).
9. Push and dispatch a fresh reviewer.

## Stop Conditions

Stop and ask for help only when:

- The required fix conflicts with issue scope or a product decision.
- Review feedback contradicts project standards or the linked issue.
- The same failure class appears outside PR scope and cannot be separated.
- Verification is blocked by environment/infrastructure after isolation.
