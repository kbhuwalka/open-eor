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
5. **Spawn a reviewer** (point at this PR + `.cursor/skills/review-pr`). The EM does not review and does not merge.
6. On **CHANGES_REQUESTED** (that word on the first line of the reviewer comment): address findings (below), push, spawn a fresh reviewer.
7. On **APPROVED** (that word on the first line of the reviewer comment): you are the owning engineer. Run `bash scripts/submit-pr.sh --pr <n>` and stay until it squash-merges the PR or CI fails. Do not stop at "ready for EM" or "ready to merge." Do not hand the merge to the EM.

The verdict is that comment. It is not a GitHub pull-request review. `GH_TOKEN` is the PR author and cannot self-approve, so a missing GitHub Approve review is expected. `submit-pr.sh` waits for Lint, Unit Tests, Production Build, and End-to-End Tests, then squash-merges. It does not require a GitHub review approval.

## Plan (non-mechanical only)

Skip for typo/path/format-only edits. Otherwise note: context found, approach, risks, verification. Carry into the PR body.

## Implement

Satisfy AC. Behavior change → failing behavior test first. Colocate unit tests in `__tests__/`. Scope cleanup only when it unblocks a clean fix.

## Address feedback

Treat each finding as a **failure class**: root cause, sibling paths in scope, smallest fix that eliminates the class, proof that would have caught it. Then verify, push, fresh reviewer.
