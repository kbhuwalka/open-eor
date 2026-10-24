# Data model

## 1. Purpose and assumptions

This spec owns persistence: tables, columns, foreign keys, enum literals, JSON column shapes, and deterministic seed ids. It is implemented with Drizzle ORM on SQLite in `src/db/schema.ts` . Where code and this document differ, this document wins until a PR amends it.

Assumptions:

- SQLite file `data/eor.sqlite` (gitignored). Schema applied on first open (`src/db/client.ts`); seed runs when `users` is empty; `pnpm db:seed` wipes and reseeds (`FORCE_SEED=1`). A database whose `PRAGMA user_version` is older than `SCHEMA_VERSION` (`src/db/client.ts`, now 3: invoices, payments and pay slips replaced the deposit ledger) is dropped and rebuilt when opened; there is no migration history.
- All primary keys are `text` with stable, human-readable ids (`user_worker`, `case_pending_1`). New rows use `<prefix>_<nanoid or ulid>`.
- Timestamps are `integer` epoch milliseconds (`mode: "timestamp_ms"`), UTC.
- Enum columns are `text` with Drizzle `enum` constraints. Enum **values** are owned by the specs named in the Enums table; this document only stores them.

## 2. Enums

| Constant | Values | Owning spec |
| --- | --- | --- |
| `USER_ROLES` | `client_hr`, `onboarding_specialist`, `finance`, `worker` | [acl.md](./acl.md) §2 |
| `CASE_LIFECYCLES` | `open`, `cancelled`, `terminated` | [case-state-machine.md](./case-state-machine.md) §2 |
| `TASK_STATUSES` | `blocked`, `ready`, `done`, `rejected`, `skipped`, `cancelled` | [tasks-and-workflow.md](./tasks-and-workflow.md) §2.2 |
| `TASK_PARTIES` | `client`, `worker`, `specialist`, `finance`, `system` | [tasks-and-workflow.md](./tasks-and-workflow.md) §2.1 |
| `ASSIGNEE_KINDS` | `user`, `role`, `system` | [tasks-and-workflow.md](./tasks-and-workflow.md) §2.1 |
| `INVOICE_KINDS` | `payroll`, `deposit` | [billing-and-invoicing.md](./billing-and-invoicing.md) §6 |
| `INVOICE_STORED_STATUSES` | `open`, `void` (paid, processing and overdue are derived) | [billing-and-invoicing.md](./billing-and-invoicing.md) §8 |
| `PAYMENT_STATUSES` | `initiated`, `succeeded`, `failed` | [billing-and-invoicing.md](./billing-and-invoicing.md) §8 |
| `PAYMENT_METHOD_TYPES` | `us_bank_account` (faked ACH) | [billing-and-invoicing.md](./billing-and-invoicing.md) §12 |
| `HEALTH_TIER_VALUES` | `employee`, `employee_spouse`, `employee_children`, `family` | [billing-and-invoicing.md](./billing-and-invoicing.md) §4 |
| `AGREEMENT_STATUSES` | `draft`, `signed` | [domain.md](./domain.md) §3 |
| `WAGE_UNITS` | `hourly`, `monthly`, `annual` | [domain.md](./domain.md) §7 |
| `BENEFIT_PACKAGES` | `standard`, `premium` | [domain.md](./domain.md) §4 |
| `DOCUMENT_KINDS` | `list_a`, `list_b`, `list_c`, `w4`, `other` | [domain.md](./domain.md) §5 |
| `CASE_EVENT_TYPES` | see [domain.md](./domain.md) §9 | [domain.md](./domain.md) §9 |
| `REJECT_REASON_CODES` | `DOC_ILLEGIBLE`, `DOC_EXPIRED`, `DOC_MISMATCH`, `WRONG_LIST_COMBO`, `OTHER` | [domain.md](./domain.md) §5 |

The domain owns these constants (`src/domain/types.ts`, `src/domain/tasks/types.ts`). `src/db/schema.ts` repeats the literals so it stays free of domain imports, and a schema test asserts they are equal.

