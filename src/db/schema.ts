/**
 * EOR demo persistence schema. Owns table shapes for tenancy, personas, orders, the task graph
 * (workflow templates, tasks, generated documents, signatures, form submissions), billing
 * (invoices, payments, saved payment methods, benefit elections, payroll entries),
 * documents and the timeline.
 *
 * This module does not apply workflow rules, wage rules, or document-byte ACL; the domain does.
 */
import { sql } from "drizzle-orm"
import {
  blob,
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

export const USER_ROLES = [
  "client_hr",
  "onboarding_specialist",
  "finance",
  "worker",
] as const
export type UserRole = (typeof USER_ROLES)[number]

export const AGREEMENT_STATUSES = ["draft", "signed"] as const
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number]

export const WAGE_UNITS = ["hourly", "monthly", "annual"] as const
export type WageUnit = (typeof WAGE_UNITS)[number]

export const BENEFIT_PACKAGES = ["standard", "premium"] as const
export type BenefitPackage = (typeof BENEFIT_PACKAGES)[number]

/** Explicit case lifecycle; onboarding progress is derived from the case's tasks. */
export const CASE_LIFECYCLES = ["open", "cancelled", "terminated"] as const
export type CaseLifecycle = (typeof CASE_LIFECYCLES)[number]

export const TASK_STATUSES = ["blocked", "ready", "done", "rejected", "skipped", "cancelled"] as const
export const TASK_PARTIES = ["client", "worker", "specialist", "finance", "system"] as const
export const ASSIGNEE_KINDS = ["user", "role", "system"] as const
export const INVOICE_KINDS = ["payroll", "deposit"] as const
export const INVOICE_STORED_STATUSES = ["open", "void"] as const
export const PAYMENT_STATUSES = ["initiated", "succeeded", "failed"] as const
export const PAYMENT_METHOD_TYPES = ["us_bank_account"] as const
export const HEALTH_TIER_VALUES = ["employee", "employee_spouse", "employee_children", "family"] as const

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
  /** The client's single point of contact at the provider (customer success). */
  csmName: text("csm_name"),
  csmEmail: text("csm_email"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
})

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    role: text("role", { enum: USER_ROLES }).notNull(),
    displayName: text("display_name").notNull(),
    email: text("email").notNull().unique(),
    clientCompanyId: text("client_company_id").references(
      () => clientCompanies.id
    ),
    providerId: text("provider_id").references(() => providers.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check(
      "users_tenant_link",
      sql`(
        (${table.role} IN ('client_hr', 'worker') AND ${table.clientCompanyId} IS NOT NULL AND ${table.providerId} IS NULL)
        OR
        (${table.role} IN ('onboarding_specialist', 'finance') AND ${table.providerId} IS NOT NULL AND ${table.clientCompanyId} IS NULL)
      )`
    ),
  ]
)

export const clientAgreements = sqliteTable(
  "client_agreements",
  {
    id: text("id").primaryKey(),
    clientCompanyId: text("client_company_id")
      .notNull()
      .unique()
      .references(() => clientCompanies.id),
    /** Markup as percent points (15 = 15%). */
    markupPct: integer("markup_pct").notNull(),
    status: text("status", { enum: AGREEMENT_STATUSES }).notNull(),
    signedAt: integer("signed_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check(
      "client_agreements_signed_at",
      sql`(
        (${table.status} = 'signed' AND ${table.signedAt} IS NOT NULL)
        OR
        (${table.status} = 'draft' AND ${table.signedAt} IS NULL)
      )`
    ),
  ]
)

/**
 * A job role defined per client company. A person's title is their role's
 * name; there is no free-text title. Names are unique per company, ignoring case.
 */
export const roles = sqliteTable(
  "roles",
  {
    id: text("id").primaryKey(),
    clientCompanyId: text("client_company_id")
      .notNull()
      .references(() => clientCompanies.id),
    name: text("name").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("roles_company_name_idx").on(table.clientCompanyId, sql`lower(${table.name})`),
  ]
)

