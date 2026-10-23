---
name: review-pr
description: Independent PR review. Binary Approve or Request changes via submit-review.sh. Not Bugbot.
---

# Review PR

Review the engineer’s **exact** branch (and checkout/worktree if they used a Mac local). Do not create or switch branches, or clean up worktrees.

Quality bar: `standards/engineering.md` and `standards/testing.md` **[Required]** sections, linked Issue AC, and the PR body (approach / risks / tests / verification).

**CI green ≠ approve.** Trace the code; don’t defer to checks.

## Method

- Read changed files in full context; trace call sites
- Check plan/PR body against the implementation
- Behavior tests for changed behavior (not implementation details)
- Collect the full blocking set before submitting — don’t stop at the first issue

## Verdict

- `APPROVED` — meets the bar; non-blocking ideas → follow-up Issues only
- `CHANGES_REQUESTED` — at least one IMPORTANT or CRITICAL finding

Severity: CRITICAL = broken behavior / data loss / security / regression. IMPORTANT = architecture or missing proof for meaningful changed behavior, or unjustified plan deviation.

## Submit (only this way)

```bash
bash scripts/submit-review.sh --pr <n> \
  --verdict APPROVED|CHANGES_REQUESTED \
  [--finding "CRITICAL|IMPORTANT|file:line|what|why|required fix"] \
  [--followup "#N|description"] \
  [--strength "file:line|what was done well"]
```

`CHANGES_REQUESTED` requires ≥1 `--finding`. Do **not** run `submit-pr.sh` — the engineer submits after approve.
