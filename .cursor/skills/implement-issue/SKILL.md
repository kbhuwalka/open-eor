---
name: implement-issue
description: Engineer owns a GitHub Issue end-to-end — plan, implement, PR, spawn reviewer, address feedback, submit-pr merge.
---

# Implement Issue

Own the Issue until merge (or blocked). App at **repo root**; **pnpm**. Standards: `standards/engineering.md`, `standards/testing.md`.

Cursor already checked out a working branch from `main` — stay on it. PR base is `main`.

## Flow

1. **Gate:** `bash scripts/issue.sh <n> --verify-unblocked`
2. **Plan** if non-mechanical (below)
3. **Implement** + `pnpm lint && pnpm test && pnpm build` (e2e optional; CI is merge gate)
4. **Push + open PR** to `main` with `Closes #<n>`; fill the PR template
5. **Spawn a reviewer** (point at this PR + `.cursor/skills/review-pr`). EM need not. The reviewer records `APPROVED` or `CHANGES_REQUESTED` as a PR comment via `submit-review.sh`. That comment is the verdict. It is not a GitHub Approve or Request changes review.
6. On **CHANGES_REQUESTED:** address findings (below), push, spawn a fresh reviewer
7. On **APPROVED:** `bash scripts/submit-pr.sh --pr <n>`

## Plan (non-mechanical only)

Skip for typo/path/format-only edits. Otherwise note: context found, approach, risks, verification. Carry into the PR body.

## Implement

Satisfy AC. Behavior change → failing behavior test first. Colocate unit tests in `__tests__/`. Scope cleanup only when it unblocks a clean fix.

## Address feedback

Treat each finding as a **failure class**: root cause, sibling paths in scope, smallest fix that eliminates the class, proof that would have caught it. Then verify, push, fresh reviewer.