/** A versioned workflow definition (JSON). Rows are immutable once a case uses them. */
export const workflowTemplates = sqliteTable(
  "workflow_templates",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    definitionJson: text("definition_json").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("workflow_templates_key_version_idx").on(table.key, table.version)]
)

export const hireRequests = sqliteTable("hire_requests", {
  id: text("id").primaryKey(),
  clientCompanyId: text("client_company_id")
    .notNull()
    .references(() => clientCompanies.id),
  roleId: text("role_id")
    .notNull()
    .references(() => roles.id),
  workerUserId: text("worker_user_id")
    .notNull()
    .references(() => users.id),
  createdByUserId: text("created_by_user_id")
    .notNull()
    .references(() => users.id),
  package: text("package", { enum: BENEFIT_PACKAGES }).notNull(),
  wageCents: integer("wage_cents").notNull(),
  wageUnit: text("wage_unit", { enum: WAGE_UNITS }).notNull(),
  stateCode: text("state_code").notNull(),
  /** PolicySnapshotV1 JSON, frozen when the order is created; write-once. */
  policySnapshotJson: text("policy_snapshot_json"),
  /** Requested first day, ISO `YYYY-MM-DD`. Drives the at-risk projection (domain §9.1). */
  startDate: text("start_date"),
  /** Inclusive last day of a fixed term, ISO `YYYY-MM-DD`; null = indefinite (domain §10). */
  endDate: text("end_date"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
})

/**
 * One case per order. `lifecycle` is the only stored status; onboarding progress is derived from
 * the case's tasks. `factsJson` holds the order facts the workflow conditions read.
 */
export const onboardingCases = sqliteTable("onboarding_cases", {
  id: text("id").primaryKey(),
  hireRequestId: text("hire_request_id")
    .notNull()
    .unique()
    .references(() => hireRequests.id),
  workerUserId: text("worker_user_id")
    .notNull()
    .references(() => users.id),
  lifecycle: text("lifecycle", { enum: CASE_LIFECYCLES }).notNull(),
  /** The workflow template version the tasks were instantiated from. */
  templateId: text("template_id")
    .notNull()
    .references(() => workflowTemplates.id),
  factsJson: text("facts_json").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
})

export const caseDocuments = sqliteTable(
  "case_documents",
  {
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
    /** I-9 identity uploads: what the employee entered. All four are null on uploads made before details were asked for. */
    documentTitle: text("document_title"),
    issuingAuthority: text("issuing_authority"),
    /** AES-GCM token (`encryptSecret`, AAD `case_documents:<id>`). Never log, never put in a payload. */
    documentNumberEncrypted: text("document_number_encrypted"),
    /** `YYYY-MM-DD`; null when the document has no expiration date. */
    expiresOn: text("expires_on"),
  },
  (table) => [
    index("case_documents_case_kind_created_idx").on(
      table.caseId,
      table.kind,
      table.createdAt
    ),
  ]
)

export const caseEvents = sqliteTable(
  "case_events",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => onboardingCases.id),
    actorUserId: text("actor_user_id").references(() => users.id),
    type: text("type").notNull(),
    payloadJson: text("payload_json"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("case_events_case_created_idx").on(table.caseId, table.createdAt),
  ]
)

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => onboardingCases.id),
    /** Creation order within the case; the latest instance of a key has the highest seq. */
    seq: integer("seq").notNull(),
    templateId: text("template_id")
      .notNull()
      .references(() => workflowTemplates.id),
    key: text("key").notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    completedLabel: text("completed_label").notNull(),
    description: text("description").notNull(),
    phase: text("phase").notNull(),
    party: text("party", { enum: TASK_PARTIES }).notNull(),
    actorsJson: text("actors_json").notNull(),
    assigneeKind: text("assignee_kind", { enum: ASSIGNEE_KINDS }).notNull(),
    assigneeUserId: text("assignee_user_id").references(() => users.id),
    assigneeRole: text("assignee_role", { enum: USER_ROLES }),
    status: text("status", { enum: TASK_STATUSES }).notNull(),
    blocksGoLive: integer("blocks_go_live", { mode: "boolean" }).notNull(),
    trigger: text("trigger"),
    dueDate: text("due_date"),
    dependsOnKeysJson: text("depends_on_keys_json").notNull(),
    dependsOnTaskIdsJson: text("depends_on_task_ids_json").notNull(),
    contextJson: text("context_json").notNull(),
    resultJson: text("result_json"),
    spawnedByTaskId: text("spawned_by_task_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    completedByUserId: text("completed_by_user_id").references(() => users.id),
  },
  (table) => [
    uniqueIndex("tasks_case_seq_idx").on(table.caseId, table.seq),
    index("tasks_case_status_idx").on(table.caseId, table.status),
    index("tasks_assignee_user_idx").on(table.assigneeUserId, table.status),
    index("tasks_assignee_role_idx").on(table.assigneeRole, table.status),
  ]
)