## 3. Entity relationship

```
providers 1──* client_companies 1──* users (client_hr, worker)
providers 1──* users (onboarding_specialist, finance)
client_companies 1──1 client_agreements
client_companies 1──* roles
client_companies 1──* hire_requests *──1 users (worker)   [+ created_by, role]
hire_requests   1──1 onboarding_cases *──1 users (worker) *──1 workflow_templates
onboarding_cases 1──* tasks *──1 workflow_templates   [+ assignee user?, completed_by?]
onboarding_cases 1──* case_documents *──1 users (uploaded_by)
onboarding_cases 1──* case_events    *──1 users? (actor)
client_companies 1──* saved_payment_methods
client_companies 1──* invoices 1──* invoice_lines;  hire_requests 1──* invoices
client_companies 1──* payments *──1 saved_payment_methods;  payments 1──* payment_allocations *──1 invoices
onboarding_cases 1──1 benefit_elections;  onboarding_cases 1──* benefit_election_versions
invoices 1──1 payroll_entries *──1 onboarding_cases *──1 users (worker)
onboarding_cases 1──* generated_documents *──1 tasks;  generated_documents 1──* document_signatures
onboarding_cases 1──* form_submissions *──1 tasks
```

## 4. Tables

Column names are snake_case in SQL; Drizzle property names are camelCase equivalents.

### `providers`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | text PK | no | |
| `name` | text | no | |
| `created_at` | ts | no | |

### `client_companies`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | text PK | no | |
| `provider_id` | text FK → `providers.id` | no | |
| `name` | text | no | |
| `csm_name` | text | yes | the client's single point of contact at the provider ([acl.md](./acl.md) I4) |
| `csm_email` | text | yes | |
| `created_at` | ts | no | |

### `users`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | text PK | no | |
| `role` | enum `USER_ROLES` | no | |
| `display_name` | text | no | |
| `email` | text unique | no | display only; not a login |
| `client_company_id` | text FK → `client_companies.id` | yes | set for `client_hr`, `worker` |
| `provider_id` | text FK → `providers.id` | yes | set for `onboarding_specialist`, `finance` |
| `created_at` | ts | no | |

Invariant U1: exactly one of `client_company_id` / `provider_id` is non-null, matching the role's tenant link ([acl.md](./acl.md) §2).

### `client_agreements`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | text PK | no | |
| `client_company_id` | text FK | no | one row per client (unique) |
| `markup_pct` | integer | no | percent points, `15` = 15% |
| `status` | enum `AGREEMENT_STATUSES` | no | |
| `signed_at` | ts | yes | non-null iff `status = signed` |
| `created_at` | ts | no | |

### `roles`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | text PK | no | |
| `client_company_id` | text FK | no | |
| `name` | text | no | unique per company, ignoring case (`roles_company_name_idx`) |
| `created_at` | ts | no | |

### `hire_requests`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | text PK | no | |
| `client_company_id` | text FK | no | |
| `role_id` | text FK → `roles.id` | no | the person's title is this role's name; restrict-on-delete |
| `worker_user_id` | text FK → `users.id` | no | role must be `worker` |
| `created_by_user_id` | text FK → `users.id` | no | role must be `client_hr` |
| `package` | enum `BENEFIT_PACKAGES` | no | |
| `wage_cents` | integer | no | cents per `wage_unit` (hour, month or year) |
| `wage_unit` | enum `WAGE_UNITS` | no | |
| `state_code` | text | no | |
| `policy_snapshot_json` | text (JSON `PolicySnapshotV1`) | yes | frozen when the order is created; write-once |
| `start_date` | text (`YYYY-MM-DD`) | yes | requested first day; due dates, go-live and at-risk derive from it ([tasks-and-workflow.md](./tasks-and-workflow.md) §5.5, §8) |
| `end_date` | text (`YYYY-MM-DD`) | yes | inclusive last day of a fixed term; `null` = indefinite ([domain.md](./domain.md) §2.2). A live person past it reads as Inactive; reactivation can renew it. `PolicySnapshotV1.endDate` freezes the term chosen at hire |
| `created_at` | ts | no | |

