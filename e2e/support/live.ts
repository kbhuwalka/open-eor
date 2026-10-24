/**
 * Helpers for the e2e specs that drive the real pages (not /dev/*) against the seeded database.
 *
 * The server under test and these helpers share one SQLite file: `DATABASE_FILE`, or the default
 * `data/eor.sqlite` the dev server seeds on first use. Specs read ids from it (a client with past
 * invoices, an employee with pay slips) instead of hardcoding names, and the helpers sign in by
 * sealing the session cookie with the same dev secret the server uses.
 */
import path from "node:path"

import { sealData } from "iron-session"
import Database from "better-sqlite3"
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test"

import { businessDayOf } from "@/domain/business-time"

const SESSION_SECRET = process.env.SESSION_SECRET ?? "eor-demo-session-secret-not-for-production-32b"

export function dbFile(): string {
  const configured = process.env.DATABASE_FILE
  if (!configured) return path.join(process.cwd(), "data", "eor.sqlite")
  return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured)
}

/**
 * Why reads are read-only and writes are guarded.
 *
 * The server keeps its SQLite connection (WAL mode) open while a spec runs. SQLite deletes the
 * `-wal` and `-shm` files when the last connection closes, and decides "last" from POSIX file
 * locks. Under `next dev` with Turbopack the server process drops those locks whenever the
 * database file sits inside the project directory (Turbopack reads files there in-process, and
 * closing any descriptor of a file releases all of the process's locks on it). Then a spec's own
 * connection believes it is the last one: on `close()` it checkpoints and unlinks the WAL, the
 * server goes on writing to the unlinked file, and every later read through a new connection (the
 * next helper call, the sqlite3 CLI, a second server) sees stale data. It does not happen with the
 * database outside the project directory, with `next dev --webpack` or with a production server.
 *
 * So: `openLiveDb` is read-only, which never checkpoints or deletes anything on close and is safe
 * everywhere; anything that writes goes through `writeLiveDb`, which refuses a database inside
 * the project directory (`DATABASE_FILE=/tmp/x.sqlite`, as every spec header says). Prefer driving
 * the change through the app and only use `writeLiveDb` for setup and cleanup.
 */
export function dbInsideProject(file: string = dbFile()): boolean {
  const relative = path.relative(process.cwd(), file)
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
}

/** Opens the seeded database read-only, waiting for the server to create and seed it on its first request. */
export async function openLiveDb(page: Page): Promise<Database.Database> {
  await page.request.get("/pick")
  return new Database(dbFile(), { fileMustExist: true, readonly: true, timeout: 10_000 })
}

/**
 * Runs `fn` with a writable connection and closes it. Throws when the database is inside the
 * project directory (see above) unless `E2E_ALLOW_DB_IN_PROJECT=1` says the server is not
 * Turbopack dev. Synchronous so `afterAll` cleanups can use it.
 */
export function writeLiveDb<T>(fn: (db: Database.Database) => T): T {
  const file = dbFile()
  if (dbInsideProject(file) && process.env.E2E_ALLOW_DB_IN_PROJECT !== "1") {
    throw new Error(
      `${file} is inside the project directory. A writing spec must run on a copy outside it ` +
        "(DATABASE_FILE=/tmp/copy.sqlite for the server and for Playwright): closing a second connection to a " +
        "database the Turbopack dev server holds in-tree makes SQLite delete the WAL under the server.",
    )
  }
  const db = new Database(file, { fileMustExist: true, timeout: 10_000 })
  try {
    return fn(db)
  } finally {
    db.close()
  }
}

export async function signInAs(context: BrowserContext, baseURL: string, userId: string): Promise<void> {
  const value = await sealData({ userId }, { password: SESSION_SECRET })
  await context.addCookies([{ name: "eor_session", value, url: baseURL }])
}

export const cents = (text: string | null): number => Math.round(Number((text ?? "").replace(/[^0-9.]/g, "")) * 100)

/** Today's `YYYY-MM-DD` on the business clock (America/New_York), the zone pay slips become visible in. */
export const todayEastern = (now: Date = new Date()): string => businessDayOf(now)

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** All text of a PDF, one string, for asserting on what a download actually prints. */
export async function pdfText(bytes: Uint8Array): Promise<string> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs")
  const doc = await getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise
  let text = ""
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const content = await (await doc.getPage(pageNumber)).getTextContent()
    text += `${content.items.map((item) => ("str" in item ? item.str : "")).join(" ")}\n`
  }
  return text
}

export async function download(request: APIRequestContext, url: string) {
  const response = await request.get(url)
  return { response, bytes: new Uint8Array(await response.body()) }
}
