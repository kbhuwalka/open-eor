# spacexai-demo

EOR worker-onboarding demo for Project SpaceXAI_Demo (factory Issue→PR→review).

**Stack:** Next.js App Router + TypeScript + shadcn/ui + **Drizzle + SQLite** + **iron-session**  
**Tests:** Vitest (unit/component), Playwright (e2e)  
**Package manager:** pnpm

## Specifications

Normative product and engineering specs live under [`docs/`](./docs/README.md) and are the source of truth for behavior: product overview, domain rules, case state machine, ACL, data model, architecture, work-auth review loop, and the Issue → spec map. Issues cite these paths; a PR that changes behavior updates the owning spec in the same PR.

## Prerequisites

- Node.js 20+ (repo targets Node 24 via `.nvmrc` when available)
- [pnpm](https://pnpm.io/) (`corepack enable && corepack prepare pnpm@10.33.4 --activate`)

## Database + seed

SQLite file: `data/eor.sqlite` (gitignored). Override the path with `DATABASE_FILE`. Schema is applied on first open; seed runs automatically when `users` is empty. `pnpm db:seed` sets `FORCE_SEED=1` and wipes + reseeds.

```bash
pnpm install
pnpm db:push    # optional — drizzle-kit push against schema
pnpm db:seed    # wipe+reseed demo world (sets FORCE_SEED)
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). With no session it redirects to `/pick`. Choosing a persona sets an **iron-session** signed httpOnly cookie named `eor_session` that carries `userId` only (override the signing secret with `SESSION_SECRET`, at least 32 characters). Switch persona clears the cookie.

Seeded personas: Client HR for each client company (Alex Harper at Acme Robotics, Priya Raman at Brightwave Labs, Marcus Hale at Harbor Foods Co.), Worker (Jordan Lee, owns `case_pending_1`), Worker (Taylor Kim, no case), one Onboarding Specialist (Sam Ortiz) and one Finance user (Morgan Reyes): both roles work a shared role queue, so one person each is enough. Around 47 people are produced by running the real order and task operations with seeded fake data (see [docs/data-model.md](docs/data-model.md) §5): just ordered, mid-onboarding, at risk, in rework, waiting for start, active, fixed term, cancelled and terminated. Jordan's case is waiting on the specialist's `verify_i9_section2` task, with a generated List A specimen stored through the real upload service under the uploads root. Every seeded identity document is a real file there, and `pnpm db:seed` recreates them.

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Next.js dev server |
| `pnpm build` | Production build |
| `pnpm start` | Serve production build |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest unit/component tests |
| `pnpm test:watch` | Vitest watch mode |
| `pnpm test:e2e` | Playwright e2e (live specs need a copy database outside the project, see [`e2e/README.md`](./e2e/README.md)) |
| `pnpm db:push` | Push Drizzle schema to SQLite |
| `pnpm db:seed` | Reseed demo data |

## Project layout

- `src/db/` — Drizzle schema, client, seed
- [`src/domain`](./src/domain) — pure case state machine, wage safeguards, policy snapshot, work-authorization lists, and worker checklist (no I/O). Specs: [`docs/domain.md`](./docs/domain.md), [`docs/case-state-machine.md`](./docs/case-state-machine.md). `types.ts` holds the enum constants and JSON parsers.
- `src/auth/` — iron-session, `requireUser` / `requireRole` / `requirePortalUser`
- `src/app/pick` — persona picker
- `src/app/{client,worker,onboarding,finance}` — role shells; each `layout.tsx` calls `requirePortalUser`
- `data/uploads/` — uploads, including the seed's generated specimen documents (gitignored); `data/uploads/seed/list-a-passport.png` is a legacy fixture kept for databases seeded before the seed stored its own files

## Deploy

Preferred host: [Vercel](https://vercel.com). Ensure `better-sqlite3` native builds are allowed in the environment, and set `SESSION_SECRET`.

## Factory dry-run

Engineers own one Issue end-to-end. After each push they subscribe for Cursor Automation review (formal GitHub approve / request-changes on the head SHA). After an approve on the current head they run `scripts/submit-pr.sh`. Stuck wakes use `scripts/factory-slack.sh` (plus EM) — not user Slack MCP.
