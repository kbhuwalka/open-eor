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
6. **On every wake** (PR notification, CI notification, or stuck timer): re-read the PR, then apply the **Wake decision table** once. Do not invent a second procedure.

Review is owned by the Cursor Automation on this repo (GitHub login often `cursor`). It posts findings and a **formal GitHub review** (approve / request changes). It re-runs on push. Prefer review state on the **current head SHA** over top-level comments or `reviewDecision` (often null here).

**CI green alone is not “review passed.”** `submit-pr.sh` still watches Quality Gates before merge; run it only after an approving review **on the current head**.

`review-pr` and `scripts/submit-review.sh` remain for manual one-offs only — not the happy path.

## Subscribe after each push (then end turn)

**Push is the clock anchor.** Arm subscriptions and the stuck timer only after a push of the PR head that awaits review/CI. Do **not** start or restart the 15‑minute stuck clock from PR open alone, a review comment, or a CI event.

1. **`subscribe_github_pr`** — scope `pr`, that PR’s URL (or `repo` + `pullNumber`). Reuse if already active.
2. **`subscribe_github_ci`** — on the PR **head branch** (`repo` + `branch`). Used to wake on CI failure so you can fix/push. Do **not** wait on this subscription after an approve; `submit-pr.sh` watches CI itself.
3. **Stuck alert timer (15 minutes, once, push-anchored)** — name `stuck-alert-pr-<n>`:
   1. `list_subscriptions`
   2. `unsubscribe` any existing timer for this PR by its **`subscriptionId`** (name alone is not enough; `subscribe_timer` dedupes by name and will not reset delay)
   3. `subscribe_timer` with that name, `delaySeconds: 900`, `once: true`. Prompt: “Apply the implement-issue Wake decision table for PR \<n\> (timer wake).”
4. State what you are waiting for, then **end the turn**.

Slack unavailable must **not** block the PR — use the agent-turn / EM message fallback when notifying Kunal.

### Wake decision table (mutually exclusive)

Re-read first:

```bash
HEAD=$(gh pr view <n> --json headRefOid --jq .headRefOid)
gh pr view <n> --json reviews,state,mergedAt \
  --jq --arg head "$HEAD" '{
    state,
    head: $head,
    latestOnHead: [
      .reviews[]
      | select(.state == "APPROVED" or .state == "CHANGES_REQUESTED")
      | select(.commit.oid == $head)
      | {state, author: .author.login, submittedAt, commit: .commit.oid}
    ] | sort_by(.submittedAt) | last
  }'
# CI: gh pr checks <n> / Actions for this head — terminal failure vs pending vs success
```

Same approve rule as `scripts/lib/approving-review.mjs` / `submit-pr.sh`: latest decisive review **on this head** must be `APPROVED`.

| Situation | Action |
| --- | --- |
| PR merged or closed | Stop. Unsubscribe stuck timer if still listed. |
| Latest on **current head** is `CHANGES_REQUESTED` (or clear new IMPORTANT/CRITICAL to act on) | Fix, **push**, reset stuck timer (list → unsubscribe by id → subscribe 900s once), renew PR/CI subs if needed, end turn. |
| Latest on **current head** is `APPROVED` | Unsubscribe stuck timer. **In this same turn** run `bash scripts/submit-pr.sh --pr <n>` and stay until squash-merge or CI failure. Do **not** end the turn to wait on `subscribe_github_ci` (its success may already have been delivered). Never squash-merge outside `submit-pr.sh`. |
| CI **failed** on current head | Fix, **push**, reset stuck timer, end turn. Do **not** ping Kunal for a CI failure you can fix. |
| Still waiting (no approve and no request-changes on head; CI pending or green) | **PR/CI wake:** keep waiting; do **not** restart the stuck timer. **Timer wake:** notify Kunal **once** (Slack send if available; else clear agent/EM message). Do not merge; do not spawn a reviewer; do not re-arm the timer until the next **push**. |

### Fallback (only if subscription tools are missing)

Poll `gh pr view` ~every 30s; after **15 minutes** from the latest push apply the timer-wake row of the table. Prefer subscriptions whenever available.

## Plan (non-mechanical only)

Skip for typo/path/format-only edits. Otherwise note: context found, approach, risks, verification. Carry into the PR body.

## Implement

Satisfy AC. Behavior change → failing behavior test first. Colocate unit tests in `__tests__/`. Scope cleanup only when it unblocks a clean fix.

## Address feedback

Treat each finding as a **failure class**: root cause, sibling paths in scope, smallest fix that eliminates the class, proof that would have caught it. Then verify, **push** (restarts the 15m stuck clock), renew PR + CI subscriptions, end turn.
