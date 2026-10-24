# Architecture

## 1. Purpose and assumptions

This spec owns the system shape: stack, trust boundaries, code layers and their directories, route map, upload storage, and the transaction rule that ties the domain to persistence. Behavior rules live in [domain.md](./domain.md), [tasks-and-workflow.md](./tasks-and-workflow.md), [case-state-machine.md](./case-state-machine.md) (lifecycle) and [acl.md](./acl.md); this document says where each rule is implemented and what may call what.

Assumptions (locked, see [product-overview.md](./product-overview.md) §2):

| Layer | Choice |
| --- | --- |
| App | Next.js App Router + TypeScript + shadcn/ui (repo root) |
| Data | Drizzle ORM + SQLite via `better-sqlite3`, file `data/eor.sqlite` |
| Session | iron-session signed cookie `eor_session` carrying `userId` |
| Files | Local disk under `data/uploads/`; metadata in `case_documents` |
| Tests | Vitest (`__tests__/` siblings), Playwright (`e2e/`) |
| Package manager / Node | pnpm 10, Node 24 |

No separate backend service, queue, or external API.

## 2. Trust boundaries

```
Browser (untrusted)
   │  cookie: eor_session (signed, httpOnly)
   ▼
Next.js server ──────────────────────────────────────────────┐
   Portal layouts   → requirePortalUser(role)  [redirect guard] │
   Server Actions   → requireRole(...)         [enforcement]    │  src/auth
   Route Handlers   → requireUser + predicates [enforcement]    │
         │                                                      │
         ▼                                                      │
   src/server/*   (case + task services: transaction + domain + events) │
         │                      │                               │
         ▼                      ▼                               │
   src/domain/*  (pure)    src/db/* (Drizzle)   data/uploads/*  │
└────────────────────────────────────────────────────────────────┘
```

- B1. Everything client-side is untrusted, including hidden form fields and the current UI state.
- B2. The only identity source is the signed cookie resolved against `users` on each request.
- B3. The domain layer never performs I/O; the DB layer never applies business rules. The case service is the only place both meet.
- B4. File bytes leave the server only through `GET /api/documents/[id]` ([acl.md](./acl.md) F5).

## 3. Layers and directories

Follows `standards/engineering.md` (types → behavior → orchestration → components).

| Directory | Layer | Owns | MUST NOT |
| --- | --- | --- | --- |
| `src/domain/types.ts` | Types | Enum constants (`USER_ROLES`, `CASE_LIFECYCLES`, `DOCUMENT_KINDS`, …), branded ids, `DomainError`, JSON parsers | import from `next`, `drizzle`, `react`, `src/db` |
| `src/domain/*.ts` | Behavior | `case-lifecycle.ts`, `person-status.ts`, `employment-term.ts`, `wage.ts`, `policy-snapshot.ts`, `work-auth.ts` — pure functions |
| `src/domain/tasks/` | Behavior | The task engine ([tasks-and-workflow.md](./tasks-and-workflow.md)): `template.ts` (validation), `conditions.ts`, `engine.ts` (instantiate, settle, complete, reject, cancel), `handlers.ts` (per-type payload parsing and effects), `projection.ts` (progress, waiting on, at risk, go-live), `stages.ts` (the customer-facing stage projection per audience), `authorization.ts`, `default-workflow.ts` (the template as data), `facts.ts`; plus seed helpers `rng.ts`, `sample-data.ts` — pure, `now` and ids injected | I/O, Date.now() (take `now` as a parameter), imports outside `src/domain` |
| `src/db/` | Data | `schema.ts`, `client.ts`, `workflow-templates.ts` (versioned template rows), `seed.ts` (runs real operations) | business rules |
| `src/auth/` | Security | `session.ts`, `acl.ts`, `require-user.ts`, `actions.ts` (`pickPersona`, `pickEmployee`, `clearPersona`) | case logic |
| `src/server/` | Orchestration | `cases.ts` (case service: create order, cancel, terminate, reactivate, upload), `tasks.ts` (complete or reject a task as an actor, settle, inbox and role-queue queries), `case-engine.ts` + `task-store.ts` (load, persist, apply effects), `field-crypto.ts` (sensitive fields), `document-generator.ts` (seam), `documents.ts` (storage + byte access), `queries.ts` (read models per portal), `personas.ts` (picker and switcher read models: client and Northwind groups, recently started employees, employee search and count), `billing.ts` (billing run, payments, deposit resolution, void: operations), `billing-core.ts` (transaction-level invoice, payment and payroll-entry primitives shared with the task effects), `billing-queries.ts` (invoice, payment, receivables and pay-slip read models; the client, Finance and employee views are ACL-scoped) | JSX, direct business rules (delegate to domain) |
| `src/app/**/actions.ts` | Orchestration | Thin Server Actions: `requireRole` → parse input → call `src/server` → `ActionResult` | branching business logic |
| `src/app/**/page.tsx`, `layout.tsx` | Components | Rendering, forms, guards via `requirePortalUser` | DB access except through `src/server/queries.ts` |
| `src/components/` | Components | Shared UI: `portal-shell`, `persona-switcher`, `case-timeline`, `onboarding-timeline` (events then upcoming tasks), `at-risk-flag`, `document-list`, `person-status-badge` | fetching |
| `src/app/api/documents/[id]/route.ts` | Route handler | Byte streaming with ACL | anything else |

