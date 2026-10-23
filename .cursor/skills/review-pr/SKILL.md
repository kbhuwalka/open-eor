---
name: review-pr
description: Independent PR review. Binary Approve or Request changes via submit-review.sh. Not Bugbot.
---

# Review PR

Review the PR/branch you’re given. No branch setup.

Quality bar: `standards/engineering.md` + `standards/testing.md` **[Required]**, linked Issue AC, PR body. **CI green ≠ approve** — trace the code.

## Method

Trace changed code and call sites; compare to plan/PR body; require behavior tests for changed behavior; collect the full blocking set before submitting.

## Verdict

- `APPROVED` — meets the bar (nits → follow-up Issues)
- `CHANGES_REQUESTED` — ≥1 IMPORTANT or CRITICAL finding

CRITICAL = broken behavior / data loss / security / regression. IMPORTANT = architecture violation, missing proof for meaningful changed behavior, or unjustified plan deviation.

## Submit

```bash
bash scripts/submit-review.sh --pr <n> \
  --verdict APPROVED|CHANGES_REQUESTED \
  [--finding "CRITICAL|IMPORTANT|file:line|what|why|required fix"] \
  [--followup "#N|description"]
```

Do **not** run `submit-pr.sh` — the engineer submits after approve.
