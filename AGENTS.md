# SpaceXAI Demo — Cursor factory

GitHub **Issues and PRs** are the source of truth.

## Roles

| Role | Who | Owns |
| --- | --- | --- |
| **EM** | This Project chat | Backlog, dispatch engineers, merge gates. No product code. |
| **Engineer** | Cloud worker | Issue end-to-end: plan → implement → PR → spawn reviewer → fix → `submit-pr.sh` |
| **Reviewer** | Worker spawned by engineer | Comment-only verdict via `submit-review.sh` (not a GitHub Approve or Request changes review; not Bugbot) |

Cursor already gives cloud workers a working branch from `main` — stay on it. PR base is `main`.

## Standards

- `standards/engineering.md`
- `standards/testing.md`

## Stack

Next.js (repo root), pnpm, Node 24. Unit/component tests in `__tests__/`; e2e in `e2e/`.

## Verify

```bash
pnpm lint && pnpm test && pnpm build
# e2e optional in agent; CI is merge gate
```

## Skills / scripts

| Skill | Role |
| --- | --- |
| `implement-issue` | Engineer loop (plan + feedback folded in) |
| `review-pr` | Comment-only binary verdict via `submit-review.sh` |

```bash
bash scripts/issue.sh <n> [--verify-unblocked|…]
bash scripts/submit-review.sh --pr <n> --verdict APPROVED|CHANGES_REQUESTED …  # comment only
bash scripts/submit-pr.sh --pr <n>   # Lint / Unit Tests / Production Build / End-to-End Tests → merge
```

One Issue → one PR. `Closes #<n>`. CI always-on (no label gate).

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