### 3.1 Enum constants

`src/domain/types.ts` and `src/domain/tasks/types.ts` own the constants listed in [data-model.md](./data-model.md) §2. `src/db/schema.ts` repeats the literals so the schema has no domain import, and a schema test asserts they are equal ([data-model.md](./data-model.md) §8.2).

### 3.2 What is data and what is code

The workflow (which tasks exist, who owns them, dependencies, conditions, due offsets, rework) is a versioned **template stored as data** (`workflow_templates`); the engine is generic and never names a task key. Behaviour that differs per task type lives in the handler registry. Adding a task to the process is a new template version, not an engine change ([tasks-and-workflow.md](./tasks-and-workflow.md) K1).

## 4. Case service and the transaction rule

`src/server/cases.ts` exposes one function per lifecycle operation in [case-state-machine.md](./case-state-machine.md) §3 (`createOrder`, `cancelOrder`, `terminatePerson`, `reactivatePerson`) plus `uploadCaseDocument` and `createRole`; `src/server/tasks.ts` exposes `completeTaskAsActor` and `rejectTaskAsActor`. Each MUST follow:

```ts
export function completeTaskAsActor(deps: CaseServiceDeps, input: { actor: SessionUser; caseId: string; taskId: string; payload: unknown }) {
  return deps.db.transaction((tx) => {
    const record = loadCase(tx, input.caseId)                  // re-read inside the transaction
    const ctx = engineContext(tx, deps, record)                // template, frozen facts, handlers, now
    const result = domain.completeTask(loadTasks(tx, record.id), ctx, { taskId: input.taskId, actor, payload: input.payload })
    persistTasks(tx, result.changed)                           // tasks (system tasks included)
    insertEvents(tx, result.events)                            // one event per change
    applyEffects(tx, deps, record, result.effects)             // ledger, signatures, forms, agreement
    return result
  })
}
```

Rules:

- X1. Dependencies (`db`, `now`, `newId`, `documentGenerator`) are injected; no module-level singletons inside `src/server` functions. `getDb()` is called only at the Server Action boundary. The seed passes a simulated `now`.
- X2. One transaction per operation; task changes (including the system tasks that run in the settle pass), events and effects are written together or not at all. Lifecycle operations also write `lifecycle` and, when they cancel, the cancelled tasks.
- X3. `DomainError` propagates out of the transaction unchanged; the Server Action maps it to `ActionResult`. A case that does not exist or belongs to another company is `NotFoundError`, mapped to `not_found` (no existence leak).
- X4. Read models for pages live in `src/server/queries.ts` and `src/server/tasks.ts` and return plain serializable objects; pages never import Drizzle tables. Anything time-dependent (go-live, overdue, at risk, term ended) is computed on read from `now` ([tasks-and-workflow.md](./tasks-and-workflow.md) K4).
- X5. The state the engine acts on is re-read from the database inside the transaction, never taken from the form. A stale second attempt therefore fails with `TASK_NOT_READY` or `ILLEGAL_TRANSITION` instead of applying twice.

