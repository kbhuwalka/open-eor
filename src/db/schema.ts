/**
 * EOR demo persistence schema (Issue #11). Owns table shapes for tenancy,
 * personas, hire/onboarding, documents, timeline, and worker checklist stubs.
 * Does not own state-machine transitions or wage rules — those land in #12.
 *
 * ACL note for later Issues: document bytes are never served to `client_hr`
 * (eor_reviewer + eor_ops read OK). Helpers live in `src/auth/acl.ts`.
 */
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const USER_ROLES = [
  "client_hr",
  "worker",
  "eor_ops",
  "eor_reviewer",
] as const
export type UserRole = (typeof USER_ROLES)[number]

export const AGREEMENT_STATUSES = ["draft", "signed"] as const
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number]

export const WAGE_UNITS = ["hourly", "salary"] as const
export type WageUnit = (typeof WAGE_UNITS)[number]

export const BENEFIT_PACKAGES = ["standard", "plus"] as const
export type BenefitPackage = (typeof BENEFIT_PACKAGES)[number]

export const HIRE_STATUSES = [
  "draft",
  "submitted",
  "active",
  "closed",
] as const
export type HireStatus = (typeof HIRE_STATUSES)[number]

/** Case states — transitions enforced in domain (#12), stored as text here. */
export const CASE_STATES = [
  "draft_hire",
  "awaiting_agreement",
  "pending_eor_setup",
  "awaiting_worker",
  "pending_review",
  "changes_requested",
  "work_auth_approved",
  "ready_for_payroll",
] as const
export type CaseState = (typeof CASE_STATES)[number]

export const DOCUMENT_KINDS = [
  "list_a",
  "list_b",
  "list_c",
  "w4",
  "other",
] as const
export type DocumentKind = (typeof DOCUMENT_KINDS)[number]

export const providers = sqliteTable("providers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
})

export const clientCompanies = sqliteTable("client_companies", {
  id: text("id").primaryKey(),
  providerId: text("provider_id")
    .notNull()
    .references(() => providers.id),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
})

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  role: text("role", { enum: USER_ROLES }).notNull(),
  displayName: text("display_name").notNull(),
  email: text("email").notNull().unique(),
  clientCompanyId: text("client_company_id").references(() => clientCompanies.id),
  providerId: text("provider_id").references(() => providers.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
})

export const clientAgreements = sqliteTable("client_agreements", {
  id: text("id").primaryKey(),
  clientCompanyId: text("client_company_id")
    .notNull()
    .references(() => clientCompanies.id),
  /** Markup as percent points (e.g. 15 = 15%). */
  markupPct: integer("markup_pct").notNull(),
  status: text("status", { enum: AGREEMENT_STATUSES }).notNull(),
  signedAt: integer("signed_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
})

export const roleTemplates = sqliteTable("role_templates", {
  id: text("id").primaryKey(),
  clientCompanyId: text("client_company_id")
    .notNull()
    .references(() => clientCompanies.id),
  title: text("title").notNull(),
  workerType: text("worker_type").notNull(),
  wageCents: integer("wage_cents").notNull(),
  wageUnit: text("wage_unit", { enum: WAGE_UNITS }).notNull(),
  stateCode: text("state_code").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
})

export const hireRequests = sqliteTable("hire_requests", {
  id: text("id").primaryKey(),
  clientCompanyId: text("client_company_id")
    .notNull()
    .references(() => clientCompanies.id),
  roleTemplateId: text("role_template_id").references(() => roleTemplates.id),
  workerUserId: text("worker_user_id")
    .notNull()
    .references(() => users.id),
  createdByUserId: text("created_by_user_id")
    .notNull()
    .references(() => users.id),
  package: text("package", { enum: BENEFIT_PACKAGES }).notNull(),
  jobTitle: text("job_title").notNull(),
  wageCents: integer("wage_cents").notNull(),
  wageUnit: text("wage_unit", { enum: WAGE_UNITS }).notNull(),
  stateCode: text("state_code").notNull(),
  /** Filled by domain at hire submit (#12); may be null in seed. */
  policySnapshotJson: text("policy_snapshot_json"),
  status: text("status", { enum: HIRE_STATUSES }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
})

export const onboardingCases = sqliteTable("onboarding_cases", {
  id: text("id").primaryKey(),
  hireRequestId: text("hire_request_id")
    .notNull()
    .references(() => hireRequests.id),
  workerUserId: text("worker_user_id")
    .notNull()
    .references(() => users.id),
  state: text("state", { enum: CASE_STATES }).notNull(),
  assignedOpsUserId: text("assigned_ops_user_id").references(() => users.id),
  assignedReviewerUserId: text("assigned_reviewer_user_id").references(
    () => users.id
  ),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
})

export const caseDocuments = sqliteTable("case_documents", {
  id: text("id").primaryKey(),
  caseId: text("case_id")
    .notNull()
    .references(() => onboardingCases.id),
  kind: text("kind", { enum: DOCUMENT_KINDS }).notNull(),
  storagePath: text("storage_path").notNull(),
  fileName: text("file_name").notNull(),
  uploadedBy: text("uploaded_by")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
})

export const caseEvents = sqliteTable("case_events", {
  id: text("id").primaryKey(),
  caseId: text("case_id")
    .notNull()
    .references(() => onboardingCases.id),
  actorUserId: text("actor_user_id").references(() => users.id),
  type: text("type").notNull(),
  payloadJson: text("payload_json"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
})

/** Worker checklist stubs for later portal Issues. */
export const workerProfiles = sqliteTable("worker_profiles", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id)
    .unique(),
  caseId: text("case_id").references(() => onboardingCases.id),
  personalJson: text("personal_json"),
  w4Json: text("w4_json"),
  bankJson: text("bank_json"),
  benefitsAcked: integer("benefits_acked", { mode: "boolean" })
    .notNull()
    .default(false),
  i9AttestationJson: text("i9_attestation_json"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
})
