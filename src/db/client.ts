/**
 * SQLite + Drizzle client. Owns the local file under `data/eor.sqlite` and
 * schema bootstrap. Prefer injecting a db handle in tests via `createDb`.
 */
import fs from "node:fs"
import path from "node:path"

import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"

import * as schema from "./schema"
import { seedIfEmpty } from "./seed"

const DEFAULT_DB_PATH = path.join(
  /*turbopackIgnore: true*/ process.cwd(),
  "data",
  "eor.sqlite"
)

export type AppDatabase = ReturnType<typeof createDb>

function resolveDbPath(): string {
  const fromEnv = process.env.DATABASE_URL
  if (!fromEnv) return DEFAULT_DB_PATH
  const raw = fromEnv.startsWith("file:")
    ? fromEnv.slice("file:".length)
    : fromEnv
  if (path.isAbsolute(raw)) return raw
  // Keep joins under `data/` so Turbopack does not trace the whole project.
  const underData = raw.startsWith("data/") ? raw.slice("data/".length) : raw
  return path.join(/*turbopackIgnore: true*/ process.cwd(), "data", underData)
}

function ensureDataDirs(dbPath: string): void {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  fs.mkdirSync(
    path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "uploads"),
    { recursive: true }
  )
}

/** Apply DDL so cold starts work without a separate migrate step. */
function applySchema(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS client_companies (
      id TEXT PRIMARY KEY NOT NULL,
      provider_id TEXT NOT NULL REFERENCES providers(id),
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY NOT NULL,
      role TEXT NOT NULL,
      display_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      client_company_id TEXT REFERENCES client_companies(id),
      provider_id TEXT REFERENCES providers(id),
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS client_agreements (
      id TEXT PRIMARY KEY NOT NULL,
      client_company_id TEXT NOT NULL REFERENCES client_companies(id),
      markup_pct INTEGER NOT NULL,
      status TEXT NOT NULL,
      signed_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS role_templates (
      id TEXT PRIMARY KEY NOT NULL,
      client_company_id TEXT NOT NULL REFERENCES client_companies(id),
      title TEXT NOT NULL,
      worker_type TEXT NOT NULL,
      wage_cents INTEGER NOT NULL,
      wage_unit TEXT NOT NULL,
      state_code TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS hire_requests (
      id TEXT PRIMARY KEY NOT NULL,
      client_company_id TEXT NOT NULL REFERENCES client_companies(id),
      role_template_id TEXT REFERENCES role_templates(id),
      worker_user_id TEXT NOT NULL REFERENCES users(id),
      created_by_user_id TEXT NOT NULL REFERENCES users(id),
      package TEXT NOT NULL,
      job_title TEXT NOT NULL,
      wage_cents INTEGER NOT NULL,
      wage_unit TEXT NOT NULL,
      state_code TEXT NOT NULL,
      policy_snapshot_json TEXT,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS onboarding_cases (
      id TEXT PRIMARY KEY NOT NULL,
      hire_request_id TEXT NOT NULL REFERENCES hire_requests(id),
      worker_user_id TEXT NOT NULL REFERENCES users(id),
      state TEXT NOT NULL,
      assigned_ops_user_id TEXT REFERENCES users(id),
      assigned_reviewer_user_id TEXT REFERENCES users(id),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS case_documents (
      id TEXT PRIMARY KEY NOT NULL,
      case_id TEXT NOT NULL REFERENCES onboarding_cases(id),
      kind TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      uploaded_by TEXT NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS case_events (
      id TEXT PRIMARY KEY NOT NULL,
      case_id TEXT NOT NULL REFERENCES onboarding_cases(id),
      actor_user_id TEXT REFERENCES users(id),
      type TEXT NOT NULL,
      payload_json TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS worker_profiles (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
      case_id TEXT REFERENCES onboarding_cases(id),
      personal_json TEXT,
      w4_json TEXT,
      bank_json TEXT,
      benefits_acked INTEGER NOT NULL DEFAULT 0,
      i9_attestation_json TEXT,
      updated_at INTEGER NOT NULL
    );
  `)
}

export function createDb(dbPath = resolveDbPath()) {
  ensureDataDirs(dbPath)
  const sqlite = new Database(dbPath)
  sqlite.pragma("journal_mode = WAL")
  sqlite.pragma("foreign_keys = ON")
  applySchema(sqlite)
  const db = drizzle(sqlite, { schema })
  seedIfEmpty(db)
  return db
}

let singleton: AppDatabase | null = null

export function getDb(): AppDatabase {
  if (!singleton) {
    singleton = createDb()
  }
  return singleton
}

export function resetDbSingletonForTests(): void {
  singleton = null
}
