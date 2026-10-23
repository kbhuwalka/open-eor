---
name: implement-issue
description: Use to execute an assigned GitHub issue after planning is complete. Covers code edits, tests, verification, PR creation, reviewer dispatch, submit, merge recovery, and cleanup.
---

# Implement Issue

End-to-end implementation workflow for a **spacexai-demo** GitHub issue. Issues
and PRs are the source of truth. App code lives at the **repo root** (not under
`app/`). Package manager is **pnpm@10.33.4**; Node **24**. Base branch is
**`main`**.

## Goal Ownership

Own the full lifecycle until the issue is implemented, verified, reviewed,
approved, submitted, merged, and cleaned up — or genuinely blocked.

The engineer owns the task loop, not just the first pass:

- Implement the issue and open the PR against `main`.
- Dispatch a fresh Cursor **reviewer** worker after the PR is ready.
- On `CHANGES_REQUESTED`, use `address-feedback`, fix, push, and dispatch a
  fresh reviewer again.
- On `APPROVED`, run `bash scripts/submit-pr.sh --pr <number>`.
- If submit or merge fails, resolve, push if needed, and rerun `submit-pr.sh`.
- After merge, clean up the worktree/branch and close helper/reviewer workers.

Do not hand routine review rounds, submit, or merge recovery back to the EM
(Project coordinator). Ask the EM only when blocked, when slot/queue state is
unclear, or when a decision exceeds the issue scope.

## Before You Start

```bash
bash scripts/issue.sh <issue-number> --verify-unblocked
```

Do not start while the issue has open blockers.

Use the issue as the starting point, not a narrow checklist. Trace relevant
flows; document meaningful discoveries and deviations in the PR body.

Prefer worktree + branch:

```bash
bash scripts/worktree.sh create cursor/issue-<n>-short-title main
```

## Planning Gate

**STOP. Before making a change, you must make a plan.**

Use `implementation-plan` when the change is non-mechanical and no adequate
plan already exists. A non-mechanical PR without a plan will be rejected.

Mechanical changes are limited to typo fixes, path/reference updates,
formatting-only changes, or a single-location edit with no behavior, API,
architecture, test, workflow, or user-facing impact.

Carry approach, contract/risk matrix, risks, alternatives, and verification
notes into the PR body.

## Implement

Satisfy acceptance criteria and leave touched code better than it was.

Required standards:

- `standards/engineering.md` (especially layered architecture)
- `standards/testing.md`

## Scoped Quality Improvement

Improve quality only where it supports the assigned change. Reuse existing
patterns. Keep the change small. Justify every scoped improvement under
`Refactoring` in the PR body. Do not chase unrelated cleanup.

## Test First

Every behavioral change must have a failing test first. Behavioral means the
code affects outputs, handles errors, or changes control flow.

**Tests must validate behavior, not implementation details.**

Iron law:

```text
NO BEHAVIORAL CHANGE WITHOUT A FAILING TEST FIRST
```

1. RED — write one clear behavior test; confirm it fails for the missing behavior.
2. GREEN — minimum implementation to pass.
3. REFACTOR — clean up only after green; do not add behavior.

Colocate unit/component tests in sibling `__tests__/` directories. E2E stays
under `e2e/`.

## Pre-PR Quality Check

Confirm DRY/YAGNI, readability, every **[Required]** section in
`standards/engineering.md`, and every contract/risk matrix row before opening
the PR.

## Verify Locally

From repo root:

```bash
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

If a command cannot run due to environment/infrastructure, document the
blocker and residual risk in the PR body. Do not skip verification because it
is slow.

## PR Record

Commit and push. Open a ready-for-review PR against **`main`** with
`Closes #<number>` and fill out `.github/PULL_REQUEST_TEMPLATE.md`. Do not
open as draft. Include approach, contract/risk matrix, risks, tests,
verification, refactoring, and deploy/preview link (or N/A).

Branch naming: `cursor/issue-<n>-short-title`.

## Respond To Review

On requested changes, use `address-feedback` before editing. Respond to each
blocking finding with the failure-class plan before code changes.

## Review And Submit Loop

Dispatch a fresh Cursor reviewer with PR number, linked issue, plan context,
and worktree/branch path. Instruct the reviewer to review that exact
worktree/branch — they must not create branches, switch branches, or clean up
worktrees. Wait for the structured verdict from `scripts/submit-review.sh`.

On `CHANGES_REQUESTED`: fix all findings, add regression proof, push, dispatch
a fresh reviewer.

On `APPROVED`:

```bash
bash scripts/submit-pr.sh --pr <number>
```

`submit-pr.sh` watches required Quality Gates checks and merges. Report
completion only after merge and cleanup succeed.
