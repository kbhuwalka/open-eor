---
name: implement-issue
description: Engineer owns a GitHub Issue end-to-end — plan, implement, PR, spawn reviewer, address feedback, submit-pr merge.
---

# Implement Issue

Own the Issue until merge (or blocked). App is at **repo root**; **pnpm**; base **`main`**. Standards: `standards/engineering.md`, `standards/testing.md`.

**Default placement: cloud agent** — use your own checkout. Branch off latest `main`. Do **not** run `worktree.sh` in the cloud.

## Flow

1. **Gate:** `bash scripts/issue.sh <n> --verify-unblocked`
2. **Branch:** fetch/update `main`, create `cursor/issue-<n>-short-title` from latest `main`, push to origin
3. **Plan** when non-mechanical (see below) — inline here, not another skill
4. **Implement** + verify: `pnpm lint && pnpm test && pnpm build` (e2e optional in agent env; CI is the merge gate)
5. **Open PR** to `main` with `Closes #<n>`; fill the PR template
6. **Spawn a reviewer worker** yourself (EM need not). Point them at this branch (and checkout path) and `.cursor/skills/review-pr`
7. On **CHANGES_REQUESTED:** address findings (see below), push, spawn a fresh reviewer
8. On **APPROVED:** `bash scripts/submit-pr.sh --pr <n>` (waits required checks, then squash-merges)

## Plan (non-mechanical only)

Mechanical = typo / path-only / formatting / single-location with no behavior impact. Otherwise, before editing, write a short plan:

- Observed context (files/patterns found)
- Approach (simplest change)
- Risks / edge cases
- How you’ll verify (tests + commands)

Carry the plan into the PR body. Prefer a small contract/risk table when touching state, APIs, or boundaries.

## Implement

- Satisfy acceptance criteria; leave touched code better than found
- Behavioral changes: failing behavior test first; tests assert behavior, not internals
- Colocate unit/component tests in `__tests__/`; e2e under `e2e/`
- Scope cleanup only when it unblocks a clean fix; justify under Refactoring

## Address feedback (same skill)

Treat each finding as a **failure class**, not a line patch:

1. What broke and why the design allowed it
2. Where else the same class can exist in this PR’s scope
3. Smallest fix that eliminates the class
4. Add/update proof that would have caught it
5. Re-run verify; push; spawn a **fresh** reviewer

## Done when

PR merged via `submit-pr.sh`, branch cleaned up as appropriate, reviewer workers closed.

## Local Mac optional

Only when running on Kunal’s self-hosted Mac (not cloud): you may isolate with
`bash scripts/worktree.sh create cursor/issue-<n>-short-title` and later
`worktree.sh cleanup …`. Ensure `PATH` includes `~/.local/bin` for `gh`. Cloud
engineers must not treat worktrees as required.
