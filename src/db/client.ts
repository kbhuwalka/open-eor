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
import { ensureWorkflowTemplates } from "./workflow-templates"

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

/**
 * Bump when a table or CHECK constraint changes in a way `CREATE TABLE IF NOT EXISTS` cannot
 * apply. The demo has no data worth migrating, so a file with an older `user_version` is dropped
 * and rebuilt (the seed then recreates the demo world through the real operations).
 */
export const SCHEMA_VERSION = 3

function rebuildIfStale(sqlite: Database.Database): void {
  const current = sqlite.pragma("user_version", { simple: true }) as number
  if (current >= SCHEMA_VERSION) return
  const tables = sqlite
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all() as { name: string }[]
  if (tables.length > 0) {
    sqlite.pragma("foreign_keys = OFF")
    for (const { name } of tables) sqlite.exec(`DROP TABLE IF EXISTS "${name}"`)
    sqlite.pragma("foreign_keys = ON")
  }
  sqlite.pragma(`user_version = ${SCHEMA_VERSION}`)
}

/** Apply DDL so cold starts work without a versioned migration. Keep checks in sync with schema.ts. */
function applySchema(sqlite: Database.Database): void {
  rebuildIfStale(sqlite)
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
      csm_name TEXT,
      csm_email TEXT,
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
        (role IN ('onboarding_specialist', 'finance') AND provider_id IS NOT NULL AND client_company_id IS NULL)
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
    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY NOT NULL,
      client_company_id TEXT NOT NULL REFERENCES client_companies(id),
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS roles_company_name_idx
      ON roles (client_company_id, lower(name));
    CREATE TABLE IF NOT EXISTS hire_requests (
      id TEXT PRIMARY KEY NOT NULL,
      client_company_id TEXT NOT NULL REFERENCES client_companies(id),
      role_id TEXT NOT NULL REFERENCES roles(id),
      worker_user_id TEXT NOT NULL REFERENCES users(id),
      created_by_user_id TEXT NOT NULL REFERENCES users(id),
      package TEXT NOT NULL,
      wage_cents INTEGER NOT NULL,
      wage_unit TEXT NOT NULL,
      state_code TEXT NOT NULL,
      policy_snapshot_json TEXT,
      start_date TEXT,
      end_date TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workflow_templates (
      id TEXT PRIMARY KEY NOT NULL,
      key TEXT NOT NULL,
      version INTEGER NOT NULL,
      title TEXT NOT NULL,
      definition_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS workflow_templates_key_version_idx
      ON workflow_templates (key, version);
    CREATE TABLE IF NOT EXISTS onboarding_cases (
      id TEXT PRIMARY KEY NOT NULL,
      hire_request_id TEXT NOT NULL UNIQUE REFERENCES hire_requests(id),
      worker_user_id TEXT NOT NULL REFERENCES users(id),
      lifecycle TEXT NOT NULL,
      template_id TEXT NOT NULL REFERENCES workflow_templates(id),
      facts_json TEXT NOT NULL,
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
      created_at INTEGER NOT NULL,
      document_title TEXT,
      issuing_authority TEXT,
      document_number_encrypted TEXT,
      expires_on TEXT
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
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY NOT NULL,
      case_id TEXT NOT NULL REFERENCES onboarding_cases(id),
      seq INTEGER NOT NULL,
      template_id TEXT NOT NULL REFERENCES workflow_templates(id),
      key TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      completed_label TEXT NOT NULL,
      description TEXT NOT NULL,
      phase TEXT NOT NULL,
      party TEXT NOT NULL,
      actors_json TEXT NOT NULL,
      assignee_kind TEXT NOT NULL,
      assignee_user_id TEXT REFERENCES users(id),
      assignee_role TEXT,
      status TEXT NOT NULL,
      blocks_go_live INTEGER NOT NULL,
      trigger TEXT,
      due_date TEXT,
      depends_on_keys_json TEXT NOT NULL,
      depends_on_task_ids_json TEXT NOT NULL,
      context_json TEXT NOT NULL,
      result_json TEXT,
      spawned_by_task_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER,
      completed_by_user_id TEXT REFERENCES users(id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS tasks_case_seq_idx ON tasks (case_id, seq);
    CREATE INDEX IF NOT EXISTS tasks_case_status_idx ON tasks (case_id, status);
    CREATE INDEX IF NOT EXISTS tasks_assignee_user_idx ON tasks (assignee_user_id, status);
    CREATE INDEX IF NOT EXISTS tasks_assignee_role_idx ON tasks (assignee_role, status);
    CREATE TABLE IF NOT EXISTS generated_documents (
      id TEXT PRIMARY KEY NOT NULL,
      case_id TEXT NOT NULL REFERENCES onboarding_cases(id),
      task_id TEXT NOT NULL REFERENCES tasks(id),
      kind TEXT NOT NULL,
      file_name TEXT NOT NULL,
      storage_path TEXT,
      metadata_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS generated_documents_case_idx ON generated_documents (case_id);
    CREATE TABLE IF NOT EXISTS document_signatures (
      id TEXT PRIMARY KEY NOT NULL,
      document_id TEXT NOT NULL REFERENCES generated_documents(id),
      case_id TEXT NOT NULL REFERENCES onboarding_cases(id),
      task_id TEXT REFERENCES tasks(id),
      party TEXT NOT NULL,
      signer_user_id TEXT NOT NULL REFERENCES users(id),
      typed_name TEXT NOT NULL,
      signed_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS document_signatures_document_idx ON document_signatures (document_id);
    CREATE TABLE IF NOT EXISTS company_documents (
      id TEXT PRIMARY KEY NOT NULL,
      client_company_id TEXT NOT NULL REFERENCES client_companies(id),
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      file_name TEXT NOT NULL,
      pdf BLOB NOT NULL,
      sha256 TEXT NOT NULL,
      pre_signature_sha256 TEXT NOT NULL,
      document_ref TEXT NOT NULL,
      case_id TEXT REFERENCES onboarding_cases(id),
      task_id TEXT REFERENCES tasks(id),
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS company_documents_company_idx ON company_documents (client_company_id, kind);
    CREATE TABLE IF NOT EXISTS company_document_signatures (
      id TEXT PRIMARY KEY NOT NULL,
      document_id TEXT NOT NULL REFERENCES company_documents(id),
      party TEXT NOT NULL,
      signer_user_id TEXT NOT NULL REFERENCES users(id),
      signer_name TEXT NOT NULL,
      signer_role TEXT NOT NULL,
      typed_name TEXT NOT NULL,
      field_key TEXT NOT NULL,
      consented_at INTEGER NOT NULL,
      consent_statement_version TEXT NOT NULL,
      signed_at INTEGER NOT NULL,
      seal TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS company_document_signatures_document_idx ON company_document_signatures (document_id);
    CREATE TABLE IF NOT EXISTS form_submissions (
      id TEXT PRIMARY KEY NOT NULL,
      case_id TEXT NOT NULL REFERENCES onboarding_cases(id),
      task_id TEXT NOT NULL REFERENCES tasks(id),
      form_type TEXT NOT NULL,
      data_json TEXT NOT NULL,
      encrypted_json TEXT,
      submitted_by_user_id TEXT NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS form_submissions_case_form_idx ON form_submissions (case_id, form_type);
    CREATE TABLE IF NOT EXISTS saved_payment_methods (
      id TEXT PRIMARY KEY NOT NULL,
      company_id TEXT NOT NULL REFERENCES client_companies(id),
      type TEXT NOT NULL CHECK (type IN ('us_bank_account')),
      bank_name TEXT NOT NULL,
      last4 TEXT NOT NULL,
      encrypted_account_number TEXT NOT NULL,
      is_default INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS saved_payment_methods_company_idx ON saved_payment_methods (company_id);
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY NOT NULL,
      number TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK (kind IN ('payroll', 'deposit')),
      company_id TEXT NOT NULL REFERENCES client_companies(id),
      hire_id TEXT NOT NULL REFERENCES hire_requests(id),
      period_index INTEGER,
      period_start TEXT,
      period_end TEXT,
      pay_date TEXT,
      tax_year INTEGER,
      index_in_tax_year INTEGER,
      days_employed INTEGER,
      period_days INTEGER,
      issue_date TEXT NOT NULL,
      due_date TEXT NOT NULL,
      currency TEXT NOT NULL,
      rate_set_id TEXT NOT NULL,
      pay_calendar_id TEXT NOT NULL,
      total_cents INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('open', 'void')),
      void_reason TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS invoices_company_due_idx ON invoices (company_id, due_date);
    CREATE INDEX IF NOT EXISTS invoices_company_status_idx ON invoices (company_id, status);
    CREATE INDEX IF NOT EXISTS invoices_hire_period_idx ON invoices (hire_id, period_index);
    CREATE INDEX IF NOT EXISTS invoices_pay_date_idx ON invoices (pay_date);
    CREATE TABLE IF NOT EXISTS invoice_lines (
      id TEXT PRIMARY KEY NOT NULL,
      invoice_id TEXT NOT NULL REFERENCES invoices(id),
      position INTEGER NOT NULL,
      code TEXT NOT NULL,
      line_group TEXT NOT NULL,
      description TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      inputs_json TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS invoice_lines_invoice_position_idx ON invoice_lines (invoice_id, position);
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY NOT NULL,
      company_id TEXT NOT NULL REFERENCES client_companies(id),
      status TEXT NOT NULL CHECK (status IN ('initiated', 'succeeded', 'failed')),
      saved_method_id TEXT REFERENCES saved_payment_methods(id),
      total_cents INTEGER NOT NULL,
      initiated_by_user_id TEXT NOT NULL REFERENCES users(id),
      initiated_at INTEGER NOT NULL,
      settled_at INTEGER,
      settled_by_user_id TEXT REFERENCES users(id),
      failure_reason TEXT,
      failed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS payments_company_initiated_idx ON payments (company_id, initiated_at);
    CREATE INDEX IF NOT EXISTS payments_status_idx ON payments (status, initiated_at);
    CREATE TABLE IF NOT EXISTS payment_allocations (
      payment_id TEXT NOT NULL REFERENCES payments(id),
      invoice_id TEXT NOT NULL REFERENCES invoices(id),
      amount_cents INTEGER NOT NULL,
      PRIMARY KEY (payment_id, invoice_id)
    );
    CREATE INDEX IF NOT EXISTS payment_allocations_invoice_idx ON payment_allocations (invoice_id);
    CREATE TABLE IF NOT EXISTS benefit_elections (
      case_id TEXT PRIMARY KEY NOT NULL REFERENCES onboarding_cases(id),
      hire_id TEXT NOT NULL REFERENCES hire_requests(id),
      enrolled INTEGER NOT NULL,
      health_tier TEXT CHECK (health_tier IN ('employee', 'employee_spouse', 'employee_children', 'family')),
      retirement_deferral_pct REAL,
      decided_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS benefit_election_versions (
      case_id TEXT NOT NULL REFERENCES onboarding_cases(id),
      version INTEGER NOT NULL,
      hire_id TEXT NOT NULL REFERENCES hire_requests(id),
      enrolled INTEGER NOT NULL,
      health_tier TEXT CHECK (health_tier IN ('employee', 'employee_spouse', 'employee_children', 'family')),
      retirement_deferral_pct REAL,
      effective_from TEXT,
      source TEXT NOT NULL CHECK (source IN ('onboarding', 'employee_change')),
      decided_by_user_id TEXT REFERENCES users(id),
      decided_at INTEGER NOT NULL,
      PRIMARY KEY (case_id, version)
    );
    CREATE INDEX IF NOT EXISTS benefit_election_versions_hire_idx ON benefit_election_versions (hire_id);
    INSERT INTO benefit_election_versions
      (case_id, version, hire_id, enrolled, health_tier, retirement_deferral_pct, effective_from, source, decided_by_user_id, decided_at)
    SELECT e.case_id, 1, e.hire_id, e.enrolled, e.health_tier, e.retirement_deferral_pct, NULL, 'onboarding', NULL, e.decided_at
    FROM benefit_elections e
    WHERE NOT EXISTS (SELECT 1 FROM benefit_election_versions v WHERE v.case_id = e.case_id);
    CREATE TABLE IF NOT EXISTS payroll_entries (
      id TEXT PRIMARY KEY NOT NULL,
      invoice_id TEXT NOT NULL UNIQUE REFERENCES invoices(id),
      case_id TEXT NOT NULL REFERENCES onboarding_cases(id),
      hire_id TEXT NOT NULL REFERENCES hire_requests(id),
      worker_user_id TEXT NOT NULL REFERENCES users(id),
      period_index INTEGER NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      pay_date TEXT NOT NULL,
      tax_year INTEGER NOT NULL,
      gross_cents INTEGER NOT NULL,
      pre_tax_deductions_cents INTEGER NOT NULL,
      taxes_cents INTEGER NOT NULL,
      post_tax_deductions_cents INTEGER NOT NULL,
      net_cents INTEGER NOT NULL,
      withholding_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS payroll_entries_hire_period_idx ON payroll_entries (hire_id, period_index);
    CREATE INDEX IF NOT EXISTS payroll_entries_worker_pay_date_idx ON payroll_entries (worker_user_id, pay_date);
  `)
  ensureColumn(sqlite, "hire_requests", "start_date", "TEXT")
  ensureColumn(sqlite, "hire_requests", "end_date", "TEXT")
  ensureColumn(sqlite, "client_companies", "csm_name", "TEXT")
  ensureColumn(sqlite, "client_companies", "csm_email", "TEXT")
  ensureColumn(sqlite, "payments", "failed_at", "INTEGER")
  ensureColumn(sqlite, "case_documents", "document_title", "TEXT")
  ensureColumn(sqlite, "case_documents", "issuing_authority", "TEXT")
  ensureColumn(sqlite, "case_documents", "document_number_encrypted", "TEXT")
  ensureColumn(sqlite, "case_documents", "expires_on", "TEXT")
  // Failed payments used to keep their failure time in settled_at.
  sqlite.exec(
    "UPDATE payments SET failed_at = settled_at, settled_at = NULL WHERE status = 'failed' AND failed_at IS NULL AND settled_at IS NOT NULL",
  )
}

/** Additive column for databases created before the column existed (no migration history, data-model §7). */
function ensureColumn(
  sqlite: Database.Database,
  table: string,
  column: string,
  ddl: string
): void {
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!cols.some((c) => c.name === column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`)
  }
}

export function createDb(
  dbPath: string,
  options: { forceSeed: boolean; /** Open without the synchronous seed, for `seedDemo`. Default true. */ seed?: boolean }
) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const sqlite = new Database(dbPath)
  sqlite.pragma("journal_mode = WAL")
  sqlite.pragma("foreign_keys = ON")
  applySchema(sqlite)
  const db = drizzle(sqlite, { schema })
  ensureWorkflowTemplates(db)
  if (options.seed !== false) seedIfEmpty(db, { force: options.forceSeed })
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
