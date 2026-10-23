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

Post one comment with `submit-review.sh` and stop. The script exits 0 when the comment is posted. The first line of the comment is the verdict word `APPROVED` or `CHANGES_REQUESTED`. The owning engineer reads that line and, on `APPROVED`, runs `submit-pr.sh`.

Do not call `gh pr review`, `addPullRequestReview`, or any approve, request-changes, or dismiss mutation. Do not run `submit-pr.sh`.

```bash
bash scripts/submit-review.sh --pr <n> \
  --verdict APPROVED|CHANGES_REQUESTED \
  [--finding "CRITICAL|IMPORTANT|file:line|what|why|required fix"] \
  [--followup "#N|description"]
```