## 5. Route map

| Route | Persona | Kind | Spec |
| --- | --- | --- | --- |
| `/` | any | redirect → `/pick` or `ROLE_HOME[role]` | acl §5 |
| `/pick` | any | three rows: Clients (a tile per client HR user, titled by company) and Northwind (the specialist and Finance) from `listPickerPersonas`, each tile calling `pickPersona(userId)`; Employees, a search field plus tiles for the employees who most recently went live (`listRecentlyStartedEmployees`), which opens a searchable dialog over every `worker` user (`searchEmployees`, server-filtered, capped at 50 with a total; `searchEmployeesAction`); choosing one calls `pickEmployee(userId)`, which signs in only an existing `worker` and lands on `/worker`; ui-guidelines C14 | acl §1, §6 R5 |
| `/client` | `client_hr` | Home, the client's landing page (`ROLE_HOME`): header "Home" with Start a hire; three glance cards (**Onboarding** and **At risk** counts linking to `/client/people?status=onboarding` and `?atRisk=1`, **Invoices due** with the total payable linking to `/client/finance`), then **To do** (the client's own open tasks as jobs with an outline button each, runs of one job grouped; `accept_agreement` and `pay_deposit` open their dialogs in place). Reads `loadClientHome` (`src/server/client-home.ts`). Nav badge: `openTaskCount` | task-inbox §8, ui-guidelines C28 |
| `/client/people` | `client_hr` | People (header "People" with Start a hire, no task panel; nav item active for every `/client/people/*` page): one table with a filter bar (search, status, role, location), sortable columns (name, role, location, status), URL state and pagination (domain §9.2–§9.3); the status column is the three-state badge only, derived from the lifecycle, the go-live task and the employment end date (a person past their end date is Inactive); the at-risk warning icon sits after the person's name | issue-map #25 |
| `/client/calculator` | `client_hr` | cost calculator: work location, pay, benefits package; shows salary, statutory costs, service fee and the benefits that would apply if the employee enrolls; same `buildQuote` as the hire quote; saves nothing | domain §7.2 |
| (no agreement route) | `client_hr` | agreement acceptance is part of the order; when it was left unsigned the case has an `accept_agreement` task with an inline action on `/client/people/[caseId]` and a To do row on the Home that opens the signing dialog in place | domain §3 |
| `/client/people/new` | `client_hr` | "Start a hire": person details (name, email, work location), role, desired start date (≥ 5 business days out) and employment term (indefinite, or fixed with an end date after the start date), compensation (hourly/monthly/annual with the state minimum shown), benefits; then a review step: an "Order details" card (person, email, role, location, dates, benefits), the quote (salary, statutory employer costs, the percent service fee in dollars, total in the chosen pay frequency and, for a fixed term, the total for the term, with collapsible categories; benefits "determined after enrollment", and the deposit, one month of the total) and the agreement: a "Northwind EOR agreement" row with **Review and sign** that opens the signing popup while the agreement is draft (then "Signed <date> by <name>" and a download link), then **Create order**, which stays disabled until it is signed. All three blocks share the `SummaryCard` row style. The quote is computed in the browser (`buildQuote`) and nothing is saved before Create order; creates the person, the hire, the case and its tasks in one transaction (`createOrder`) | domain H1–H4, state T0 |
| `/client/people/[caseId]` | `client_hr` | one centered column (`max-w-2xl`, prototype `FormContainer`): back link, header (name, at-risk icon, status badge, role; Cancel onboarding T9 until the start or Terminate T10 once they are live, fixed top right and vertically centred), inactive banner (its only action is Reactivate, T11; text gives the last working day, or when onboarding was cancelled if they never worked; for an ended term the last working day is the end date, and Reactivate asks for a new term), then tabs that appear only where they apply: **Onboarding** (onboarding people only, default then: one vertical list of the events so far followed by the upcoming tasks grouped by phase, each with owner, due date and status, and any action the client owns inline: pay the deposit, sign the EOR agreement in the signing popup; [tasks-and-workflow.md](./tasks-and-workflow.md) §9) and **Details** (read-only form fields in the prototype order: name, email, type, role, compensation, location, benefits, start date, end date (or Indefinite), last working day when terminated). Terminate cannot pick a last working day after the end date. A single tab renders without the tab list. No cost, contact or activity tab. Provider staff anonymised (acl I4) | acl I2, I4 |
| `/client/finance` | `client_hr` | Finance: the summary (Due now, and Overdue when there is any), the unpaid invoice list with status filter, search and Pay selected / Pay all due, the Payments tab grouped In progress, Failed and by month, and one drawer for an invoice or a payment (no invoice page); `?open=<invoiceId>` (`invoiceDrawerHref`) opens any of the client's invoices in the drawer, another company's or an unknown id opens nothing; reads `financeQueries` scoped by the session's company (the drawer's lines through `getInvoiceDetail`, `loadInvoiceDocument`); payments are initiated through `initiatePaymentForInvoices` and settled later by Finance | client-finance §2, §2a, §4, §5, billing-and-invoicing |
| `GET /client/finance/invoices/[id]/pdf` | `client_hr` of the invoice's company | the invoice as a PDF attachment (`generateInvoicePdf`); 401 no session, 403 other role, 404 for an unknown or another client's invoice | client-finance §2, §5 |
| `/worker` | `worker` | the employee home: while onboarding, the welcome headline with progress, the Continue card, the stage stepper, what happens after (first pay date) and links to Pay, Benefits and Documents; once active, the employee's own details read-only in the client Details structure (job, personal, pay, benefits summary; `loadEmployeeHome`, `loadEmployeeProfile`, `EmployeeHome`) | employee-portal §4, tasks §10, acl I3 |
| `/worker/tasks/[taskId]` | `worker` | the generic task route; renders the employee screen for the task's type (`EmployeeTaskScreen` registered in `TASK_SCREENS`): accept invitation, sign agreement, personal details, I-9, upload documents (also `fix_documents`), W-4, direct deposit, benefits; another employee's task is `notFound()` | employee-portal §3, task-inbox §4, acl I6 |
| `/worker/documents` | `worker` | the employee's signed documents (agreement, I-9 Section 1, W-4, direct deposit authorization): the name opens the signed copy in a new tab, an icon button downloads it | employee-portal §6 |
| `GET /worker/documents/[id]/view` | `worker` | a signed document as an inline PDF (the new tab); same owner, hash and seal checks as the download; 401 no session, 403 other role, 404 not theirs, 409 tampered | employee-portal §6, acl F5 |
| `GET /worker/documents/[id]/download` | `worker` | a signed document as a PDF attachment; owner only, hash and seals verified first; 401 no session, 403 other role, 404 not theirs, 409 tampered | employee-portal §6, acl F5 |
| `/worker/benefits` | `worker` | Benefits: health coverage read-only, the 401(k) percent with its change form (`changeContributionAction`, effective from the next pay period that has not started), the append-only election history (`loadBenefitsPage`) | employee-portal §7, billing §13, acl I3 |
| `/worker/pay` | `worker` | Pay: latest net, YTD gross and taxes, next pay date, year tabs, the employee's own pay slips up to today (America/New_York), the direct-deposit label | employee-pay §2, §3 |
| `/worker/pay/[payslipId]` | `worker` | one pay slip: earnings, deductions, taxes, net, current and YTD columns; another employee's, an unknown or a not-yet-visible slip is `notFound()` | employee-pay §2, acl I3 |
| `GET /worker/pay/[payslipId]/pdf` | `worker` | the slip as a PDF attachment (`generatePayslipPdf`); 401 no session, 403 other role, 404 not the employee's or not yet visible | employee-pay §4 |
| `/onboarding` | `onboarding_specialist` | the specialist home: the role queue grouped by urgency or task, a drawer per task, URL-state filters (`staffHome`, `SpecialistHome`) | onboarding-portal §6 |
| `/onboarding?open=<taskId>` | `onboarding_specialist` | the Home with that task open in the drawer, where the specialist task types are done: `review_order`, `verify_i9_section2` (accept with e-signature, or send back), `setup_payroll`, `file_new_hire_report`, `submit_benefit_enrollments`; there is no separate task route | onboarding-portal §3 |
| `/onboarding/people` | `onboarding_specialist` | every client's people, the client portal's list plus a Client column and filter (`listPeople(db, null, …)`, `PeopleList`) | onboarding-portal §5 |
| `/onboarding/people/[caseId]` | `onboarding_specialist` | one case with Tasks, Documents (uploads with review state, signed documents), Forms (masked, view only), Order and Activity tabs (`staffCaseDetail`); no lifecycle actions | onboarding-portal §4 |
| `GET /api/staff/documents/[id]` | `onboarding_specialist` | any case's signed document as a PDF attachment, hash and seals verified first; 401 no session, 403 other role, 404 unknown or no stored copy, 409 failed the integrity check | onboarding-portal §2, acl F5 |
| `/finance` | `finance` | the Finance Home: To settle, Overdue and Ready to bill tiles (`financeOverview`), the billed vs collected and who owes us charts (`billedVsCollectedByPeriod`, `clientAgeing`), and "Waiting on you", the first payments to settle with Settle (`oldestWaitingPayments`); no task list (`confirm_deposit` is a deposit payment waiting first, and Finance task links open `/finance/payments`) | finance-portal §2.6, ui-guidelines C33 |
| `/finance/payments` | `finance` | Payments: To settle (deposits first), Settled and Failed tabs as dense rows with search and a Client filter, Settle per row and in bulk, Mark failed with a reason; one staff drawer for a payment or an invoice; `?open=<paymentId>` opens a payment on its tab (`financePaymentsPage`, `financePaymentRecord`); settling a deposit payment completes `confirm_deposit`, failing one reopens `pay_deposit` | finance-portal §2, §2.0, §2.1, §2.2 |
| `GET /finance/payments/[id]` | `finance` (checked by the target) | 307 to `/finance/payments?open=<id>` (the old payment page) | finance-portal §2 |
| `/finance/invoices` | `finance` | every company's invoices: search, Status, Client, a More popover (kind, issue dates), chips, the summary line, a sort and server pagination, URL state; the staff drawer with Mark as paid on an unpaid deposit (`markDepositReceived`), Download PDF and Void invoice (`voidInvoice`); `?open=<invoiceId>` opens any invoice (`financeInvoicesPage`, `financeInvoiceRecord`) | finance-portal §2, §2.0, §2.2, §2.3 |
| `GET /finance/invoices/[id]` | `finance` (checked by the target) | 307 to `/finance/invoices?open=<id>` (the old invoice page) | finance-portal §2 |
| `GET /finance/invoices/[id]/pdf` | `finance` | any company's invoice as a PDF attachment (`generateInvoicePdf`); 401 no session, 403 other role, 404 unknown | finance-portal §2 |
| `/finance/receivables` | `finance` | read-only dashboard: the figures line and the By age and By client bar lists (`clientAgeing`, computed once per request) that crossfilter the unpaid invoices (`?bucket=`, `?client=`), and the table of those invoices (`financeReceivablesPage`), a row opening the Invoices drawer | finance-portal §2.5, ui-guidelines C32, CH9 |
| `/finance/billing` | `finance` | the Run card: read-only preview of the billing run (`previewBillingRun`) and Run billing (`runBilling`, idempotent); the preview by client, the next pay periods (`billingCadence`) and recent issue dates | finance-portal §2.4, ui-guidelines C33 |
| `/dev/finance` | none (dev only, 404 in production) | the client finance dashboard over fixtures built with the real billing domain | client-finance §8 |
| `/dev/pay` | none (dev only, 404 in production) | the employee pay dashboard and a slip computed by the real payroll domain; `?scenario=`, `?state=` | employee-pay §2, §6 |
| `POST /api/billing/run` | machine caller | runs `runBilling` (idempotent: creates the invoices and payroll entries whose issue date has come) and returns `{ today, invoices, payrollEntries }`; answers 404 unless `BILLING_RUN_SECRET` is set and 401 without `Authorization: Bearer <secret>`; no cron exists, so this is the external trigger | billing §12 |
| `GET /api/documents/[id]` | onboarding specialist, owning worker | identity-upload bytes (type sniffed, `private, no-store`); client HR and Finance are forbidden | acl F5, employee-portal §6 |
| `GET /api/company-documents/[id]` | `client_hr` of the owning company, onboarding specialist | the signed master agreement; the stored SHA-256 and signature seals are verified first (409 if tampered) | acl I8, documents-and-signing §7.6 |

