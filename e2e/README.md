# End-to-end tests

Playwright specs. `pnpm test:e2e` runs them all; a spec's header says what it needs. The husky **pre-commit** hook runs Vitest then this suite (`pnpm test:precommit`); GitHub Actions no longer runs Playwright. See the README "Pre-commit hooks" section for install and skip (`SKIP` / `HUSKY=0` / `--no-verify`).

## Two kinds of spec

- `/dev/*` specs (`client-finance.spec.ts`, `employee-pay.spec.ts`, ...) drive fixture pages and need only a server.
- Live specs (`*-live.spec.ts`, `finance-portal.spec.ts`, `employee-onboarding.spec.ts`, ...) drive the real portals against the seeded database. They sign in by sealing the session cookie (`signInAs` in `support/live.ts`) and read ids out of the database (a client with past invoices, an employee with slips) instead of hardcoding names.

## Run a live spec on a copy outside the project directory

```bash
sqlite3 data/eor.sqlite ".backup /tmp/e2e.sqlite"   # a consistent copy even while another server runs; or let the server seed an empty path
DATABASE_FILE=/tmp/e2e.sqlite pnpm dev -p 3720
DATABASE_FILE=/tmp/e2e.sqlite PLAYWRIGHT_BASE_URL=http://localhost:3720 pnpm playwright test e2e/finance-portal.spec.ts
```

Use a port of your own, use `localhost` (not `127.0.0.1`) in the URL, and never point a spec that writes at a database another server is using for something else. Specs that complete tasks or move money need a fresh copy to rerun, unless they clean up after themselves (`client-finance-live`, `employee-pay-live` do).

## Why the database must be outside the project directory (and how the helpers enforce it)

The server and the spec share one SQLite file in WAL mode. SQLite removes the `-wal` and `-shm` files when the last connection closes, and it decides "last" from POSIX file locks, which belong to the process. Under `next dev` with Turbopack the server process loses its locks when the database file is inside the project directory (Turbopack reads files there natively, and closing any descriptor of a file drops all of the process's locks on it). A spec's second connection then believes it is alone: on `close()` it checkpoints and unlinks the WAL, the server keeps writing to the unlinked file, and every later connection (the next helper call, the sqlite3 CLI, a second server) reads stale data. This was reproduced with an in-tree file, with an in-tree dot directory, and not with a file outside the project, `next dev --webpack`, or a production server.

The helpers in `support/live.ts` are built around that:

| Helper | Use | Behaviour |
| --- | --- | --- |
| `openLiveDb(page)` | reading ids and checking what the app wrote | opens the file `readonly`; a read-only connection never checkpoints or deletes anything, so closing it is safe wherever the server runs |
| `writeLiveDb(fn)` | setup and cleanup that the app cannot do (backdating a payment, inserting a future slip, deleting what a test created) | opens a writable connection, runs `fn`, closes it; throws a clear error when the database is inside the project directory, unless `E2E_ALLOW_DB_IN_PROJECT=1` (a server that is not Turbopack dev) |
| `dbInsideProject()` | the guard behind `writeLiveDb` | true when `DATABASE_FILE` resolves under the working directory |

Prefer making a change through the app (the UI or a Server Action) and reading the result with `openLiveDb`. Reach for `writeLiveDb` only when the app has no way to do it, and keep the write short: open, change, close, then go back to the page.

The business day in specs is `todayEastern()` (America/New_York, the one helper the app uses for "today", due and overdue, paid-on dates and the day a pay slip appears); do not derive it from `new Date().toISOString()`.