### `onboarding_cases`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | text PK | no | |
| `hire_request_id` | text FK (unique) | no | 1:1 |
| `worker_user_id` | text FK → `users.id` | no | denormalized from hire for ACL |
| `lifecycle` | enum `CASE_LIFECYCLES` | no | the only stored status; onboarding progress is derived from `tasks` |
| `template_id` | text FK → `workflow_templates.id` | no | the template version the tasks were instantiated from |
| `facts_json` | text (JSON `Facts`) | no | order facts frozen at creation (re-frozen on restart), read by workflow conditions ([tasks-and-workflow.md](./tasks-and-workflow.md) §4) |
| `created_at` | ts | no | |
| `updated_at` | ts | no | bumped on every lifecycle change and task mutation |

### `case_documents` (append-only)

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | text PK | no | |
| `case_id` | text FK | no | |
| `kind` | enum `DOCUMENT_KINDS` | no | |
| `storage_path` | text | no | relative to repo root, under `data/uploads/` ([architecture.md](./architecture.md) §6) |
| `file_name` | text | no | original name, sanitized |
| `uploaded_by` | text FK → `users.id` | no | |
| `created_at` | ts | no | |

Active document per `(case_id, kind)` = max `created_at`, and a new list document supersedes the other I-9 list's active documents ([domain.md](./domain.md) W4, W4a). Suggested index: `(case_id, kind, created_at)`.

### `case_events` (append-only)

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | text PK | no | |
| `case_id` | text FK | no | |
| `actor_user_id` | text FK → `users.id` | yes | null only for system/seed |
| `type` | text (one of `CASE_EVENT_TYPES`) | no | |
| `payload_json` | text (JSON per [domain.md](./domain.md) §9) | yes | |
| `created_at` | ts | no | |

Suggested index: `(case_id, created_at)`.

### `workflow_templates`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | text PK | no | `<key>@<version>` (`templateRowId`) |
| `key` | text | no | e.g. `us_eor_onboarding` |
| `version` | integer | no | unique with `key` (`workflow_templates_key_version_idx`) |
| `title` | text | no | |
| `definition_json` | text (JSON `WorkflowTemplate` without `key`/`version`) | no | phases, stages and task definitions ([tasks-and-workflow.md](./tasks-and-workflow.md) §3); `stages` is absent in version 1 |
| `created_at` | ts | no | |

Rows are inserted by `ensureWorkflowTemplates` at startup. A version used by a case is immutable: a changed definition for it is ignored, and a new behaviour ships as a new version. The template is validated on load.

### `tasks`

One row per task instance ([tasks-and-workflow.md](./tasks-and-workflow.md) §2.3).

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | text PK | no | |
| `case_id` | text FK | no | |
| `seq` | integer | no | creation order within the case; unique with `case_id` (`tasks_case_seq_idx`); the latest instance of a key has the highest `seq` |
| `template_id` | text FK → `workflow_templates.id` | no | |
| `key` | text | no | definition key; rework instances share it |
| `type` | text | no | handler id |
| `title`, `completed_label`, `description` | text | no | copied from the definition |
| `phase` | text | no | |
| `party` | enum `TASK_PARTIES` | no | owner |
| `actors_json` | text (JSON `TaskParty[]`) | no | who may complete it; authorization uses this, not the assignee |
| `assignee_kind` | enum `ASSIGNEE_KINDS` | no | |
| `assignee_user_id` | text FK → `users.id` | yes | set when `assignee_kind = user` |
| `assignee_role` | enum `USER_ROLES` | yes | set when `assignee_kind = role` (queue) |
| `status` | enum `TASK_STATUSES` | no | |
| `blocks_go_live` | integer boolean | no | |
| `trigger` | text | yes | `go_live` for the milestone task |
| `due_date` | text (`YYYY-MM-DD`) | yes | |
| `depends_on_keys_json` | text (JSON `string[]`) | no | |
| `depends_on_task_ids_json` | text (JSON `string[]`) | no | explicit instances (rework) |
| `context_json` | text (JSON object) | no | facts copied in at creation |
| `result_json` | text (JSON object) | yes | handler result; never sensitive data |
| `spawned_by_task_id` | text | yes | |
| `created_at`, `updated_at` | ts | no | |
| `completed_at` | ts | yes | |
| `completed_by_user_id` | text FK → `users.id` | yes | null for system tasks |

