# Access control (ACL)

## 1. Purpose and assumptions

This spec owns identity for the demo: role ids, the persona session, the role × action capability matrix, document-byte access, and the rules every Server Action and route handler MUST follow. Lifecycle operations are specified in [case-state-machine.md](./case-state-machine.md) and task execution in [tasks-and-workflow.md](./tasks-and-workflow.md); this document says *who may invoke* each operation and how that is enforced.

Assumptions:

- No passwords, IdP, or MFA. Identity = a seeded `users` row chosen on `/pick`.
- The session is a signed, httpOnly cookie carrying only `userId` (iron-session, cookie name `eor_session`). Tampering yields "no session", never a different user.
- The seed has three client companies; row-level tenancy checks are limited to the ones listed in §4 (a client sees its own company's cases, invoices and payments).

## 2. Roles

| Role id | Display | Tenant link |
| --- | --- | --- |
| `client_hr` | Client HR | `users.client_company_id` set |
| `worker` | Worker (shown as "Employee" in the UI) | `users.client_company_id` set (the employing client) |
| `onboarding_specialist` | Onboarding Specialist | `users.provider_id` set |
| `finance` | Finance | `users.provider_id` set |

Exported as `USER_ROLES` (see [architecture.md](./architecture.md) §3.1). Task **parties** map onto them: `client` → `client_hr`, `worker` → `worker`, `specialist` → `onboarding_specialist`, `finance` → `finance`; `system` is nobody ([tasks-and-workflow.md](./tasks-and-workflow.md) §2.1). Exactly one role per user; roles are not combinable.

## 3. Role × action matrix

✓ = allowed; ✗ = server MUST refuse with `forbidden`; `own` = allowed only for rows the actor owns (§4).

| Action | `client_hr` | `worker` | `onboarding_specialist` | `finance` | Operation / route |
| --- | --- | --- | --- | --- | --- |
| Pick persona / switch | ✓ | ✓ | ✓ | ✓ | `pickPersona`, `pickEmployee` (the picker's employee search, `worker` ids only), `clearPersona` |
| Create roles | ✓ | ✗ | ✗ | ✗ | "Start a hire" form |
| View agreement + markup | ✓ | ✗ | ✓ (read) | ✗ | `/client/people/new` (accept inline), `/client/people/[caseId]`, onboarding case detail |
| Sign the master agreement in the signing popup (on Create order, or by completing `accept_agreement`); the typed name must be the signer's own | ✓ | ✗ | ✗ | ✗ | `prepareMasterAgreement`, `signMasterAgreementAction`, `signAgreementTaskAction`, `agreement_signed` |
| Download the signed master agreement (company document) | ✓ (own client) | ✗ | ✓ (every company) | ✗ | `GET /api/company-documents/[id]` |
| Create an order (person, hire, tasks) | ✓ | ✗ | ✗ | ✗ | `createOrder`, T0 |
| List cases (status, tasks, timeline) | ✓ (own client) | own case | ✓ | ✗ (billing views only) | portals |
| View document **metadata** (kind, filename, uploadedAt) | ✓ | own | ✓ | ✗ | case detail |
| View / download document **bytes** | ✗ | own case | ✓ | ✗ | `GET /api/documents/[id]` |
| Complete a task | by the task's `actors` (§4) | by the task's `actors` (own case) | by the task's `actors` | by the task's `actors` | `completeTaskAsActor` |
| Reject a task with a reason (rework) | only if listed in `actors` | only if listed | ✓ for `verify_i9_section2` | only if listed | `rejectTaskAsActor`, `task_rejected` |
| Add a note to the case timeline | ✗ | ✗ | ✓ | ✗ | `addOpsNote` (spec only) |
| Upload document | ✗ | own | ✗ | ✗ | `uploadCaseDocument` |
| See own task inbox / role queue | own tasks | own tasks | `onboarding_specialist` queue | `finance` queue | `inboxForUser`, `roleQueue` |
| Cancel onboarding (before go-live; the person becomes inactive), optional reason | ✓ (own client) | ✗ | ✗ | ✗ | T9, `cancelOrder` |
| Terminate a live person with an effective date, optional reason | ✓ (own client) | ✗ | ✗ | ✗ | T10, `terminatePerson` |
| Reactivate an inactive profile (terminated, cancelled, or term ended; a new term is required when the end date has passed) | ✓ (own client) | ✗ | ✗ | ✗ | T11, `reactivatePerson` |
| View the company's invoices, payments, finance summary, saved bank account (last four digits only) | ✓ (own client) | ✗ | ✗ | ✓ (every company) | `listClientInvoices`, `invoiceDetail`, `listClientPayments`, `paymentDetail`, `clientFinanceSummary`, `personInvoiceHistory`, `savedPaymentMethod` (`src/server/billing-queries.ts`) |
| Start a payment of open invoices | ✓ (own client) | ✗ | ✗ | ✗ | `initiatePaymentForInvoices`; `pay_deposit` for the deposit |
| Settle or fail a payment; void an invoice; record a deposit as received or not received | ✗ | ✗ | ✗ | ✓ | `settlePayment`, `failPayment`, `voidInvoice`, `markDepositReceived`, `markDepositNotReceived` |
| Receivables across companies, every payment, the settlement queue | ✗ | ✗ | ✗ | ✓ | `receivables`, `listFinanceInvoices`, `listFinancePayments` |
| Own pay slips and year-to-date, from the pay date on | ✗ | own | ✗ | ✗ | `listPaySlips`, `paySlipDetail`, `paySlipYears`, `payYtd` |
| Own details on Home (job, personal, pay, benefits summary; never the SSN or date of birth) | ✗ | own | ✗ | ✗ | `loadEmployeeProfile` through `loadEmployeeHome` |
| Read the Benefits page; change the own 401(k) percent (effective from the next pay period that has not started) | ✗ | own | ✗ | ✗ | `loadBenefitsPage`, `changeContributionAction` (`changeRetirementElection`) |
| Open (inline) or download an own signed document | ✗ | own | ✗ | ✗ | `GET /worker/documents/[id]/view`, `GET /worker/documents/[id]/download` |
| Run billing, preview what it would issue | ✗ | ✗ | ✗ | ✓ | `runBilling` through `runBillingAction` and `previewBillingRun` (`/finance/billing`); also seed, tests and `POST /api/billing/run` behind `BILLING_RUN_SECRET` |
| Deposits awaiting Finance, home tiles, any company's invoice PDF | ✗ | ✗ | ✗ | ✓ | `listPendingDeposits`, `financeOverview`, `financeInvoicePdfInput` (`src/server/finance-portal-queries.ts`), `GET /finance/invoices/[id]/pdf` |
| Seed / reset database | — | — | — | — | CLI only, never via HTTP |

Invariants derived from the matrix (each MUST have a test):

- I1. Authorization follows a task's `actors`, not who it is assigned to: an `onboarding_specialist` can never complete a Finance task (`confirm_deposit`) and `finance` can never complete a specialist task (`review_order`, `verify_i9_section2`, `setup_payroll`); neither can create orders, sign or cancel. Specialists verify I-9 Section 2 as the employer's authorized representative; Finance owns the money tasks. A colleague at the client may complete a task assigned to another client user when its `actors` include the `client` party.
- I2. `client_hr` can never receive document bytes, even for its own client's cases.
- I3. `worker` is scoped to the case (zero or one) where `onboarding_cases.worker_user_id === session.userId`; a worker completes only that case's worker tasks, and with zero cases every case action is `not_found`.
- I4. `client_hr` never sees provider staff identities. Client read models collapse `onboarding_specialist` / `finance` actors to the provider name ("Northwind") on timelines and events; the client's only named contact at the provider is the company's CSM (`client_companies.csm_name` / `csm_email`).
- I5. System tasks are never completable by anyone (`canActOnTask` is false for the `system` party); the engine runs them inside the transaction that unblocks them.
- I7. Money. A client reads and pays only its own company's invoices and payments; an invoice, payment or method of another company (or one that does not exist) is `NotFoundError` on a write (`initiatePaymentForInvoices`) and `null` or an empty list on a read, never `forbidden`. Paying never needs a method id from the request: the method must belong to the actor's company. Only `finance` changes what money has moved (`settlePayment`, `failPayment`, `voidInvoice`, deposit received); `finance` cannot start a payment on a client's behalf. A worker reads only their own pay slips, and only on and after the pay date (an earlier slip reads as `null`); no other role reads pay slips. The saved bank account is never returned in full: views carry the bank name and last four digits, and the number stays encrypted in the database.
- I8. Company documents. A company's signed master agreement is readable only by `client_hr` of that company and by `onboarding_specialist`; another company's document, or an unknown id, is `404` (as I6), `worker` and `finance` get `403`, no session `401`. The route verifies the stored SHA-256 and the recorded signature seals before sending bytes and answers `409` when they do not match. Signing is refused when the session user is not `client_hr` (`FORBIDDEN_ROLE`), and a task-based signature only completes an `accept_agreement` task of the actor's own company (otherwise `not_found`). Creating an order is refused (`validation`, field `agreement`) while the company's agreement is unsigned, checked on the server.
- I9. Employee self-service reads and the one write. Home details (`loadEmployeeProfile`), the Benefits page (`loadBenefitsPage`) and the 401(k) change (`changeRetirementElection`, `changeContributionAction`) take no case or user id from the caller: they resolve the case from the session (`loadEmployeeCase`) and return or write that case only, so another employee's data is never returned and never changed. Only `worker` may call them (`FORBIDDEN_ROLE` otherwise, `unauthenticated` without a session); the change takes a whole percent between 0 and the rule's maximum and records a new election version for the next pay period that has not started, never rewriting a period already invoiced ([billing-and-invoicing.md](./billing-and-invoicing.md) §13). The profile never reads the SSN or date of birth. `GET /worker/documents/[id]/view` follows the same rule as `/download`: 401, 403, 404 for a document that is not the caller's, 409 when the stored copy fails its hash or seal.
- I6. A case of another company, or one that does not exist, is indistinguishable: `NotFoundError` → `not_found`, never `forbidden`, so existence does not leak across tenants. A wrong *role* on a case you can see is `FORBIDDEN_ROLE`.

## 4. Ownership predicates

| Predicate | Definition |
| --- | --- |
| `ownsCase(user, case)` | `user.role === "worker" && case.workerUserId === user.id` |
| `sameClient(user, case)` | `user.role === "client_hr" && hire.clientCompanyId === user.clientCompanyId` |
| `sameCompany(user, invoice \| payment \| method)` | `user.role === "client_hr" && row.companyId === user.clientCompanyId`; `finance` passes for every company on reads |
| `ownsPaySlip(user, slip)` | `user.role === "worker" && slip.workerUserId === user.id && slip.payDate <= today` |
| `canAccessDocumentBytes(user, doc, case)` | `user.role === "onboarding_specialist"` **or** `ownsCase(user, case)` |
| `canActOnTask(task, actor, parties)` | some party `p` in `task.actors` such that: `client` → `client_hr` of the case's company; `worker` → the case's worker; `specialist` → `onboarding_specialist`; `finance` → `finance`; `system` → never ([tasks-and-workflow.md](./tasks-and-workflow.md) §5.6) |

`canAccessDocumentBytes` MUST use the three-argument form (a role-only predicate cannot express the worker-owner case). The task predicate is part of the engine (`src/domain/tasks/authorization.ts`) and is checked inside `completeTask` and `rejectTask`, so no caller can skip it.

## 5. Enforcement rules (MUST)

- F1. **Server first.** Every Server Action and Route Handler MUST resolve the session and call `requireRole(...)` before reading request input or touching the database. UI hiding is not enforcement.
- F2. **Portal guards.** Layouts under `/client`, `/worker`, `/onboarding`, `/finance` MUST call `requirePortalUser(<role>)`: no session → redirect `/pick`; wrong role → redirect to that role's home (`ROLE_HOME`). Guards are convenience; F1 still applies to every action reachable from the page.
- F3. **Row scope.** After role check, actions touching a case MUST apply the §4 predicate for `worker` and `client_hr`.
- F4. **Domain inside the transaction.** Mutations MUST open one transaction, re-read the case `lifecycle` and its tasks, call the domain operation, write the task and lifecycle changes, events and effects, and commit. Never trust state from the form.
- F5. **Document bytes.** `GET /api/documents/[id]` MUST: `requireUser` → load document + case → `canAccessDocumentBytes` → stream from `storagePath` resolved under the uploads root, refusing any resolved path outside it (`403`). Responses MUST set `Content-Disposition: inline; filename="<fileName>"` and `Cache-Control: private, no-store`.
- F6. **No byte leakage to client_hr.** Client portal pages MUST NOT render `<a href>`/`<img src>` pointing at `/api/documents/*`. A Playwright assertion checks this (#29).
- F7. **Session errors are not 500s.** `AuthError("unauthenticated")` → redirect `/pick` for pages, `{ ok:false, code:"unauthenticated" }` for actions. `AuthError("forbidden")` → `403` for route handlers, `{ ok:false, code:"forbidden" }` for actions.
- F8. **Fail closed.** Unknown `userId` in a valid cookie (e.g. after reseed) is treated as no session.
- F9. **Seed secret.** `SESSION_SECRET` defaults to a dev constant; production deploys MUST set it (≥ 32 chars). Not a demo blocker.
- F10. **Employee login path.** The picker's Employees tile signs in through `pickEmployee(userId)`, which MUST accept only the id of an existing user whose role is `worker`; any other id (staff, client HR, unknown, empty) redirects to `/pick` and writes no session. `searchEmployeesAction` runs before a session exists, like the picker's persona tiles, and returns only id, name, email, company name and person status of `worker` users, at most 100 rows per call.

## 6. Server Action contract

Every mutating Server Action in `src/app/**/actions.ts` MUST have this shape:

```ts
type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; code: ActionErrorCode; message: string; details?: Record<string, unknown> }

type ActionErrorCode =
  | "unauthenticated" | "forbidden" | "not_found" | "validation"
  | DomainError["code"]   // see domain.md §10
```

Rules:

- R1. Actions MUST return `ActionResult`, never throw for expected failures (auth, domain, validation). Unexpected errors propagate.
- R2. Input MUST be validated/narrowed before the domain call; invalid input → `code: "validation"`.
- R3. `message` is user-safe and actionable ("Hourly wage $7.24 is below the CA floor of $16.50"). `details` carries machine data (`missing`, `floorCents`).
- R4. On `ok: true` the action MUST `revalidatePath` the affected portal routes so the timeline updates without a hard refresh.
- R5. Actions MUST NOT accept a task status, the case `lifecycle`, the acting user's id, or a `role` from the client; identity comes from the session. Permitted client-supplied values: entity ids (`caseId`, `taskId`, `documentId`,  the persona `userId` on `pickPersona` and `pickEmployee`, which *are* the login), user-entered fields, and task payloads, which the task's handler validates; a stale `taskId` is checked against the database (`TASK_NOT_READY`).

## 7. Out of scope

Passwords, OAuth, MFA, session rotation, rate limiting, audit log beyond `case_events`, field-level encryption, CSRF beyond Next.js Server Action defaults, multi-tenant row isolation beyond §4.

## 8. Verification

Unit (`src/auth/__tests__/`):

1. `requireRole`: each of the 4 roles passes for itself and fails `forbidden` for the other 3; `null` user → `unauthenticated`.
2. Session resolve: missing cookie, tampered cookie, and valid cookie with unknown `userId` all resolve to `null`.
3. `canAccessDocumentBytes`: table — specialist ✓, finance ✗, worker-owner ✓, worker-non-owner ✗, client_hr ✗ (even `sameClient`).

Server / action tests (owned per [issue-map.md](./issue-map.md)):

4. I1: `finance` completing or rejecting `verify_i9_section2`, `onboarding_specialist` completing `confirm_deposit`, a worker completing another worker's task, and anyone completing a system task → `FORBIDDEN_ROLE`; no event written; tasks unchanged (`src/server/__tests__/cases.test.ts`, `src/domain/tasks/__tests__/engine.test.ts`).
5. I2: `client_hr` session `GET /api/documents/doc_list_a_1` → `403`; `onboarding_specialist` → `200` with image bytes, `finance` → `403`; no session → redirect/401.
6. I3 and I6: a `worker` completing a task of a case it does not own → `forbidden`; a `client_hr` of another company cancelling, terminating, reactivating or completing a task → `not_found`; `onboarding_specialist`, `finance` and `worker` cancelling → `forbidden`.
7. Path traversal: a document row whose `storagePath` resolves outside the uploads root → `403`.
8. I7 (`src/server/__tests__/billing.test.ts`, `billing-queries.test.ts`): a client of another company paying, reading or listing another company's invoices and payments gets not found, null or nothing; a worker, specialist or Finance starting a payment, and a client, specialist or worker settling, failing or voiding, get `FORBIDDEN_ROLE` with nothing written; a worker reads only their own pay slips and a slip is `null` the day before its pay date; the saved method view contains no encrypted material.
10. Finance portal ([finance-portal.md](./finance-portal.md), `src/server/__tests__/finance-portal.test.ts`, `src/app/finance/__tests__/actions.test.ts`): `client_hr`, `worker` and `onboarding_specialist` calling `settlePayment`, `failPayment`, `voidInvoice` or `markDepositReceived` get `FORBIDDEN_ROLE`, and every Finance Server Action returns `forbidden` (`unauthenticated` without a session), with nothing written and nothing revalidated; `listPendingDeposits`, `financeOverview`, `previewBillingRun`, `financeInvoicePdfInput` and the company and count queries throw `FORBIDDEN_ROLE` for the same roles.
9. F10: `pickEmployee` with a worker id saves the session and lands on `/worker`; with every non-worker id, an unknown id and an empty id it redirects to `/pick` and saves nothing (`src/auth/__tests__/pick-employee.test.ts`). `searchEmployees` returns only `worker` users (`src/server/__tests__/personas.test.ts`).
11. I9: `src/server/__tests__/employee-profile.test.ts` (another employee's data is never returned, whoever asks; no SSN, date of birth or full account number), `src/server/__tests__/employee-benefits.test.ts` and `src/app/worker/benefits/__tests__/actions.test.ts` (other roles and no session are refused with nothing written, only the own election changes, out-of-range is a field error, the same percent twice records once), `src/app/worker/documents/[id]/view/__tests__/route.test.ts` (401, 403, 404, 409, inline headers).

E2E (#29): wrong-persona navigation to each portal redirects; client case page contains no `/api/documents/` URLs.