Rules:

- N1. Each portal has a `layout.tsx` calling `requirePortalUser(<role>)` and rendering `PortalShell` with the persona switcher.
- N2. Server Actions live in `actions.ts` next to the page that uses them; shared actions go in `src/server`.
- N3. No portal links to another portal's routes except via `/pick`.

## 6. Upload storage

- U1. Root: `data/uploads/` (`UPLOADS_ROOT` overrides it). Everything under it is gitignored except the legacy `data/uploads/seed/list-a-passport.png`, kept for databases seeded before the seed stored its own files. The seed writes its sample identity documents under the root through the real upload service, so `pnpm db:seed` recreates them.
- U2. Runtime path: `data/uploads/{caseId}/{documentId}-{sanitizedFileName}`. `storage_path` stores the repo-relative path.
- U3. `src/server/documents.ts` exposes `writeUpload(deps, { caseId, kind, file }) → CaseDocument` and `openDocumentStream(deps, doc) → ReadableStream`. Both resolve paths with `path.resolve(uploadsRoot, storagePath)` and MUST refuse results outside `uploadsRoot`.
- U4. Accepted MIME types: `image/png`, `image/jpeg`, `application/pdf`; max 10 MB. Others → `ActionResult { code: "validation" }`.
- U5. Writing bytes and inserting the `case_documents` row + `document_uploaded` event happen in the same operation; if the DB insert fails, the file is removed (`/* best-effort */` cleanup).