Indexes: `(case_id, status)`, `(assignee_user_id, status)`, `(assignee_role, status)` for the inbox and queue queries.

### `saved_payment_methods`

A client company's saved bank account (faked ACH). Seeded only: there is no add or edit screen.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | text PK | no | `pm_client_<n>` in the seed |
| `company_id` | text FK → `client_companies.id` | no | indexed |
| `type` | enum `PAYMENT_METHOD_TYPES` | no | |
| `bank_name`, `last4` | text | no | all the client ever sees ("ACH ••4821") |
| `encrypted_account_number` | text | no | AES-GCM token of the routing and account numbers (`src/server/documents/secrets`); never returned by a query |
| `is_default` | boolean | no | the method `pay_deposit` and "Pay all due" use |
| `created_at` | ts | no | |

### `invoices`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | text PK | no | deterministic: `payroll:<hireId>:<periodIndex>` or `deposit:<hireId>`, which is what makes the billing run idempotent |
| `number` | text unique | no | `INV-<issue year>-<sequence>`, gapless per year |
| `kind` | enum `INVOICE_KINDS` | no | |
| `company_id`, `hire_id` | text FK | no | |
| `period_index`, `period_start`, `period_end`, `pay_date`, `tax_year`, `index_in_tax_year`, `days_employed`, `period_days` | int / text | yes | null for a deposit |
| `issue_date`, `due_date` | text `YYYY-MM-DD` | no | |
| `currency`, `rate_set_id`, `pay_calendar_id` | text | no | what the invoice was calculated from |
| `total_cents` | integer | no | sum of the lines |
| `status` | enum `INVOICE_STORED_STATUSES` | no | only `open` or `void`; `paid`, `processing` and `overdue` are derived from payments and today's date |
| `void_reason` | text | yes | `order_cancelled`, `terminated` or Finance's reason |
| `created_at` | ts | no | |

Indexes: `(company_id, due_date)`, `(company_id, status)`, `(hire_id, period_index)`, `(pay_date)`.

### `invoice_lines`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | text PK | no | `<invoiceId>#<position>` |
| `invoice_id` | text FK | no | unique with `position` |
| `position`, `code`, `line_group`, `description`, `amount_cents` | | no | the billing domain's `InvoiceLine` |
| `inputs_json` | text (JSON) | no | the inputs the line was calculated from, so it can be recomputed and audited |

### `payments`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | text PK | no | |
| `company_id` | text FK | no | |
| `status` | enum `PAYMENT_STATUSES` | no | `initiated` until Finance settles or fails it |
| `saved_method_id` | text FK | yes | null for a deposit Finance recorded as received |
| `total_cents` | integer | no | equals the sum of its allocations |
| `initiated_by_user_id` | text FK | no | the client user, or Finance for a recorded deposit |
| `initiated_at` | ts | no | |
| `settled_at` | ts | yes | set only when the payment succeeds; never on a failed payment |
| `failed_at` | ts | yes | set only when Finance fails the payment (`failure_reason` is set with it); never on a succeeded one. Added by `ensureColumn`; on an existing database the startup backfill moves the failure time that older versions kept in `settled_at` into `failed_at` and empties `settled_at` for `failed` rows |
| `settled_by_user_id` | text FK | yes | the Finance user who resolved it, whichever way (succeeded or failed) |
| `failure_reason` | text | yes | set with `failed_at` |

