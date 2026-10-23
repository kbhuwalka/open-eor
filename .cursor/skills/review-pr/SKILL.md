---
name: review-pr
description: Independent PR review. Post a binary verdict as a PR comment via submit-review.sh. Not a GitHub Approve or Request changes review. Not Bugbot.
---

# Review PR

Review the PR/branch you’re given. No branch setup.

Quality bar: `standards/engineering.md` + `standards/testing.md` **[Required]**, linked Issue AC, PR body. **CI green ≠ a passing verdict** — trace the code.

## Method

Trace changed code and call sites; compare to plan/PR body; require behavior tests for changed behavior; collect the full blocking set before submitting.

## Verdict

- `APPROVED` — meets the bar (nits → follow-up Issues)
- `CHANGES_REQUESTED` — ≥1 IMPORTANT or CRITICAL finding

CRITICAL = broken behavior / data loss / security / regression. IMPORTANT = architecture violation, missing proof for meaningful changed behavior, or unjustified plan deviation.

## Submit

Post the written verdict with `submit-review.sh`. That script adds **one PR comment** and exits 0. The verdict word in the comment is the review record. It does not approve, request changes, or dismiss a GitHub review.

Do **not** run `gh pr review`, `gh api` review mutations (`addPullRequestReview`, approve, request-changes, dismiss), or `submit-pr.sh`. The engineer reads the comment and submits after `APPROVED`.

```bash
bash scripts/submit-review.sh --pr <n> \
  --verdict APPROVED|CHANGES_REQUESTED \
  [--finding "CRITICAL|IMPORTANT|file:line|what|why|required fix"] \
  [--followup "#N|description"]
```
