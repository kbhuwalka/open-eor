# SpaceXAI Demo — Cursor factory

GitHub **Issues and Pull Requests** are the source of truth. Issue bodies, PR descriptions, and review comments are the durable record — not chat history.

## Roles

| Role | Who | Owns |
| --- | --- | --- |
| **Project coordinator (EM)** | This Cursor Project chat | Backlog, dispatch, merge gates. No product code edits. |
| **Engineer workers** | Parallel Cursor workers (`CreateAgent`) | One Issue → one branch/worktree → one PR → verify |
| **Reviewer (optional)** | A worker or a human | PR review; binary verdict; follow-up Issues if needed |

The Project chat **is** the EM. There is no separate orchestrator agent, Codex runtime, or `/orchestrate` command.

## Standards

- `standards/engineering.md` — layered architecture, DI, correctness-by-construction
- `standards/testing.md` — behavior-spec tests; colocated `__tests__/`

Read these before non-trivial edits. Reviewers enforce **[Required]** sections.

## Stack

- **App:** Next.js App Router, TypeScript, shadcn/ui — repo root
- **Package manager:** pnpm
- **Unit / component tests:** Vitest (+ RTL) in sibling `__tests__/` next to source
- **E2E:** Playwright (`e2e/`, `pnpm test:e2e`)

## Local verify

Before opening or updating a PR, from repo root:

```bash
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

## Conventions

- **One Issue → one branch → one PR.** Do not bundle unrelated Issues.
- Prefer branch names: `cursor/issue-<n>-short-title`
- Link the Issue in the PR; close via merge when acceptance criteria are met.
- Keep PRs reviewable; prefer small, sequential PRs over mega-diffs.

## Skills / scripts

Project skills live under `.cursor/skills/` (Cursor loads these automatically):

| Skill | Role |
| --- | --- |
| `implement-issue` | Engineer loop: plan gate → implement → PR → reviewer → `submit-pr.sh` |
| `implementation-plan` | Discovery-first plan + contract/risk matrix before non-mechanical edits |
| `review-pr` | Exhaustive review → binary verdict → `submit-review.sh` (Approve / Request changes) |
| `address-feedback` | Treat review findings as failure classes; fix + re-proof |
| `silent-mode` | Background workers only — no chat noise unless blocked/handoff |

Ops scripts (`scripts/`):

```bash
bash scripts/issue.sh <n> [--verify-unblocked|…]
bash scripts/worktree.sh create cursor/issue-<n>-short-title   # base: main
bash scripts/submit-review.sh --pr <n> --verdict APPROVED|CHANGES_REQUESTED …
bash scripts/submit-pr.sh --pr <n> [--no-merge]               # watches Lint / Unit Tests / Production Build / End-to-End Tests
```

**EM** = this Project chat (no `/orchestrate` skill). **Reviewer** = Cursor agent via `gh` Approve/Request changes — not Bugbot. CI is always-on on PRs (no `Run Checks` label).

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