Indexes: `(company_id, initiated_at)`, `(status, initiated_at)`.

### `payment_allocations`

PK `(payment_id, invoice_id)`; `amount_cents` is the whole invoice (no partial payments). Index on `invoice_id`.

### `benefit_elections`

One row per case, the latest decision (the current state of the case): `case_id` PK, `hire_id`, `enrolled`, `health_tier` (`HEALTH_TIER_VALUES`, null when declined), `retirement_deferral_pct`, `decided_at`. It is written together with every `benefit_election_versions` row by `recordBenefitElection` (when the `benefits_decision` task completes, and when the employee changes the 401(k) percent), so it always equals the highest version. Billing does not read it for a case that has versions; with neither, the person is billed as not enrolled.

### `benefit_election_versions`

Append-only history of the election, which makes it effective-dated ([billing-and-invoicing.md](./billing-and-invoicing.md) §13). PK `(case_id, version)`; index on `hire_id`.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `case_id` | text FK | no | |
| `version` | integer | no | 1, 2, 3, ... per case; the highest applicable version wins |
| `hire_id` | text FK | no | |
| `enrolled` | boolean | no | false when everything is declined |
| `health_tier` | text | yes | one of `employee`, `employee_spouse`, `employee_children`, `family`; null when declined |
| `retirement_deferral_pct` | real | yes | null when declined |
| `effective_from` | text (`YYYY-MM-DD`) | yes | first day of the first pay period the version applies to; null: from the start of employment |
| `source` | text | no | `onboarding` or `employee_change` |
| `decided_by_user_id` | text FK | yes | who chose it |
| `decided_at` | ts | no | |

No update or delete path exists. A database created before the table is backfilled with one version per existing election (version 1, from the start).

### `payroll_entries`

One pay slip per payroll invoice, created in the same transaction as the invoice.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | text PK | no | `payslip:<hireId>:<periodIndex>` |
| `invoice_id` | text FK unique | no | |
| `case_id`, `hire_id`, `worker_user_id` | text FK | no | the worker owns the slip |
| `period_index`, `period_start`, `period_end`, `pay_date`, `tax_year` | | no | unique `(hire_id, period_index)`; index `(worker_user_id, pay_date)` |
| `gross_cents` | integer | no | the invoice's `SALARY` line, **not** the withholding module's own helper (they can differ by a cent) |
| `pre_tax_deductions_cents`, `taxes_cents`, `post_tax_deductions_cents`, `net_cents` | integer | no | invariant: net + taxes + deductions = gross |
| `withholding_json` | text (JSON) | no | the full `computeWithholding` output (`PayStubTaxes`), including the year-to-date that the next slip continues from |
| `created_at` | ts | no | |

The W-4 behind the withholding is the case's `w4` row in `form_submissions` (SSN encrypted); pre-tax deductions come from the invoice's `HEALTHCARE` (employee premium) and `RETIREMENT` (deferral) line inputs.

### `generated_documents`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | text PK | no | |
| `case_id`, `task_id` | text FK | no | the system task that generated it |
| `kind` | text | no | e.g. `employment_agreement` |
| `file_name` | text | no | |
| `storage_path` | text | yes | null until a real generator stores bytes |
| `metadata_json` | text | no | |
| `created_at` | ts | no | |

### `document_signatures`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | text PK | no | |
| `document_id` | text FK → `generated_documents.id` | no | |
| `case_id` | text FK | no | |
| `task_id` | text FK | yes | |
| `party` | enum `TASK_PARTIES` | no | `client` or `worker` |
| `signer_user_id` | text FK → `users.id` | no | |
| `typed_name` | text | no | |
| `signed_at` | ts | no | |

### `company_documents`

