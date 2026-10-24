---
name: implement-issue
description: Engineer owns a GitHub Issue end-to-end — plan, implement, PR, subscribe for Automation review, address feedback, submit-pr merge.
---

# Implement Issue

Own the Issue until merge (or blocked). App at **repo root**; **pnpm**. Standards: `standards/engineering.md`, `standards/testing.md`.

Cursor already checked out a working branch from `main` — stay on it. PR base is `main`.

## Flow

1. **Gate:** `bash scripts/issue.sh <n> --verify-unblocked`
2. **Plan** if non-mechanical (below)
3. **Implement** + `pnpm lint && pnpm test && pnpm build` (e2e optional; CI is merge gate)
4. **Push + open PR** to `main` with `Closes #<n>`; fill the PR template
5. **Subscribe for Automation review** (below), then **end the turn**. Do **not** spawn a `review-pr` worker. Do **not** busy-wait / sleep-poll. The EM does not review and does not merge.
6. **On wake** from a PR notification: re-read the PR (reviews + comments) as source of truth.
   - Formal **approve** → run `bash scripts/submit-pr.sh --pr <n>` (optionally after / with a CI subscription; see below) and stay until squash-merge or CI failure.
   - **Request changes** or new blocking IMPORTANT/CRITICAL findings → fix, push, **keep/renew** the PR subscription (+ 10-minute timer), end the turn again.
7. **On wake** from the 10-minute timer: if still waiting on Automation approve with no request-changes → stop and report timeout. Do not merge; do not spawn a reviewer. Unsubscribe when done.

Review is owned by the Cursor Automation on this repo (`cursor[bot]`). It posts findings and a **formal GitHub review** (approve / request changes). It re-runs on push. It does **not** use a first-line comment verdict (`APPROVED` / `CHANGES_REQUESTED`). Prefer GitHub review state over top-level comments.

**CI green alone is not “review passed.”** The Automation owns review. `submit-pr.sh` still waits on Quality Gates before merge; run it only after an approving review.

`review-pr` and `scripts/submit-review.sh` remain for manual one-offs only — not the happy path.

## Watch Automation review (subscribe, then end turn)

After opening the PR, and after each push that awaits review:

1. **Subscribe to the PR** with `cursor-subscriptions` → `subscribe_github_pr`, scope `pr`, that PR’s URL (or `repo` + `pullNumber`).
2. **Optionally** subscribe CI with `subscribe_github_ci` on the PR **head branch** (for merge later — `submit-pr.sh` can also watch CI itself).
3. **Arm a one-shot 10-minute bound** with `subscribe_timer`: `delaySeconds: 600`, `once: true`, name unique per PR (e.g. `automation-review-timeout-pr-<n>`). Prompt must say: if still waiting on Automation approve with no request-changes, stop and report timeout; do not merge; do not spawn a reviewer; unsubscribe when done.
4. State what you are waiting for, then **end the turn**. Do not sleep-loop or poll `gh` in a tight loop.

### On PR notification wake

Re-read as source of truth (do not trust the notification text alone):

```bash
gh pr view <n> --json reviews,reviewDecision,comments \
  --jq '{
    reviewDecision,
    latest: [
      .reviews[]
      | select(.state == "APPROVED" or .state == "CHANGES_REQUESTED")
      | {state, author: .author.login, submittedAt, body: (.body // "")[0:300]}
    ] | sort_by(.submittedAt) | last,
    comments: [.comments[] | {author: .author.login, body: .body[0:200]}]
  }'
```

- **Approved** → unsubscribe the timeout timer (and PR sub if still open), run `submit-pr.sh` (or wait on a CI subscription first, then merge via the script / same path).
- **CHANGES_REQUESTED** / blocking findings → fix, push, renew PR subscription + fresh 10-minute timer, end turn.
- **Neither yet** (e.g. comment-only noise) → keep waiting; leave subscriptions active; end turn again if you have nothing to do.

### On timer wake (10 minutes)

If still no approve and no request-changes → report that the Automation did not finish in time, **stop**, unsubscribe, leave the PR open. Do not spawn a reviewer; do not merge.

### Fallback (only if subscription tools are missing)

If `cursor-subscriptions` / `subscribe_github_pr` / `subscribe_timer` are not in the tool catalog, fall back to polling `gh pr view` about every **30s** for up to 10 minutes. Prefer subscriptions whenever available.

## Plan (non-mechanical only)

Skip for typo/path/format-only edits. Otherwise note: context found, approach, risks, verification. Carry into the PR body.

## Implement

Satisfy AC. Behavior change → failing behavior test first. Colocate unit tests in `__tests__/`. Scope cleanup only when it unblocks a clean fix.

## Address feedback

Treat each finding as a **failure class**: root cause, sibling paths in scope, smallest fix that eliminates the class, proof that would have caught it. Then verify, push, renew Automation watch (subscribe + timer), end turn.
