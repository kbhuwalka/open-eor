---
name: implement-issue
description: Engineer owns a GitHub Issue end-to-end — plan, implement, PR, spawn reviewer, address feedback, submit-pr merge.
---

# Implement Issue

Own the Issue until merge (or blocked). App is at **repo root**; **pnpm**; base **`main`**. Standards: `standards/engineering.md`, `standards/testing.md`.

## Flow

1. **Gate:** `bash scripts/issue.sh <n> --verify-unblocked`
2. **Worktree:** `bash scripts/worktree.sh create cursor/issue-<n>-short-title` (base `main`)
3. **Plan** when non-mechanical (see below) — inline here, not another skill
4. **Implement** + local verify: `pnpm lint && pnpm test && pnpm build` (e2e optional locally; CI is the merge gate)
5. **Open PR** to `main` with `Closes #<n>`; fill the PR template
6. **Spawn a reviewer worker** yourself (EM need not). Point them at this exact worktree/branch and `.cursor/skills/review-pr`
7. On **CHANGES_REQUESTED:** address findings (see below), push, spawn a fresh reviewer
8. On **APPROVED:** `bash scripts/submit-pr.sh --pr <n>` (waits required checks, then squash-merges)

Ensure `PATH` includes `~/.local/bin` for `gh` on this Mac.

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
5. Re-run local verify; push; spawn a **fresh** reviewer

## Done when

PR merged via `submit-pr.sh`, worktree cleaned (`worktree.sh cleanup …`), reviewer workers closed.
