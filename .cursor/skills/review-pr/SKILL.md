---
name: review-pr
description: Use for independent pull request review. Evaluates issue fit, changed behavior, architecture, tests, standards compliance, follow-up issues, and submits the structured review verdict via gh Approve / Request changes.
---

# Review PR

Reviewers gate PRs on correctness, architecture, test quality, and issue fit.
The output is always a binary verdict plus optional follow-up issues, submitted
through `scripts/submit-review.sh` (which posts a structured review and calls
`gh pr review` to **Approve** or **Request changes**).

This is a Cursor reviewer worker — not Bugbot. CI remains the merge verify gate;
review is the quality gate.

For background workers, use `silent-mode` for human-facing chat.

Reviewer goal: find the complete blocking set in the current review pass. Do
not stop because you found enough issues to request changes.

## Required Context

Before judging the PR, read:

- `standards/engineering.md` — every `[Required]` section is the quality bar.
- `standards/testing.md` — test quality bar.
- The linked GitHub issue and acceptance criteria.
- The PR body (approach, contract/risk matrix, risks, refactoring, tests,
  verification).
- All changed files in full context, not only the diff.

Review the engineer's exact worktree/branch when provided. Do not create a new
branch, create a new worktree, switch branches, or clean up worktrees.

## Review Method

For every changed function or module:

- Trace inputs, outputs, calls, and mutated state.
- Verify assumptions at every call site after public signature or type changes.
- Compare the PR body/plan to the implementation.
- For every contract/risk matrix row, verify enforcement and proof.
- Verify tests specify observable behavior, not implementation details.
- Do not defer to CI or test pass status as proof of correctness.

## Exhaustive Pass Discipline

1. Build a review map of changed files, exported surfaces, call sites, tests.
2. Complete the map even after the first `CRITICAL` or `IMPORTANT` finding.
3. For each finding, ask what adjacent path could fail for the same reason.
4. Re-read the PR body, matrix, and linked issue after tracing code.
5. Re-scan changed tests; missing regression coverage is a finding.
6. Only then group findings, calibrate severity, and submit.

## Verdict Rules

- `APPROVED` — meets the quality bar. Non-blocking improvements may be follow-ups.
- `CHANGES_REQUESTED` — at least one `IMPORTANT` or `CRITICAL` finding blocks merge.

Severity:

- `CRITICAL` — broken behavior, data loss risk, security issue, or regression.
- `IMPORTANT` — architecture violation, missing tests for meaningful changed
  behavior, standards violation without exception, or unjustified plan deviation.

Do not request changes for nits. Put worthwhile non-blocking improvements into
follow-up GitHub issues.

## High-Miss Checks

Actively check before approving:

- Business logic in orchestration hooks (should be pure behavior functions).
- Missing tests for every modified function or changed behavior.
- Tests that assert implementation details instead of behavior.
- Incomplete consumer updates after exported signature changes.
- Missing or stale contract/risk matrix rows for touched risky surfaces.

Test coverage gate:

```text
For each modified function or behavior:
  Does a test exist that would fail if this code were broken?
    YES -> coverage exists
    NO  -> flag as IMPORTANT
```

## Follow-Ups

For each useful non-blocking improvement:

1. Create a GitHub issue (prefer `.github/ISSUE_TEMPLATE/follow-up.yml` when
   available; otherwise `gh issue create` with Source PR / What / Why / Impact).
2. Apply the `Needs Review` label when that label exists.
3. Include the returned issue number in the review submission with `--followup`.

Creating follow-up issues is part of the reviewer role and is not a source edit.

## Submit

Stop before calling the script. Verify every blocking finding has severity,
file:line, issue, why it matters, and required fix. Submit only through:

```bash
bash scripts/submit-review.sh --pr <number> \
  --verdict APPROVED|CHANGES_REQUESTED \
  [--finding "CRITICAL|IMPORTANT|file:line|what|why it matters|required fix"] \
  [--followup "#N|description"] \
  [--strength "file:line|what was done well"]
```

Never post free-form PR review comments instead of the script.

Do not run `scripts/submit-pr.sh`. Approval means the reviewer gate passed; the
engineer submits and handles CI/merge.
