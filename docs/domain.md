# Domain rules

## 1. Purpose and assumptions

This spec owns the business rules that are independent of UI and storage: the order chain, agreement and markup, benefit packages, I-9 evidence lists, reject reason codes, wage safeguards, policy snapshot, person status and timeline event types. How an order is onboarded (tasks, workflow template, engine) is owned by [tasks-and-workflow.md](./tasks-and-workflow.md). It is implemented as pure TypeScript under `src/domain/` (see [architecture.md](./architecture.md) §3) and tested with Vitest.

Assumptions:

- US-only, single provider and client ([product-overview.md](./product-overview.md) §2).
- Role ids are those in [acl.md](./acl.md) §2; the case lifecycle is defined in [case-state-machine.md](./case-state-machine.md) §2 and the task model in [tasks-and-workflow.md](./tasks-and-workflow.md). This document uses but does not define them.
- Storage shapes for every contract below are in [data-model.md](./data-model.md).
- Nothing here is legal advice; constants are demo values.

## 2. Entities and ownership (summary)

| Entity | Owner persona | Created by | Notes |
| --- | --- | --- | --- |
| Provider | — | seed | Exactly one (`provider_1`) |
| ClientCompany | — | seed | Exactly one (`client_1`) |
| ClientAgreement | client company | seed | One per client; `draft` or `signed` |
| Role | client company | `client_hr` | Job roles defined per company; a person's title is their role |
| HireRequest | client company | `client_hr` | Immutable comp after the order is created (snapshot); carries the requested `startDate` and an optional `endDate` (employment term, §2.2) |
| OnboardingCase | hire | created with the order | One case per order; stored `lifecycle` (`open`, `cancelled`, `terminated`) plus frozen order facts and a template id |
| WorkflowTemplate | provider | seed | Versioned workflow definition (data); a case keeps the version it started from |
| Task | case | the engine | A concrete step of the case's task graph; owner party, assignee, status, due date |
| CaseDocument | case | `worker` | Append-only metadata + bytes on disk |
| CaseEvent | case | any operation | Append-only timeline |

### 2.1 Hire creation