/** Metadata of a document the system generated (bytes are the DocumentGenerator's concern). */
export const generatedDocuments = sqliteTable(
  "generated_documents",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => onboardingCases.id),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    kind: text("kind").notNull(),
    fileName: text("file_name").notNull(),
    /** Null until a real generator stores bytes. */
    storagePath: text("storage_path"),
    metadataJson: text("metadata_json").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("generated_documents_case_idx").on(table.caseId)]
)

export const documentSignatures = sqliteTable(
  "document_signatures",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => generatedDocuments.id),
    caseId: text("case_id")
      .notNull()
      .references(() => onboardingCases.id),
    taskId: text("task_id").references(() => tasks.id),
    party: text("party", { enum: TASK_PARTIES }).notNull(),
    signerUserId: text("signer_user_id")
      .notNull()
      .references(() => users.id),
    typedName: text("typed_name").notNull(),
    signedAt: integer("signed_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("document_signatures_document_idx").on(table.documentId)]
)

/**
 * A signed company-level document (the master EOR agreement) with its bytes. Case documents
 * (`generated_documents`) always belong to a case and task; this one exists before any order does.
 * `sha256` is the hash of `pdf` as stored and is checked on every download.
 */
export const companyDocuments = sqliteTable(
  "company_documents",
  {
    id: text("id").primaryKey(),
    clientCompanyId: text("client_company_id")
      .notNull()
      .references(() => clientCompanies.id),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    fileName: text("file_name").notNull(),
    pdf: blob("pdf", { mode: "buffer" }).notNull(),
    sha256: text("sha256").notNull(),
    preSignatureSha256: text("pre_signature_sha256").notNull(),
    /** The `NW-…` id printed on the signature certificates. */
    documentRef: text("document_ref").notNull(),
    /** Set when the document was signed by completing an `accept_agreement` task. */
    caseId: text("case_id").references(() => onboardingCases.id),
    taskId: text("task_id").references(() => tasks.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("company_documents_company_idx").on(table.clientCompanyId, table.kind)]
)

/** Who signed a company document, when, and that they consented to sign electronically. */
export const companyDocumentSignatures = sqliteTable(
  "company_document_signatures",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => companyDocuments.id),
    party: text("party", { enum: TASK_PARTIES }).notNull(),
    signerUserId: text("signer_user_id")
      .notNull()
      .references(() => users.id),
    signerName: text("signer_name").notNull(),
    signerRole: text("signer_role").notNull(),
    typedName: text("typed_name").notNull(),
    fieldKey: text("field_key").notNull(),
    consentedAt: integer("consented_at", { mode: "timestamp_ms" }).notNull(),
    consentStatementVersion: text("consent_statement_version").notNull(),
    signedAt: integer("signed_at", { mode: "timestamp_ms" }).notNull(),
    /** HMAC seal of the signature record inside the PDF. */
    seal: text("seal").notNull(),
  },
  (table) => [index("company_document_signatures_document_idx").on(table.documentId)]
)

