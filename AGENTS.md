# SpaceXAI Demo — Cursor factory

GitHub **Issues and PRs** are the source of truth.

## Roles

| Role | Who | Owns |
| --- | --- | --- |
| **EM** | This Project chat | Backlog and dispatch. The owning engineer merges. No product code. |
| **Engineer** | Cloud worker | Issue end-to-end through merge: plan → implement → PR → subscribe for Automation review (end turn) → `submit-pr.sh` |
| **Reviewer** | Cursor Automation (GitHub login often `cursor`) | Formal GitHub approve / request-changes on PR open and push (not a spawned worker; not Bugbot). Any account’s APPROVED review on the head SHA satisfies `submit-pr.sh`. |

Cursor already gives cloud workers a working branch from `main` — stay on it. PR base is `main`.

## Standards

- `standards/engineering.md`
- `standards/testing.md`

## Stack

Next.js (repo root), pnpm, Node 24. Unit/component tests in `__tests__/`; e2e in `e2e/`.

## Verify

```bash
pnpm lint && pnpm test:precommit && pnpm build
# test:precommit = Vitest then Playwright (scripts/test-precommit.ts; also husky pre-push).
# CI Quality Gates: Lint + Production Build only.
# Skip husky only: SKIP=pre-push|tests|all | HUSKY=0 | git push --no-verify — note skips in the PR.
# pnpm test:precommit always runs (SKIP does not apply).
```

## Skills / scripts

| Skill | Role |
| --- | --- |
| `implement-issue` | Engineer loop (plan + subscribe for Automation review + feedback) |
| `review-pr` | Manual one-off comment verdict via `submit-review.sh` (not the happy path) |

```bash
bash scripts/issue.sh <n> [--verify-unblocked|…]
bash scripts/submit-pr.sh --pr <n>   # engineer, after Automation approve: CI → squash-merge
bash scripts/factory-slack.sh --message "…"   # Cursor-bot Slack via Automation webhook (env secrets)
# manual one-off only:
bash scripts/submit-review.sh --pr <n> --verdict APPROVED|CHANGES_REQUESTED …
```

One Issue → one PR. `Closes #<n>`. CI always-on (no label gate). CI green ≠ review passed. After each **push**, engineers subscribe (PR + CI + once 900s stuck timer; reset timer via list → unsubscribe by id → re-subscribe) and end the turn. Stuck-alert / wake rules live only in `implement-issue`.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