- H1. `createOrder` (by `client_hr`) creates the person at the same time: first name, last name and email become a new `users` row (`role = worker`, the actor's client company). The email MUST be unused (`DomainError("EMAIL_TAKEN")`), so a worker never has more than one case. The seed keeps one worker with no case (`user_worker_2`) so that persona can still sign in.
- H3. A hire references a `Role` of the actor's company (`roleId`, required). There is no free-text job title: the title shown anywhere is the role's name, and the snapshot freezes it as `roleTitle`. Unknown or other-company roles are `not_found`.
- H4. Desired start dates need at least **5 business days** of notice: `desiredStartDate ≥ addBusinessDays(requestDay, 5)` (Mon–Fri; holidays are out of scope). Violations throw `DomainError("START_DATE_TOO_SOON", { earliest, startDate })`. The UI disables earlier days in the calendar; the server enforces the same rule.
- H2. The `/client/people/new` ("Start a hire") action calls `createOrder` ([case-state-machine.md](./case-state-machine.md) §3 T0): one transaction creates the person, the hire with its frozen snapshot, the case (`open`), the frozen order facts and the task graph, and emits `order_created`. When the master agreement is still `draft` and the client accepts it in the request, the agreement is signed in the same transaction (`agreement_signed`) and no `accept_agreement` task is created. The client UI has no separate agreement page. There is no draft or submit step: an order is real when it is created.

### 2.2 Employment term

A hire is either **indefinite** (no end date) or a **fixed term** that ends on an inclusive end date. Implemented in `src/domain/employment-term.ts`; pure, with `now` injected. Dates are plain `YYYY-MM-DD` days in local time.

- M1. Storage. `hire_requests.end_date` is a nullable ISO date; `null` means indefinite. There is no separate flag. The snapshot freezes the term as `endDate` (§8), but `end_date` on the hire is the live value, because reactivation can renew it (M7).
- M2. Validation. An end date must be a real calendar day strictly after the start date: otherwise `DomainError("END_DATE_BEFORE_START", { startDate, endDate })`. `createOrder` enforces it (after the wage floor); the form field maps the error to `endDate`. The date picker disables days up to and including the start date.
- M3. Inclusive end. The person is employed through the end date. `isTermEnded(endDate, now)` is true only when `endDate < todayIso(now)` (local date); an indefinite term never ends.
- M4. Derived status. There is no background job and no system actor: a person whose go-live has been reached and whose term has ended is **inactive** (§9.2), computed whenever status is read. The stored lifecycle stays `open`.
- M5. Quote over the term (§7.2 Q7). The hire quote for a fixed term is priced over the term; an indefinite hire is priced as before; the standalone cost calculator is not affected.
- M6. Termination bound. For a fixed-term person, the last working day of T10 (terminate) cannot be after the end date: `DomainError("LAST_DAY_AFTER_END_DATE", { effectiveOn, endDate })`. Ending early is allowed. The dialog's default last working day is `min(today + 14 days, endDate)` (`defaultLastWorkingDay`) and its picker is capped at the end date.
- M7. Reactivation never yields an already-ended person. When the hire's `end_date` is before today (a `terminated` or `cancelled` person with a past end date, or a live `open` person whose term ended), T11 needs a new term, `newEndDate`: `null` (indefinite) or a date after today (and after the start date); otherwise `TERM_REQUIRED`, `END_DATE_NOT_FUTURE` or `END_DATE_BEFORE_START`. The new `end_date` is persisted on the hire and recorded in the `reactivated` event payload as `{ endDate }` (§9). When the term has not ended, reactivation keeps the existing end date and the payload has no `endDate`.
- M8. Term renewal (no lifecycle change). A live `open` person whose term has ended has no lifecycle to leave, so reactivating them is `clientRenewTerm`: it keeps `open`, updates `end_date` and writes the `reactivated` event. `clientReactivate` delegates to it for such a person, and refuses an `open` person otherwise with `ILLEGAL_TRANSITION` ([case-state-machine.md](./case-state-machine.md) §3).
- M9. The start date is not changed by reactivation. A term renewed after the snapshot was frozen leaves the frozen quote as sent (§8 P3 covers comp, markup and package; the live term is read from `end_date`).

## 3. Client–EOR agreement and markup

Rules:

- A1. Each client company MUST have exactly one `ClientAgreement`.
- A2. `markupPct` is an integer percent (`15` = 15%). It MUST be visible wherever comp is shown to `client_hr` (hire request form, hire summary, person detail) as "EOR fee = `markupPct`% of wage".
- A3. Only `client_hr` MAY sign. Signing sets `status = signed`, `signedAt = now`. Signing an already-signed agreement MUST be refused with `DomainError("AGREEMENT_ALREADY_SIGNED")` and MUST NOT emit an event (the UI hides the control once signed).
- A4. An order MAY be created before the master agreement is signed; the case then has an open `accept_agreement` task for the client ([tasks-and-workflow.md](./tasks-and-workflow.md) §3.1) and `review_order` waits on it. Completing it signs the agreement for the company and completes **every** other open `accept_agreement` task of that client in the same transaction.
- A5. `markupPct` MUST NOT change after `signed` in this demo (no amendment flow).

Derived value: `eorFeeCents = round(wageCents × markupPct / 100)` per wage unit. Computed, never stored except inside the policy snapshot.

See §7.2 for the quote built from `markupPct`: the fee is a percent of wage and the only Northwind charge; there are no flat platform fees.

## 4. Benefit packages

| Package id | Contents (demo) | Rule |
| --- | --- | --- |
| `standard` | Basic medical, dental and vision plan, plus a 2% retirement contribution | Default |
| `premium` | Richer medical, dental and vision plan, plus a 4% retirement match | Opt-in at hire |

- B1. Package is chosen by `client_hr` on the hire and frozen into the policy snapshot.
- B2. Benefits are **offered**, not mandated: no US law requires an employer to provide health coverage (the ACA employer mandate applies only to employers with 50+ full-time equivalents) or a pension (some states require offering a payroll-deduction IRA, with no employer contribution). The employee may decline, so benefit costs are billed only after enrollment. The quote therefore states benefits as "determined after enrollment" and leaves them out of the total; the cost calculator shows what they would add.
- B3. Package prices live in the rate set (§7.2) as data: health premiums per coverage tier (`employee`, `employee_spouse`, `employee_children`, `family`) with the employer's share, and a 401(k) match rule. Employee-only Standard costs the employer $558 a month (AHRQ MEPS-IC 2024 US average employer contribution for single coverage, $6,697 a year), Premium $800 (assumption); the match is 50% (Standard) or 100% (Premium) of deferrals up to 4% of pay, so a 4% deferral is 2% or 4% of wage. Until the worker chooses, the quote assumes employee-only coverage and the default 4% deferral. Tiers, elections and invoicing: [billing-and-invoicing.md](./billing-and-invoicing.md) §4.
- B2. The worker's benefits acknowledgement step (§6) MUST display the package from the snapshot, not from a live hire edit.

## 5. Work authorization (I-9) evidence

Document kinds (owned here; stored per [data-model.md](./data-model.md) §4): `list_a`, `list_b`, `list_c`, `w4`, `other`.

Rules:

- W1. Submission readiness requires **List A xor (List B and List C)**:
  - valid: `{list_a}`, `{list_b, list_c}`
  - invalid: `{}`, `{list_b}`, `{list_c}`, `{list_a, list_b}`, `{list_a, list_c}`, `{list_a, list_b, list_c}`
  Implemented by `isWorkAuthListComboValid(kinds: DocumentKind[]): boolean` in `src/domain/work-auth.ts`. Only the **active** document per kind counts (§5.1).
- W2. I-9 attestation is required before submission. Contract:

  ```ts
  type I9Attestation = {
    status: "citizen" | "noncitizen_national" | "lawful_permanent_resident" | "alien_authorized"
    workAuthExpiresOn?: string // ISO date; required when status === "alien_authorized"
    attestedAt: string         // ISO datetime
  }
  ```

- W3. Reject reason codes:

  | Code | Meaning | Free text |
  | --- | --- | --- |
  | `DOC_ILLEGIBLE` | Image/PDF cannot be read | optional |
  | `DOC_EXPIRED` | Document past expiry | optional |
  | `DOC_MISMATCH` | Name/identity does not match attestation or profile | optional |
  | `WRONG_LIST_COMBO` | Uploaded set violates W1 | optional |
  | `OTHER` | Anything else | **required**, non-empty after trim |

  Contract:

  ```ts
  type RejectReason = { code: Exclude<ReasonCode, "OTHER">; note?: string } | { code: "OTHER"; note: string }
  ```

  A reject without a code, or `OTHER` without a note, MUST be refused by the domain with error code `INVALID_REJECT_REASON`.

### 5.1 Active documents and supersession

- W4. `case_documents` rows are append-only. For each `(caseId, kind)` the **active** document is the row with the greatest `createdAt`. Earlier rows are *superseded* and remain for the timeline.
- W4a. The list documents are one family. A `list_a` upload supersedes the active `list_b` and `list_c`; a `list_b` or `list_c` upload supersedes the active `list_a`. Switching lists therefore leaves exactly the documents of the last list active, wherever the active set is read (readiness, review, the employee's uploads, worker downloads). The family is replayed in upload order (`selectActiveIdentityDocuments`, `src/domain/work-auth.ts`); `w4` and `other` are never superseded by another kind. The `document_uploaded` event lists everything the upload superseded in `supersededDocumentIds` (`supersededDocumentId` stays the previous row of the same kind).
- W5. Readiness (W1) and review ([work-auth-review.md](./work-auth-review.md)) operate on the active set only.
- W6. Documents MUST NOT be uploaded unless the case is `open`, and only by its worker. The `upload_documents` task (or its `fix_documents` rework instance) records which documents the worker submits; its handler requires the active set to satisfy W1 (`INVALID_LIST_COMBO`).

## 6. Worker onboarding tasks

There is no checklist object or checklist state. What the worker has to do is a set of tasks in the case's graph (`accept_invitation`, `sign_agreement`, `personal_details`, `i9_section1`, `upload_documents`, `w4`, `direct_deposit`, later `benefits_decision`), each with its own payload, owner, due date and status ([tasks-and-workflow.md](./tasks-and-workflow.md) §3.1, §6). Completeness is derived: the worker's work is done when those tasks are resolved, and `setup_payroll` is gated on them. Sensitive values (SSN, bank account) are stored encrypted and never appear in a task `result` ([documents-and-signing.md](./documents-and-signing.md)).

Rules:

- C1. Task completion is the only way progress is recorded; there is no separate completeness function.
- C2. A task's handler validates its payload before the task completes. `upload_documents` checks W1 against the case's active documents (`INVALID_LIST_COMBO`); a malformed payload is `INVALID_TASK_PAYLOAD` with the offending `field`.
- C3. A task can be completed once, and only while it is `ready` and its case is `open` (`TASK_NOT_READY`, `CASE_NOT_OPEN`).

## 7. Wage safeguards

Constants (`src/domain/wage.ts`, demo values):

| Key | Hourly floor (cents) |
| --- | --- |
| `FEDERAL` | `725` |
| `CA` | `1650` |
| `NY` | `1650` |

Rules:

- G1. Effective floor for `stateCode` = `max(FEDERAL, STATE[stateCode] ?? 0)`.
- G2. Hourly: `wageCents ≥ floor`.
- G3. `wageUnit` is `hourly`, `monthly` or `annual`. Annual compares `floor(wageCents / 2080) ≥ floor`; monthly compares `floor(wageCents × 12 / 2080) ≥ floor`. The minimum shown to the client is the floor scaled to the chosen frequency (`minimumWageCents`, rounded up so it always passes).
- G4. `assertWageAllowed({ wageCents, wageUnit, stateCode })` throws `DomainError("WAGE_BELOW_FLOOR", { floorCents, effectiveHourlyCents })` on violation. Called when the order is created. `stateCode` MUST be a two-letter US code; unknown codes use the federal floor.
- G5. Non-positive `wageCents` is `WAGE_BELOW_FLOOR` as well.

### 7.1 Roles

- R1. A role is a name per client company, unique ignoring case and surrounding whitespace (`ROLE_NAME_TAKEN`). Anyone with `client_hr` in that company can define one; it is created inline from "Start a hire"; there is no separate Roles page.
- R2. Roles have no wage, location or department: those belong to the person. Editing a role therefore never changes anyone's compensation.
- R3. Deleting is not offered yet. The rule when it is: a role referenced by any hire request (in any state, including cancelled and terminated) cannot be hard-deleted; it is **archived** instead (hidden from new-hire pickers, still shown on the people who have it). Only a never-referenced role may be deleted. The check runs in the delete transaction, backed by the `hire_requests.role_id` foreign key.

### 7.2 Quote and employer costs

`buildQuote` and `costsForPeriod` (`src/domain/quote.ts`) are the one place employer cost is computed. The hire quote, the cost calculator and every payroll invoice ([billing-and-invoicing.md](./billing-and-invoicing.md)) call the same per-period function, so a quote equals what is invoiced to the cent. Rates live in a versioned rate set (`src/domain/cost-rates.ts`, id `us-2026`).

Lines, each with a stable code, a group, a basis, and monthly and annual cents (stored; screens show one frequency):

| Group | Codes | Rule |
| --- | --- | --- |
| wage | `WAGE` | Gross pay, annualized (hourly × 2080, monthly × 12); paid biweekly, so annual ÷ 26 a period (80 hours for hourly) |
| statutory | `SOCIAL_SECURITY`, `MEDICARE`, `FUTA`, `SUTA`, `WORKERS_COMP` | Always charged |
| service_fee | `SERVICE_FEE` | `markupPct` of each period's wage, rounded per period; the only Northwind charge |
| benefits | `HEALTHCARE`, `RETIREMENT` | Only if the worker enrolls; excluded from `totals.committed` |

- Q1. Committed total = wage + statutory + service fee. `withBenefits` adds the benefit lines.
- Q2. Statutory cost is computed **per biweekly pay period** by `statutoryCostsForPeriod` with year-to-date wages, so each tax stops at its annual wage base. The quote is the sum of the periods it simulates (Q7): 26 for an indefinite quote, the real pay periods of the term for a fixed term. Invoicing calls the same function with the real period and year-to-date wages, so **quote == invoice**: the sum of a person's invoices equals `quote.term.committedCents` (or `withBenefitsCents` when enrolled in the assumed benefits) to the cent, and a tax year's 26 invoices equal the indefinite quote. The pay calendar (Monday–Sunday periods paid the following Friday; the tax year is the year of the pay date) is owned by [billing-and-invoicing.md](./billing-and-invoicing.md) §2.
- Q3. A snapshot stores the whole quote (`rateSetId`, lines, totals), so later rate changes never alter a sent request. A quote read from a snapshot is shown as stored.
- Q4. Not modelled: state paid-leave levies and disability programs, wages earned earlier in the year elsewhere, experience-rated or surcharged unemployment rates, class-code workers' comp.
- Q5. Display: a quote is shown in one column in the hire's pay frequency (per hour, month or year), derived from annual cents with `perUnitCents`, as an average (unemployment taxes fall on a year's first pay periods; the display averages the 26 biweekly periods and does not show them one by one). Categories (statutory costs, benefits) are collapsed to a total and expand to their lines; the per-line basis text is not shown. The chevron sits right after the category label; there is no table header and no "per year" wording; the amounts follow the frequency the client chose. Sections of the quote step and the calculator use the same `FieldSet` + `FieldLegend` heading style and spacing as the form sections. In the hire flow the quote ends with a deposit row, one month of the committed total (the monthly figure, capped at the term total for a very short fixed term); the calculator has none. The calculator hides the result while the amount is below the state minimum wage.
- Q7. Fixed-term quote. `buildQuote` takes an optional `term: { startDate, endDate }`. Without it the quote simulates the 26 pay periods of a notional tax year (year-to-date wages start at 0): its annual figures are the sum of 26 biweekly invoices, and it is what the calculator and an indefinite hire use. With it the costs are simulated over the actual pay periods that overlap the term: the first and last period are prorated by calendar days inside the term ÷ 14 (the end date is inclusive), year-to-date wages start at 0 on the first period and **reset when the pay date's year changes** (the Social Security, FUTA and SUTA wage bases are per calendar year, and wages are taxed in the year they are paid), the service fee is `markupPct` of each period's wage, healthcare is the employer share of the premium prorated by days, and retirement is the match on the default deferral. Each line and total keeps `annualCents` and `monthlyCents` as **annualised rates**: wage, service fee and benefit lines are those of the indefinite quote (the displayed salary is the entered one), and the statutory lines are `round(termCents × 364 ÷ days employed)` (364 = 26 periods × 14 days), so `perUnitCents` and the hourly/monthly/annual display read as term averages; the statutory lines differ from the indefinite quote because a shorter run of wages consumes the wage bases sooner. The quote carries `term?: { startDate, endDate, committedCents, withBenefitsCents }` with the absolute cents for the term; an indefinite quote, and any snapshot frozen before terms existed, has none. A term covering exactly the 26 pay dates of a tax year prices the same as an indefinite quote. The quote breakdown adds a "Total for term (Mar 1 – Aug 31)" row (absolute dollars, years shown only when the term crosses a year).
- Q6. Changing the pay frequency in a form re-expresses the amount in the new frequency instead of reinterpreting the typed number: the exact annual pay behind the last typed value is kept (`useCompValue`), so Annually → Monthly → Annually returns the same figure.

Sources for `us-2026`:

| Item | Value | Source |
| --- | --- | --- |
| Social Security | 6.2% up to $184,500 | IRS Publication 15 (2026) |
| Medicare | 1.45%, no cap | IRS Publication 15 (2026) |
| FUTA | 0.6% on the first $7,000 (6.0% less the 5.4% state credit) | IRS Form 940 instructions |
| State unemployment | New-employer base rate and taxable wage base per state (51 jurisdictions) | US DOL Office of Unemployment Insurance, [Significant Provisions of State UI Laws, January 2026](https://oui.doleta.gov/unemploy/content/sigpros/2020-2029/January2026.pdf). LA, MN, MT, NM, UT, WA and WY publish only an industry average; 2.0% is assumed |
| Workers' comp | 0.25% of wage (assumed, office roles) | Assumption; real premiums use class codes (NCCI, CA WCIRB) |
| Healthcare | Employee-only employer cost $558 / $800 a month (Standard / Premium); other tiers are demo assumptions with employer shares of 70–80% | AHRQ MEPS-IC 2024 average (Standard single coverage); KFF 2025 Employer Health Benefits Survey for the worker share (16% single, 26% family); Premium and the other tiers are assumptions |
| 401(k) | Elective deferral limit $24,500; compensation limit $360,000; match 50% / 100% of deferrals up to 4% of pay (Standard / Premium); default deferral 4% | IRS Notice 2025-67 (2026) for the limits; the match is an assumption |

Cross-check: for a $2,964 monthly gross, Social Security ($183.77), Medicare ($42.98) and workers' comp ($7.41) match a published Deel quote to the cent (tested). Deel applies federal and state unemployment to every month without wage bases, so those two lines are lower here.

## 8. Policy snapshot

Frozen when the order is created (`createOrder`, [case-state-machine.md](./case-state-machine.md) §3). Stored as JSON in `hire_requests.policy_snapshot_json`.

Contract (`src/domain/policy-snapshot.ts`):

```ts
type PolicySnapshotV1 = {
  version: 1
  hireId: string
  capturedAt: string                   // ISO datetime
  roleTitle: string
  workerType: string                   // e.g. "w2_employee"
  comp: { wageCents: number; wageUnit: "hourly" | "monthly" | "annual"; stateCode: string }
  wageFloor: { effectiveHourlyCents: number; source: "FEDERAL" | string }
  package: "standard" | "premium"
  markupPct: number
  eorFeeCents: number                  // round(wageCents * markupPct / 100)
  benefits: { baselineHealth: true; electives: boolean }   // electives === (package === "premium")
  endDate?: string | null              // §2.2 M1; null = indefinite; absent on snapshots frozen before terms existed
  quote?: Quote                        // §7.2; absent on snapshots frozen before quotes existed
}
```

Rules:

- P1. `buildPolicySnapshot(input, now)` is pure and deterministic; it MUST return `Object.freeze`d output.
- P2. Once `policy_snapshot_json` is non-null it MUST NOT be overwritten. The domain API exposes no mutator; an order is created once.
- P4. `PolicySnapshotInput` also carries `startDate` and `endDate`; with both, the frozen quote is priced over the term (§7.2 Q7). The hire form calls `buildQuote` with the same term, so the quote shown is the quote frozen. `parsePolicySnapshot` reads `endDate` and `quote.term` leniently (missing or malformed means absent).
- P3. Portals that display comp, markup or package for an ordered hire MUST read from the snapshot, not from live `hire_requests`/`client_agreements` columns.

## 9. Timeline event types

Owned here; stored in `case_events` ([data-model.md](./data-model.md) §4). Emission points are in [case-state-machine.md](./case-state-machine.md) §3 and [tasks-and-workflow.md](./tasks-and-workflow.md) §5.

| `type` | Actor role | `payload_json` |
| --- | --- | --- |
| `order_created` | `client_hr` | `{ hireId, snapshotCapturedAt }` |
| `agreement_signed` | `client_hr` | `{ agreementId, markupPct }` |
| `task_completed` | any role, or none (system tasks) | `{ taskId, key, label, party, result?: object }` (`label` is the task's `completedLabel`; `result` never holds sensitive data) |
| `task_rejected` | `onboarding_specialist` (or any role the task's `actors` allow) | `{ taskId, key, label, reason: RejectReason, spawnedTaskIds: string[] }` |
| `task_reopened` | `finance` (a failed deposit payment), or none | `{ taskId, reopenedTaskId, key, label, note }` (a finished step gets a new instance, [tasks-and-workflow.md](./tasks-and-workflow.md) §5.8) |
| `benefit_election_changed` | `worker` | `{ version, effectiveFrom, payDate, previousDeferralPct, retirementDeferralPct }`: the employee changed their 401(k) percent from the pay period starting `effectiveFrom` ([billing-and-invoicing.md](./billing-and-invoicing.md) §13) |
| `document_uploaded` | `worker` | `{ documentId, kind, supersededDocumentId?: string, supersededDocumentIds?: string[] }` |
| `ops_note` | `onboarding_specialist` | `{ note: string }` (no lifecycle change) |
| `request_cancelled` | `client_hr` | `{ note?: string }` |
| `terminated` | `client_hr` | `{ effectiveOn: string, note?: string }` |
| `reactivated` | `client_hr` | `{ note?: string, endDate?: string \| null, restarted?: true }` (`endDate` only when a new term was chosen, §2.2 M7; `null` = indefinite; `restarted` when a cancelled onboarding was restarted) |

- E1. Events are append-only; no update or delete path exists.
- E2. Every lifecycle operation and every task completion or rejection writes its event in the same transaction as the change ([architecture.md](./architecture.md) §4). System tasks that run inside a settle pass write `task_completed` with no actor, in that same transaction.
- E3. The client Onboarding tab shows the stage stepper; these events, except task completions (which are the stages), sit in a collapsed Activity note ([tasks-and-workflow.md](./tasks-and-workflow.md) §9).

## 9.1 Onboarding progress (client view)

Owned by [tasks-and-workflow.md](./tasks-and-workflow.md) §8; implemented in `src/domain/tasks/projection.ts`. There are no steps, step estimates or deadline model any more: progress, "waiting on", next step and at-risk are all computed from the case's tasks. In short:

- O1. Progress is `{ done, total }` over tasks that block go-live (skipped excluded, rework counted once).
- O2. Waiting on is the party owning the ready blocking tasks (the client sees You, Worker or Northwind).
- O3. A task is overdue when it is open and its due date is before today. Due dates come from the template: offsets from the start date, never earlier than the day the task was created.
- O4. At risk when the case is `open`, has not gone live, and an open blocking task is overdue or the start date has passed. A case that has gone live, or is cancelled or terminated, is never at risk. There is no "N days late" figure.
- O5. The UI says it plainly ("Due Oct 22", "Was due Oct 20"). Due dates are derived from the template, not SLAs, and are stored per task.
- O6. The Onboarding tab shows **stages**, not tasks ([tasks-and-workflow.md](./tasks-and-workflow.md) §3.2, §8.1): a status headline, one vertical stepper of the template's stages, and only the steps the client must do as prominent rows. A task the client may act on carries its action inline (pay the deposit, accept the agreement). System plumbing never shows, and customer-visible steps use plain-language labels from the template.

## 9.2 Person status (client view)

Owned here; implemented in `src/domain/person-status.ts`. The client sees three statuses derived from the stored lifecycle and the case's tasks.

| Person status | Derivation |
| --- | --- |
| `onboarding` | lifecycle `open` and go-live not reached |
| `active` | lifecycle `open`, go-live reached, and the fixed term has not ended |
| `inactive` | lifecycle `cancelled` or `terminated`; or go-live reached and `end_date < today` (§2.2 M3, M4) |

Go-live is reached when every task that blocks it is resolved and the start date has arrived ([tasks-and-workflow.md](./tasks-and-workflow.md) §5.5).

- Q1. `personStatusFor({ lifecycle, goLiveReached, endDate, now })` is the only mapping. The people list filters by the same conditions in SQL (`statusCondition` in `src/server/queries.ts`: no open blocking task and `start_date ≤ today`), never by re-deriving; the status sort uses the same conditions. A test keeps the SQL and the domain function in agreement. `listPeople` takes `now` (default `new Date()`) so tests control "today".
- Q2. Onboarding people show what they are waiting on beside the status ("Onboarding · Worker"), ; inactive people show how and when they ended ("Cancelled Oct 10", "Ended Oct 20", from the last lifecycle event or the end date). The profile's inactive banner reads "Their last working day was <date>." for a terminated person (the `terminated` event's `effectiveOn`) and for an ended term (the end date). The people list has no end-date column; the profile Details tab shows a read-only "End date" (the date, or "Indefinite") after the start date.

## 9.3 People list query (client view)

Implemented in `src/lib/people-query.ts` (pure parsing and URL state) and `listPeople` in `src/server/queries.ts` (SQL).

- L1. All list state lives in the URL: `q`, `status` (§9.2), `location` (two-letter), `role` (a role id), `sort` (`name`, `role`, `location`, `status`), `dir` (`asc`/`desc`), `page`, `size` (10, 25, 50, 100). Defaults are omitted from the URL. Unrecognised values fall back to defaults; parsing never throws.
- L2. `q` matches name or email, case-insensitively, with `%` and `_` taken literally. `status`, `role` and `location` are exact matches. Filters combine with AND.
- L3. With no `sort`, rows are most recent activity first. A header click cycles none → ascending → descending → none. Sort columns are a whitelist mapped to SQL; ties break on recent activity, then id.
- L4. Any filter, sort or page-size change returns to page 1. A `page` past the end is clamped to the last page.
- L5. The result carries `total` (matching), `companyTotal` (ignoring filters, to tell "no people yet" from "no matches"), `totalPages`, the company's distinct locations and the roles at least one person holds (for the filters). Pagination hides when `total` fits in the smallest page size; the filter bar is always visible once the company has people.

## 10. Domain error contract

```ts
class DomainError extends Error {
  code:
    | "ILLEGAL_TRANSITION" | "FORBIDDEN_ROLE" | "WAGE_BELOW_FLOOR"
    | "CHECKLIST_INCOMPLETE" | "INVALID_LIST_COMBO" | "INVALID_REJECT_REASON"
    | "AGREEMENT_ALREADY_SIGNED" | "WORKER_ALREADY_ASSIGNED"
    | "ROLE_NAME_TAKEN" | "EMAIL_TAKEN" | "START_DATE_TOO_SOON"
    | "END_DATE_BEFORE_START" | "END_DATE_NOT_FUTURE" | "LAST_DAY_AFTER_END_DATE" | "TERM_REQUIRED"
    | "INVALID_PAYMENT_SELECTION"
  details?: Record<string, unknown>
}
```

Server Actions map `DomainError` to the `ActionResult` contract in [acl.md](./acl.md) §6; they MUST NOT swallow it.

## 11. Out of scope

E-Verify; real state wage tables beyond the demo constants; document OCR or expiry parsing; agreement amendments; more than one case per worker (see H1); archiving or deleting roles (see §7.1); payroll runs, payment processing and holiday calendars (invoice generation is in [billing-and-invoicing.md](./billing-and-invoicing.md)).

## 12. Verification

Vitest under `src/domain/__tests__/` MUST prove:

1. W1 table above exactly (all eight combinations).
2. `RejectReason`: each non-`OTHER` code accepted with and without note; `OTHER` without note → `INVALID_REJECT_REASON`.
3. Tasks: the engine, template, condition, due-date, rework and lazy go-live suites in [tasks-and-workflow.md](./tasks-and-workflow.md) §11.
4. Wage: `724` hourly in `TX` refused; `725` accepted; `1649` hourly in `CA` refused; annual `1_508_000` (= 725 × 2080) in `TX` accepted; monthly `125_667` in `TX` accepted, `125_000` refused; `1_507_999` refused; `0` and negative refused.
5. Snapshot: output is frozen (mutation throws in strict mode); same input + same `now` → deep-equal output; `eorFeeCents` and `benefits.electives` derived correctly for both packages.
6. Event types used by `src/domain` are a subset of §9 (compile-time union; a test asserts the union matches the table).
7. H1: `createOrder` with an email that already exists → `EMAIL_TAKEN`; H3: other-company role → not found; H4: a start date one business day short → `START_DATE_TOO_SOON`; A3: second `signAgreement` → `AGREEMENT_ALREADY_SIGNED`; A4: accepting the master agreement completes the company's other open `accept_agreement` tasks.
8. §9.1: progress counts blocking tasks once; at-risk flips exactly when a blocking task becomes overdue or the start date passes; a live, cancelled or terminated case is never at risk.
9. §2.2: an end date not after the start → `END_DATE_BEFORE_START`; a fixed-term quote simulates the real biweekly pay periods, prorates partial first and last periods by days ÷ 14, resets year-to-date wages when the pay date's year changes and, for exactly a tax year's 26 pay dates, equals the indefinite quote, while an indefinite quote does not depend on the term; the sum of a person's invoices equals the quote to the cent ([billing-and-invoicing.md](./billing-and-invoicing.md) §11); a snapshot freezes `endDate` and the term quote; status derives `inactive` for a live person past their end date (and the people-list filter and sort agree); T10 refuses a last working day after the end date; T11 needs a new term when the end date has passed and persists it, and renewing the term of a live person leaves the lifecycle `open`.