/** A submitted form. `dataJson` is plain; `encryptedJson` holds sensitive fields (AES-256-GCM). */
export const formSubmissions = sqliteTable(
  "form_submissions",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => onboardingCases.id),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    formType: text("form_type").notNull(),
    dataJson: text("data_json").notNull(),
    encryptedJson: text("encrypted_json"),
    submittedByUserId: text("submitted_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("form_submissions_case_form_idx").on(table.caseId, table.formType)]
)

/** A client company's saved bank account (faked ACH; seeded only). The full number is encrypted. */
export const savedPaymentMethods = sqliteTable(
  "saved_payment_methods",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => clientCompanies.id),
    type: text("type", { enum: PAYMENT_METHOD_TYPES }).notNull(),
    bankName: text("bank_name").notNull(),
    last4: text("last4").notNull(),
    encryptedAccountNumber: text("encrypted_account_number").notNull(),
    isDefault: integer("is_default", { mode: "boolean" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("saved_payment_methods_company_idx").on(table.companyId)]
)

/**
 * One invoice. The id is deterministic (`payroll:<hireId>:<periodIndex>` / `deposit:<hireId>`), so
 * the billing run is idempotent. Only `open` and `void` are stored; paid, processing and overdue
 * are derived from payments and dates (billing-and-invoicing.md §6).
 */
export const invoices = sqliteTable(
  "invoices",
  {
    id: text("id").primaryKey(),
    number: text("number").notNull().unique(),
    kind: text("kind", { enum: INVOICE_KINDS }).notNull(),
    companyId: text("company_id")
      .notNull()
      .references(() => clientCompanies.id),
    hireId: text("hire_id")
      .notNull()
      .references(() => hireRequests.id),
    periodIndex: integer("period_index"),
    periodStart: text("period_start"),
    periodEnd: text("period_end"),
    payDate: text("pay_date"),
    taxYear: integer("tax_year"),
    indexInTaxYear: integer("index_in_tax_year"),
    daysEmployed: integer("days_employed"),
    periodDays: integer("period_days"),
    issueDate: text("issue_date").notNull(),
    dueDate: text("due_date").notNull(),
    currency: text("currency").notNull(),
    rateSetId: text("rate_set_id").notNull(),
    payCalendarId: text("pay_calendar_id").notNull(),
    totalCents: integer("total_cents").notNull(),
    status: text("status", { enum: INVOICE_STORED_STATUSES }).notNull(),
    voidReason: text("void_reason"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("invoices_company_due_idx").on(table.companyId, table.dueDate),
    index("invoices_company_status_idx").on(table.companyId, table.status),
    index("invoices_hire_period_idx").on(table.hireId, table.periodIndex),
    index("invoices_pay_date_idx").on(table.payDate),
  ]
)

/** A line of an invoice with the inputs it was calculated from, so it can be recomputed. */
export const invoiceLines = sqliteTable(
  "invoice_lines",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id),
    position: integer("position").notNull(),
    code: text("code").notNull(),
    lineGroup: text("line_group").notNull(),
    description: text("description").notNull(),
    amountCents: integer("amount_cents").notNull(),
    inputsJson: text("inputs_json").notNull(),
  },
  (table) => [uniqueIndex("invoice_lines_invoice_position_idx").on(table.invoiceId, table.position)]
)

/**
 * A payment (faked ACH). `settled_at` is set only when it succeeds and `failed_at` only when it
 * fails, so a failed payment never has a settled date; `settled_by_user_id` is whoever resolved it
 * (settled or failed).
 */
export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => clientCompanies.id),
    status: text("status", { enum: PAYMENT_STATUSES }).notNull(),
    savedMethodId: text("saved_method_id").references(() => savedPaymentMethods.id),
    totalCents: integer("total_cents").notNull(),
    initiatedByUserId: text("initiated_by_user_id")
      .notNull()
      .references(() => users.id),
    initiatedAt: integer("initiated_at", { mode: "timestamp_ms" }).notNull(),
    settledAt: integer("settled_at", { mode: "timestamp_ms" }),
    failedAt: integer("failed_at", { mode: "timestamp_ms" }),
    settledByUserId: text("settled_by_user_id").references(() => users.id),
    failureReason: text("failure_reason"),
  },
  (table) => [
    index("payments_company_initiated_idx").on(table.companyId, table.initiatedAt),
    index("payments_status_idx").on(table.status, table.initiatedAt),
  ]
)

