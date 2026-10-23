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

Seeded personas: Client HR (Alex Harper), Worker (Jordan Lee, owns `case_pending_1`), Worker (Taylor Kim, no case), EOR Ops, EOR Reviewer. `hire_1` is `submitted` with a policy snapshot. The case is in `pending_review` with a List A fixture at `data/uploads/seed/list-a-passport.png`.

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Next.js dev server |
| `pnpm build` | Production build |
| `pnpm start` | Serve production build |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest unit/component tests |
| `pnpm test:watch` | Vitest watch mode |
| `pnpm test:e2e` | Playwright e2e |
| `pnpm db:push` | Push Drizzle schema to SQLite |
| `pnpm db:seed` | Reseed demo data |

## Project layout

- `src/db/` — Drizzle schema, client, seed
- `src/domain/types.ts` — JSON column parsers (`parsePolicySnapshot`, `parseI9Attestation`, …)
- `src/auth/` — iron-session, `requireUser` / `requireRole` / `requirePortalUser`
- `src/app/pick` — persona picker
- `src/app/{client,worker,ops,review}` — role shells; each `layout.tsx` calls `requirePortalUser`
- `data/uploads/seed/` — committed upload fixtures (other uploads are gitignored)

## Deploy

Preferred host: [Vercel](https://vercel.com). Ensure `better-sqlite3` native builds are allowed in the environment, and set `SESSION_SECRET`.

## Factory dry-run

Engineers own one Issue end-to-end and spawn a reviewer on the open PR before merge.
