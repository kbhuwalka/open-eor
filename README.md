# spacexai-demo

Starter web app for Project SpaceXAI_Demo.

**Stack:** React + Next.js (App Router) + TypeScript + shadcn/ui  
**Tests:** Vitest (Vite) for unit/component, Playwright for e2e  
**Package manager:** pnpm

This repo keeps the default/starter UI. Product features are tracked in GitHub Issues.

## Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io/) (`corepack enable && corepack prepare pnpm@10.33.4 --activate`)

## Run locally

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Next.js dev server |
| `pnpm build` | Production build |
| `pnpm start` | Serve production build |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest unit/component tests |
| `pnpm test:watch` | Vitest watch mode |
| `pnpm test:e2e` | Playwright e2e (starts `pnpm dev` unless `PLAYWRIGHT_BASE_URL` is set) |

## Deploy

Preferred host: [Vercel](https://vercel.com).

```bash
# one-time
pnpm dlx vercel login

# from repo root
pnpm dlx vercel            # preview
pnpm dlx vercel --prod     # production
```

Link the GitHub repo in the Vercel dashboard for automatic deploys on push to `main`.

## Project notes

- UI primitives live under `src/components/ui` (shadcn/ui).
- App routes use the App Router under `src/app`.
- Unit tests: `src/**/*.{test,spec}.{ts,tsx}`
- E2E tests: `e2e/`