/** How much of each invoice a payment covers (always the whole invoice today). */
export const paymentAllocations = sqliteTable(
  "payment_allocations",
  {
    paymentId: text("payment_id")
      .notNull()
      .references(() => payments.id),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id),
    amountCents: integer("amount_cents").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.paymentId, table.invoiceId] }),
    index("payment_allocations_invoice_idx").on(table.invoiceId),
  ]
)

/** The worker's benefits choice for a case, written when `benefits_decision` completes. */
export const benefitElections = sqliteTable("benefit_elections", {
  caseId: text("case_id")
    .primaryKey()
    .references(() => onboardingCases.id),
  hireId: text("hire_id")
    .notNull()
    .references(() => hireRequests.id),
  enrolled: integer("enrolled", { mode: "boolean" }).notNull(),
  healthTier: text("health_tier", { enum: HEALTH_TIER_VALUES }),
  retirementDeferralPct: real("retirement_deferral_pct"),
  decidedAt: integer("decided_at", { mode: "timestamp_ms" }).notNull(),
})

export const BENEFIT_ELECTION_SOURCES = ["onboarding", "employee_change"] as const
export type BenefitElectionSource = (typeof BENEFIT_ELECTION_SOURCES)[number]

/**
 * Every election a case has recorded, append-only. Payroll and invoices read this table: a period
 * is billed with the latest version whose `effectiveFrom` (first day of a pay period, null = from
 * the start) is on or before the period's first day. `benefit_elections` keeps the latest version
 * as the case's current decision for the onboarding screens.
 */
export const benefitElectionVersions = sqliteTable(
  "benefit_election_versions",
  {
    caseId: text("case_id")
      .notNull()
      .references(() => onboardingCases.id),
    version: integer("version").notNull(),
    hireId: text("hire_id")
      .notNull()
      .references(() => hireRequests.id),
    enrolled: integer("enrolled", { mode: "boolean" }).notNull(),
    healthTier: text("health_tier", { enum: HEALTH_TIER_VALUES }),
    retirementDeferralPct: real("retirement_deferral_pct"),
    effectiveFrom: text("effective_from"),
    source: text("source", { enum: BENEFIT_ELECTION_SOURCES }).notNull(),
    decidedByUserId: text("decided_by_user_id").references(() => users.id),
    decidedAt: integer("decided_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.caseId, table.version] }),
    index("benefit_election_versions_hire_idx").on(table.hireId),
  ]
)

/**
 * One pay slip: a worker's gross-to-net for one pay period, created in the same transaction as
 * the payroll invoice of that period. `withholdingJson` is the full `computeWithholding` output.
 */
export const payrollEntries = sqliteTable(
  "payroll_entries",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id")
      .notNull()
      .unique()
      .references(() => invoices.id),
    caseId: text("case_id")
      .notNull()
      .references(() => onboardingCases.id),
    hireId: text("hire_id")
      .notNull()
      .references(() => hireRequests.id),
    workerUserId: text("worker_user_id")
      .notNull()
      .references(() => users.id),
    periodIndex: integer("period_index").notNull(),
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end").notNull(),
    payDate: text("pay_date").notNull(),
    taxYear: integer("tax_year").notNull(),
    grossCents: integer("gross_cents").notNull(),
    preTaxDeductionsCents: integer("pre_tax_deductions_cents").notNull(),
    taxesCents: integer("taxes_cents").notNull(),
    postTaxDeductionsCents: integer("post_tax_deductions_cents").notNull(),
    netCents: integer("net_cents").notNull(),
    withholdingJson: text("withholding_json").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("payroll_entries_hire_period_idx").on(table.hireId, table.periodIndex),
    index("payroll_entries_worker_pay_date_idx").on(table.workerUserId, table.payDate),
  ]
)