Company-level signed documents (today the master EOR agreement). Created with `CREATE TABLE IF NOT EXISTS`, so adding it needs no `SCHEMA_VERSION` bump. [documents-and-signing.md](./documents-and-signing.md) §7.6.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | text PK | no | `cdoc_…` |
| `client_company_id` | text FK → `client_companies.id` | no | index with `kind` |
| `kind` | text | no | `master_agreement` |
| `title`, `file_name` | text | no | |
| `pdf` | blob | no | the signed PDF, including the certificate page |
| `sha256` | text | no | of `pdf`; compared on every download |
| `pre_signature_sha256` | text | no | |
| `document_ref` | text | no | the `NW-…` id printed on the certificate |
| `case_id`, `task_id` | text | yes | set when the signature came from an `accept_agreement` task |
| `created_at` | ts | no | |

### `company_document_signatures`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | text PK | no | |
| `document_id` | text FK → `company_documents.id` | no | |
| `party` | text | no | `client` |
| `signer_user_id` | text FK → `users.id` | no | |
| `signer_name`, `signer_role`, `typed_name` | text | no | |
| `field_key` | text | no | `sig_client` |
| `consented_at` | ts | no | ESIGN/UETA consent |
| `consent_statement_version` | text | no | `esign-ueta-v1` |
| `signed_at` | ts | no | |
| `seal` | text | no | the HMAC seal from the PDF's signature chain |

### `form_submissions`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | text PK | no | |
| `case_id`, `task_id` | text FK | no | |
| `form_type` | text | no | e.g. `w4`, `direct_deposit`, `personal_details` |
| `data_json` | text | no | non-sensitive fields |
| `encrypted_json` | text | yes | sensitive fields, AES-256-GCM ([documents-and-signing.md](./documents-and-signing.md)) |
| `submitted_by_user_id` | text FK → `users.id` | no | |
| `created_at` | ts | no | |

## 5. Seed world

The world (tenancy, staff, roles, saved payment methods) is inserted directly. **The master agreements are signed through the production path** by `seedDemo` (`pnpm db:seed`): each company's agreement starts as a draft, `prepareMasterAgreement` and `signMasterAgreementDocument` generate the PDF, apply the client HR user's typed e-signature and store the signed bytes, SHA-256 and signature in `company_documents` and `company_document_signatures` (ids `cdoc_seed_<n>`, time injected 200 days back), and only then are the people created, so no order waits on an agreement. Every seeded signed agreement therefore has a document that downloads from `/api/company-documents/[id]` and passes its integrity check. The synchronous `seedIfEmpty` that every database opens with (tests, a first run) cannot await PDF generation: it inserts the agreements as signed with no stored document, and the UI shows "Signed <date>" without a Download; run `pnpm db:seed` for the full demo. **Every person, invoice, payment and pay slip is produced by the real service operations** ([tasks-and-workflow.md](./tasks-and-workflow.md) K3): `createOrder`, then each party completing its ready tasks after a random delay under a simulated clock (`deps.now`), with scenario rules that stall, reject, cancel, terminate or reactivate; then `runBilling`, `initiatePaymentForInvoices`, `settlePayment` and `failPayment` replayed over the pay calendar (§5.2). Names, wages, dates and form data are fake values from a seeded RNG, so a reseed gives the same shape. Nothing is hand-written into `tasks`, `case_events`, `form_submissions`, `invoices`, `payments` or `payroll_entries`.