## 7. Configuration

| Env | Default | Purpose |
| --- | --- | --- |
| `SESSION_SECRET` | dev constant (≥32 chars) | iron-session password |
| `DATABASE_FILE` | `data/eor.sqlite` | SQLite path (tests use a temp file) |
| `UPLOADS_ROOT` | `data/uploads` | storage root (tests use a temp dir) |
| `FORCE_SEED` | unset | `1` → wipe and reseed |
| `BILLING_RUN_SECRET` | unset | bearer secret (≥ 16 chars) for `POST /api/billing/run`; unset disables the route (404) |
| `NORTHWIND_DATA_KEY` | dev constant | key material (≥ 32 chars) for encrypting sensitive form fields; production MUST set it |

## 8. Out of scope

Separate API service; background jobs; caching layers; CDN/object storage; observability stack; i18n; multi-region.

## 9. Verification

1. Dependency-direction lint: an ESLint `no-restricted-imports` rule (or a Vitest test that greps imports) proves `src/domain/**` imports nothing from `next`, `react`, `drizzle-orm`, or `src/db`.
2. Enum equality test ([data-model.md](./data-model.md) §8.2).
3. Case and task service double-apply tests ([case-state-machine.md](./case-state-machine.md) §8, [tasks-and-workflow.md](./tasks-and-workflow.md) §11).
4. `documents.ts`: path traversal (`../`) refused; unsupported MIME refused; successful write produces file + row + event; DB failure removes file.
5. `pnpm lint && pnpm test && pnpm build` green; CI "Quality Gates" (Lint, Unit Tests, Production Build, End-to-End Tests) is the merge gate.
