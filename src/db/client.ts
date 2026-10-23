/**
 * SQLite + Drizzle client. Owns the file at `DATABASE_FILE` (default
 * `data/eor.sqlite`), applies DDL on open, and seeds when `users` is empty.
 * Tests inject a path via `createDb` instead of the process-wide handle.
 */
import fs from "node:fs"
import path from "node:path"

import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"

import * as schema from "./schema"
import { seedIfEmpty } from "./seed"

const DEFAULT_DB_FILE = path.join("data", "eor.sqlite")

export type AppDatabase = ReturnType<typeof createDb>

export function resolveDbPath(
  env: Record<string, string | undefined> = process.env
): string {
  const fromEnv = env.DATABASE_FILE
  if (!fromEnv) {
    return path.join(/*turbopackIgnore: true*/ process.cwd(), DEFAULT_DB_FILE)
  }
  if (path.isAbsolute(fromEnv)) return fromEnv
  return path.join(/*turbopackIgnore: true*/ process.cwd(), fromEnv)
}

/** Apply DDL so cold starts work without a versioned migration. Keep checks in sync with schema.ts. */
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
      created_at INTEGER NOT NULL,
      CONSTRAINT users_tenant_link CHECK (
        (role IN ('client_hr', 'worker') AND client_company_id IS NOT NULL AND provider_id IS NULL)
        OR
        (role IN ('eor_ops', 'eor_reviewer') AND provider_id IS NOT NULL AND client_company_id IS NULL)
      )
    );
    CREATE TABLE IF NOT EXISTS client_agreements (
      id TEXT PRIMARY KEY NOT NULL,
      client_company_id TEXT NOT NULL UNIQUE REFERENCES client_companies(id),
      markup_pct INTEGER NOT NULL,
      status TEXT NOT NULL,
      signed_at INTEGER,
      created_at INTEGER NOT NULL,
      CONSTRAINT client_agreements_signed_at CHECK (
        (status = 'signed' AND signed_at IS NOT NULL)
        OR
        (status = 'draft' AND signed_at IS NULL)
      )
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
      hire_request_id TEXT NOT NULL UNIQUE REFERENCES hire_requests(id),
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
    CREATE INDEX IF NOT EXISTS case_documents_case_kind_created_idx
      ON case_documents (case_id, kind, created_at);
    CREATE TABLE IF NOT EXISTS case_events (
      id TEXT PRIMARY KEY NOT NULL,
      case_id TEXT NOT NULL REFERENCES onboarding_cases(id),
      actor_user_id TEXT REFERENCES users(id),
      type TEXT NOT NULL,
      payload_json TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS case_events_case_created_idx
      ON case_events (case_id, created_at);
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

export function createDb(
  dbPath: string,
  options: { forceSeed: boolean }
) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const sqlite = new Database(dbPath)
  sqlite.pragma("journal_mode = WAL")
  sqlite.pragma("foreign_keys = ON")
  applySchema(sqlite)
  const db = drizzle(sqlite, { schema })
  seedIfEmpty(db, { force: options.forceSeed })
  return db
}

let singleton: AppDatabase | null = null

/** Process-wide handle. Call only at the server-action / page boundary. */
export function getDb(
  env: Record<string, string | undefined> = process.env
): AppDatabase {
  if (!singleton) {
    singleton = createDb(resolveDbPath(env), {
      forceSeed: env.FORCE_SEED === "1",
    })
  }
  return singleton
}