| Id | Table | Key facts |
| --- | --- | --- |
| `provider_1` | providers | "Northwind EOR" |
| `client_1`, `client_2`, `client_3` | client_companies | "Acme Robotics" (markup 15%), "Brightwave Labs" (12%), "Harbor Foods Co." (18%); CSM Morgan Patel |
| `agreement_1`, `agreement_2`, `agreement_3` | client_agreements | `signed` |
| `pm_client_1`, `pm_client_2`, `pm_client_3` | saved_payment_methods | one default ACH account per company (Chase ••4821, Mercury ••0937, Bank of America ••6153) |
| `role_software_engineer` (+ 23 more) | roles | Acme's roles; the last two are unused. Brightwave and Harbor define the first 10 (ids suffixed `_c2`, `_c3`) |
| `workflow_templates` row | workflow_templates | `us_eor_onboarding@2` (the newest version; older rows stay while a case uses them) |
| `user_client_hr` | users | Alex Harper, `client_hr`, `client_1` |
| `user_client_hr_2`, `user_client_hr_3` | users | Priya Raman (`client_2`), Marcus Hale (`client_3`), `client_hr` |
| `user_worker_2` | users | Taylor Kim, `worker` — **no case**; a persona only, since "Start a hire" creates its own person ([domain.md](./domain.md) H1) |
| `user_specialist_1`, `user_specialist_2` | users | Sam Ortiz, Riley Chen, `onboarding_specialist`, provider `provider_1` |
| `user_finance_1`, `user_finance_2` | users | Morgan Reyes, Dana Whitfield, `finance`, provider `provider_1` |
| `user_worker`, `hire_1`, `case_pending_1`, `doc_list_a_1` | users, hire_requests, onboarding_cases, case_documents | Jordan Lee, the canonical case: ordered 6 days ago, start 8 days out; everything done except `verify_i9_section2`, so it is the specialist's work item |

Time is relative to the seed clock (`SEED_NOW`, the current time floored to the hour), so the demo always reads as recent. Other people use ids `user_worker_<key>` / `hire_<key>` / `case_<key>`, where `<key>` is derived from the generated name. Scenarios run oldest order first so deposit invoice numbers rise with the calendar.

### 5.1 Roster

`SEED_ROSTER` (`src/db/seed.ts`) is Jordan plus 67 generated people (68 cases) from `KINDS`, each a scenario for the operations to run. Company 0 is Acme; `company` on a row selects another.

| Kind | Count (Acme / Brightwave / Harbor) | What the operations did |
| --- | --- | --- |
| `new_order` | 3 / 0 / 1 | ordered hours ago; client has not started the deposit payment (deposit invoice `open`) |
| `deposit_overdue` | 2 / 0 / 0 | ordered 9–12 days ago, start 1–3 days out, deposit unpaid (**at risk**) |
| `deposit_processing` | 2 / 1 / 0 | client paid the deposit; Finance has not confirmed (payment `initiated`, `confirm_deposit` ready) |
| `awaiting_ops_review` | 2 / 0 / 0 | deposit paid; `review_order` waiting for the specialist |
| `invited` | 2 / 0 / 0 | worker invited, has not accepted |
| `worker_midway` | 3 / 1 / 0 | worker finished some tasks and stalled on others |
| `worker_at_risk` | 2 / 0 / 0 | worker stalled with the start 1–2 days away (**at risk**) |
| `awaiting_review` | 3 (incl. Jordan) / 0 / 0 | all worker tasks done; `verify_i9_section2` waiting for the specialist |
| `rejected_awaiting_fix` | 2 / 0 / 0 | specialist rejected; `fix_documents` waiting for the worker |
| `reworked_awaiting_review` | 1 / 0 / 0 | rejected, fixed, second verification pending |
| `awaiting_payroll` | 3 / 0 / 0 | everything before `setup_payroll` done |
| `waiting_for_start` | 3 / 0 / 0 | every blocking task done; the start date is ahead |
| `active` | 8 / 7 / 6 | started 20–140 days ago; billed and paid every pay period since; some still owe `file_new_hire_report` |
| `active_fixed_term` | 3 / 1 / 0 | active with a future end date |
| `term_ended` | 2 / 0 / 1 | active, fixed term ended days ago (lists **Inactive**); billing stopped at the end date |
| `cancelled` | 3 / 0 / 0 | cancelled after a few tasks; an unpaid deposit invoice is void |
| `cancelled_reactivated` | 1 / 0 / 0 | cancelled, then restarted (new tasks after the cancelled ones; the deposit invoice reopened) |
| `terminated` | 3 / 1 / 0 | onboarded, started, then terminated; billing stopped at the last working day |
| `terminated_reactivated` | 1 / 0 / 0 | terminated, then reactivated (active again; the gap is billed, see [billing-and-invoicing.md](./billing-and-invoicing.md) §12) |

