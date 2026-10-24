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
5. **After each push that awaits review/CI:** subscribe (below), then **end the turn**. Do **not** spawn a `review-pr` worker. Do **not** busy-wait / sleep-poll. The EM does not review and does not merge.
6. **On wake** from a PR or CI notification: re-read the PR (reviews + comments) and CI as source of truth.
   - Formal **approve** (and CI path ready) → run `bash scripts/submit-pr.sh --pr <n>` and stay until squash-merge or CI failure. Unsubscribe the stuck timer when review is decided or the PR merges.
   - **Request changes** or new blocking IMPORTANT/CRITICAL findings → fix, **push**, renew subscriptions (including a **fresh** 15‑minute stuck timer — see below), end the turn again.
   - CI failure → fix, **push**, renew, end turn.
7. **On wake** from the 15‑minute stuck timer: re-check the PR. If still stuck (non-terminal CI **or** Automation review still neither approve nor request-changes to act on), **notify Kunal once** (Slack if a send tool/MCP is available; otherwise a clear message in the agent turn / to the EM). If already approved / CI green / merged, do nothing. Do not merge on the timer; do not spawn a reviewer.

Review is owned by the Cursor Automation on this repo (`cursor[bot]`). It posts findings and a **formal GitHub review** (approve / request changes). It re-runs on push. It does **not** use a first-line comment verdict (`APPROVED` / `CHANGES_REQUESTED`). Prefer GitHub review state over top-level comments.

**CI green alone is not “review passed.”** The Automation owns review. `submit-pr.sh` still waits on Quality Gates before merge; run it only after an approving review.

`review-pr` and `scripts/submit-review.sh` remain for manual one-offs only — not the happy path.

## Watch (subscribe, then end turn)

**Push is the clock anchor.** Arm subscriptions and the stuck timer only after a push of the PR head that awaits review/CI. Do **not** start or restart the 15‑minute stuck clock from PR open alone, a review comment, or a CI event.

After each such push:

1. **Subscribe to the PR** — `cursor-subscriptions` → `subscribe_github_pr`, scope `pr`, that PR’s URL (or `repo` + `pullNumber`). Reuse if already active.
2. **Subscribe to CI** — `subscribe_github_ci` on the PR **head branch** (`repo` + `branch`). Required alongside the PR sub when waiting on merge gates (not optional).
3. **Stuck alert timer (15 minutes, once, push-anchored):**
   - Name stable per PR, e.g. `stuck-alert-pr-<n>`.
   - Before arming: if a prior timer with that name (or any pending stuck timer for this PR) is still listed, **`unsubscribe` it** — then arm a fresh one. New push → new 15‑minute clock; do not leave an old push’s timer as the only clock.
   - `subscribe_timer`: `delaySeconds: 900`, `once: true`.
   - Prompt must say: re-check this PR; if still waiting on non-terminal CI **or** still waiting on Automation review (no formal approve and no request-changes to act on), notify Kunal once (prefer Slack send if available; else a clear agent/EM message). If already approved / CI green / merged, do nothing. Do not merge; do not spawn a reviewer.
4. State what you are waiting for, then **end the turn**. Do not sleep-loop or poll `gh` in a tight loop.

Slack being unavailable must **not** block the PR: use the agent-turn / EM message fallback and continue the subscribe loop.

### On PR / CI notification wake

Re-read as source of truth (do not trust the notification text alone):

```bash
gh pr view <n> --json reviews,reviewDecision,comments,statusCheckRollup,headRefName \
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

- **Approved** → unsubscribe the stuck timer; run `submit-pr.sh` (CI subscription and/or the script’s CI watch).
- **CHANGES_REQUESTED** / blocking findings → fix, push (that push restarts the 15m clock), renew PR + CI subscriptions, end turn.
- **CI failed** → fix, push, renew, end turn.
- **Neither review decision nor actionable CI failure yet** → keep waiting; leave PR/CI subscriptions active; **do not** restart the 15m timer (push is the only anchor); end turn if you have nothing to do.

### On stuck-timer wake (15 minutes after latest push)

1. Re-check PR review state and CI for the current head.
2. If **still stuck** (CI not green / still non-terminal, **or** Automation has not formally approved and there is no request-changes to act on) → notify Kunal **once** via Slack if a send tool exists; otherwise a clear message in this turn (and to the EM). Leave the PR open; keep or renew PR/CI subscriptions as needed; do not merge; do not spawn a reviewer.
3. If already approved / CI green / merged → do nothing (no Slack).
4. Do not arm another 15m stuck timer until the next **push**.

### Fallback (only if subscription tools are missing)

If `cursor-subscriptions` / `subscribe_github_pr` / `subscribe_github_ci` / `subscribe_timer` are not in the tool catalog, fall back to polling `gh pr view` about every **30s**, and after **15 minutes** from the latest push apply the same stuck notify (Slack or agent message). Prefer subscriptions whenever available.

## Plan (non-mechanical only)

Skip for typo/path/format-only edits. Otherwise note: context found, approach, risks, verification. Carry into the PR body.

## Implement

Satisfy AC. Behavior change → failing behavior test first. Colocate unit tests in `__tests__/`. Scope cleanup only when it unblocks a clean fix.

## Address feedback

Treat each finding as a **failure class**: root cause, sibling paths in scope, smallest fix that eliminates the class, proof that would have caught it. Then verify, push (restarts the 15m stuck clock), renew PR + CI subscriptions, end turn.
