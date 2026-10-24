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
6. **On every wake** (PR notification, CI notification, or stuck timer): re-read the PR, then apply the **Wake decision table** once (first match wins). Do not invent a second procedure.

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

### Wake decision table (first match wins)

Re-read with the same predicate as `submit-pr.sh` (do not hand-roll jq for approve):

```bash
pr=$(gh pr view <n> --json state,headRefOid,reviews)
HEAD=$(jq -r .headRefOid <<<"$pr")
jq -r .state <<<"$pr"
set +e
gate=$(node scripts/lib/approving-review.mjs --head "$HEAD" <<<"$pr")
gate_rc=$?
set -e
# gate_rc 0 + APPROVED → approved. gate_rc 1 → CHANGES_REQUESTED or NONE (expected).
# gate_rc 2 → broken gate input; stop the turn and report (do not continue the table).
# CI = the four Quality Gates jobs (Lint, Unit Tests, Production Build, End-to-End Tests)
# via Actions / submit-pr semantics — not the full `gh pr checks` list (that includes Automation).
```

| # | Situation | Action |
| --- | --- | --- |
| 1 | PR merged or closed | Stop. Unsubscribe stuck timer if still listed. |
| 2 | Quality Gates **failed** on this head | Fix, **push**, reset stuck timer (list → unsubscribe by `subscriptionId` → `subscribe_timer` 900s once). Do this **even if** the head is already `APPROVED` (the push needs a new approval). Do not ping Kunal. End turn. |
| 3 | Latest decisive review on this head is `CHANGES_REQUESTED` | Fix, **push**, reset stuck timer (same reset steps). End turn. |
| 4 | Latest decisive review on this head is `APPROVED` and Quality Gates are **not** failed | **Keep the stuck timer armed.** In this same turn run `bash scripts/submit-pr.sh --pr <n>` (it waits if CI is still pending). Do **not** wait on `subscribe_github_ci`. Switch only on the script’s exit code — do not parse stderr: **0** → success (row 1 unsubscribes after merge); **1** (CI failure) → row 2; **2** (conflicts) or **3** (head moved / approval gone) → fix, **push**, reset timer, end turn; **4** (gave up: timeout, Actions 403, no Quality Gates run, merge error, gate broken) → end the turn and **leave the timer armed**. Never squash-merge outside `submit-pr.sh`. |
| 5 | Otherwise still waiting | **PR/CI wake:** keep waiting; do **not** restart the stuck timer. **Timer wake:** always message the EM (Project chat) once. Also best-effort `bash scripts/factory-slack.sh --message "…"` (Cursor-bot Slack-poster; default `#spacexsi-demo-factory`). **Never** user Slack MCP. Any non-zero `factory-slack.sh` status: relay its stderr to the EM and **finish this row** (do not block the PR, merge, spawn a reviewer, or re-arm the timer). Do not re-arm the timer until the next **push**. |

Do not use comment-body text as a merge or wake predicate — only formal review state on the head SHA (plus Quality Gates status for rows 2/4/5).

### Fallback (only if subscription tools are missing)

Poll `gh pr view` ~every 30s; after **15 minutes** from the latest push apply the timer-wake row of the table. Prefer subscriptions whenever available.

## Plan (non-mechanical only)

Skip for typo/path/format-only edits. Otherwise note: context found, approach, risks, verification. Carry into the PR body.

## Implement

Satisfy AC. Behavior change → failing behavior test first. Colocate unit tests in `__tests__/`. Scope cleanup only when it unblocks a clean fix.

## Address feedback

Treat each finding as a **failure class**: root cause, sibling paths in scope, smallest fix that eliminates the class, proof that would have caught it. Then verify, **push**, and follow **Subscribe after each push** (that section owns timer reset + end turn).
