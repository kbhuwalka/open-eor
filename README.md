# spacexai-demo

EOR worker-onboarding demo for Project SpaceXAI_Demo (factory Issue→PR→review).

**Stack:** Next.js App Router + TypeScript + shadcn/ui + **Drizzle + SQLite** + **iron-session**  
**Tests:** Vitest (unit/component), Playwright (e2e)  
**Package manager:** pnpm

## Prerequisites

- Node.js 20+ (repo targets Node 24 via `.nvmrc` when available)
- [pnpm](https://pnpm.io/) (`corepack enable && corepack prepare pnpm@10.33.4 --activate`)

## Database + seed

SQLite file: `data/eor.sqlite` (gitignored). Schema is applied on first open; seed runs automatically when the DB has no users.

```bash
pnpm install
pnpm db:push    # optional — drizzle-kit push against schema
pnpm db:seed    # wipe+reseed demo world (sets FORCE_SEED)
pnpm dev
```

Open [http://localhost:3000/pick](http://localhost:3000/pick) and choose a persona. Session is an **iron-session** signed httpOnly cookie with `userId` (override secret via `SESSION_SECRET`, ≥32 chars).

Seeded personas: Client HR · Worker · EOR Ops · EOR Reviewer. Mid-funnel case `case_pending_1` is in `pending_review` with a fixture under `data/uploads/seed/`.

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
- `src/auth/` — iron-session, `requireUser` / `requireRole`, ACL helpers
- `src/app/pick` — Netflix-style persona picker
- `src/app/{client,worker,ops,review}` — role shell stubs with guards
- `data/uploads/seed/` — committed upload fixtures

## Deploy

Preferred host: [Vercel](https://vercel.com). Ensure `better-sqlite3` native builds are allowed in the environment, and set `SESSION_SECRET`.

## Factory dry-run

Engineers own one Issue end-to-end and spawn a reviewer on the open PR before merge.
