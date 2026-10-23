# SpaceXAI Demo — Cursor factory

GitHub **Issues and Pull Requests** are the source of truth. Issue bodies, PR descriptions, and review comments are the durable record — not chat history.

## Roles

| Role | Who | Owns |
| --- | --- | --- |
| **Project coordinator (EM)** | This Cursor Project chat | Backlog, dispatch engineers, merge gates. No product code edits. |
| **Engineer** | Cursor worker (`CreateAgent`) | One Issue end-to-end: plan → implement → PR → **spawn reviewer** → fix → `submit-pr.sh` |
| **Reviewer** | Cursor worker spawned by the engineer | Binary Approve / Request changes via `submit-review.sh` (not Bugbot) |

The Project chat **is** the EM. No separate orchestrator skill or Codex `/orchestrate` runtime.

## Standards

- `standards/engineering.md` — layered architecture, DI, correctness-by-construction
- `standards/testing.md` — behavior-spec tests; colocated `__tests__/`

Read these before non-trivial edits. Reviewers enforce **[Required]** sections.

## Stack

- **App:** Next.js App Router, TypeScript, shadcn/ui — repo root
- **Package manager:** pnpm (`packageManager` pin in `package.json`); Node 24
- **Unit / component tests:** Vitest (+ RTL) in sibling `__tests__/`
- **E2E:** Playwright (`e2e/`, `pnpm test:e2e`)

## Local verify

```bash
pnpm lint
pnpm test
pnpm build
# pnpm test:e2e optional locally; CI is the merge gate
```

## Conventions

- **One Issue → one branch → one PR**
- Branch: `cursor/issue-<n>-short-title` (base `main`)
- Link the Issue (`Closes #<n>`); keep PRs small

## Skills / scripts

Only two skills under `.cursor/skills/`:

| Skill | Role |
| --- | --- |
| `implement-issue` | Engineer owns the Issue; plan + address-feedback folded in; spawns reviewer; runs `submit-pr.sh` after approve |
| `review-pr` | Reviewer; binary verdict via `submit-review.sh` |

```bash
bash scripts/issue.sh <n> [--verify-unblocked|…]
bash scripts/worktree.sh create|list|cleanup …
bash scripts/submit-review.sh --pr <n> --verdict APPROVED|CHANGES_REQUESTED …
bash scripts/submit-pr.sh --pr <n>   # waits Lint / Unit Tests / Production Build / End-to-End Tests → merge
```

CI is always-on for PRs (no label gate). On this Mac, ensure `PATH` includes `~/.local/bin` for `gh`.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