Roster workers are **not** personas on `/pick` (`listPersonas` returns the canonical users only: three client HR users, two workers, two specialists, two Finance users). The mix covers every person status, at-risk people, rework history and each lifecycle path.

### 5.2 Billing history

After the scenarios, `simulateBilling` walks every day from the earliest start to the seed clock and, on each invoice issue day, calls `runBilling` (people appear from their start date; terminated and fixed-term people stop at their last day). Each company's client then pays that day's payroll invoices with one ACH payment 1–4 days later and Finance settles it 1–3 days after that, using the real operations with the clock set to those days. The latest invoices are left in different states so every status shows:

| Company | Policy |
| --- | --- |
| Acme | the latest day's invoices are never paid (open, or overdue once past due) |
| Brightwave | the latest two days' invoices are never paid (overdue / open) |
| Harbor | the latest day's payment is initiated and never settled (processing); an earlier payment fails once ("ACH return R01") and is paid again |

Deposits come from the scenarios (client pays, Finance confirms; a few are recorded as received). Benefit elections and W-4 data come from completing the worker's real `benefits_decision` and `w4` tasks with generated data, which is what billing and withholding then read.

Seed invariants (tested in `src/db/__tests__/seed.test.ts`, `seed-demo.test.ts` and `seed-billing.test.ts`; `seed-demo.test.ts` asserts that every signed agreement from `seedDemo` has one stored, verifiable document its client and Northwind can read, that a failed signing leaves nothing seeded, and that a second seed repeats the ids and times): the canonical users plus one worker per roster row; `user_worker_2` has no case; Jordan's case is waiting on `verify_i9_section2` for the specialist; replaying each seeded case's events through the engine reproduces its stored tasks and lifecycle; every kind shows the status, waiting-on and at-risk its definition promises; the sensitive form fields are encrypted; the seed is deterministic; every started person has exactly one payroll invoice per pay period from the period holding their start, contiguous, none after the end of employment; every live payroll invoice has one pay slip whose gross is the invoice's salary line and whose net + taxes + deductions equal gross; invoice lines add up to totals and numbers are gapless per year; payments' allocations add up and no invoice is covered by two live payments; the derived status mix contains paid, processing, open and overdue; benefit lines exist only for enrolled people.

## 6. JSON column contracts

All JSON columns are stored as `text`. Parsing MUST go through a narrowing function in `src/domain/types.ts` (`parsePolicySnapshot`, `parseI9Attestation`, …) that returns `null` on malformed input; callers treat `null` as "absent", never crash. Task, fact and template JSON is parsed by the task store (`src/server/task-store.ts`) and `parseTemplate`. `invoice_lines.inputs_json` and `payroll_entries.withholding_json` are written and read only by `src/server/billing-core.ts` and `billing-queries.ts`, as the billing domain's `InvoiceLine['inputs']` and the payroll module's `PayStubTaxes`.

## 7. Out of scope

Migrations history (schema is pushed, not versioned; an old database is rebuilt); soft deletes; multi-currency; a key-management service (the field-encryption key comes from the environment or a local dev key); full-text search; storing file bytes in the database.

## 8. Verification

1. `src/db/__tests__/seed.test.ts`: all §5 invariants against a temp SQLite file; the template row is stored and validated.
2. Schema test: `CASE_LIFECYCLES`, `TASK_STATUSES`, `USER_ROLES`, `DOCUMENT_KINDS` exported by the schema equal the domain's (prevents drift).
3a. `seed-billing.test.ts`: the §5.2 invariants against a seeded temp file.
3. JSON parsers: malformed strings → `null`; valid → typed value (table-driven).
4. U1 invariant asserted in seed test for every canonical user.
