# Tasks and workflow

## 1. Purpose and assumptions

This spec owns how a hire is onboarded. An order does not walk a state machine; it instantiates a **graph of concrete tasks** from a **versioned workflow template**, and one generic engine executes it. Onboarding progress, "waiting on", at-risk, the Onboarding tab (shown as **stages**, §3.2 and §8.1), the person status (`onboarding` / `active`) and per-user inboxes are all **derived from tasks**.

Only the lifecycle that already exists as an explicit decision (cancel, terminate, reactivate, end-date term) stays as stored case state ([case-state-machine.md](./case-state-machine.md)).

Implemented in `src/domain/tasks/` (pure, no I/O, `now` injected), persisted by `src/server/tasks.ts` ([data-model.md](./data-model.md) §4), shown by the client Onboarding tab ([architecture.md](./architecture.md) §5).

Hard rules:

- K1. **No hardcoding.** Nothing in the engine, the queries or the UI names a task key, a person, an id or a date. The workflow is data (§3); the engine is generic (§5); behaviour that differs per task type lives in a handler registry (§6).
- K2. **One transition path.** Every change to a task is made by `completeTask`, `rejectTask`, `reopenTask`, `cancelOpenTasks` or the settle pass that follows them, inside the same transaction as the event that caused it (system tasks included).
- K3. **Seed data is produced by these operations** with generated fake data, never inserted by hand, so any seeded state is reachable by the real rules.
- K4. **Reads are lazy.** Time never changes stored data. Anything that depends on "now" (go-live, overdue, at-risk, term ended) is computed when read.

## 2. Model

### 2.1 Parties and assignees

| Party | Who | Assignee at creation |
| --- | --- | --- |
| `client` | the ordering company | the ordering `client_hr` user (a specific user) |
| `worker` | the hired person | the worker user (a specific user) |
| `specialist` | Northwind onboarding specialist | role queue `onboarding_specialist` |
| `finance` | Northwind finance | role queue `finance` |
| `system` | automation | none; runs inside the transaction that unblocks it |

`Assignee = { kind: "user", userId } | { kind: "role", role } | { kind: "system" }`. A per-user inbox is a query: tasks that are `ready` and assigned to the user, or to the user's role queue (`tasksForInbox`).

### 2.2 Task statuses

| Status | Meaning |
| --- | --- |
| `blocked` | waiting on dependencies |
| `ready` | all dependencies resolved; the owner can act (system tasks run immediately, so they are never observed `ready` except `go_live`) |
| `done` | completed |
| `rejected` | history only: a specialist rejected it; replaced by a new instance (§5.4) |
| `skipped` | its condition was false; counts as resolved and never blocks anything |
| `cancelled` | the case was cancelled or the person terminated while it was open |

Open = `blocked` or `ready`. Resolved = `done` or `skipped`. A task instance is never reopened or edited back from `done`; rework (a rejection, §5.4, or a real-world outcome that did not hold, §5.8) creates **new instances** and completed history stays.

### 2.3 Task instance

```ts
type Task = {
  id: string; caseId: string
  seq: number                 // creation order within the case; latest instance of a key = highest seq
  templateId: string          // the template version it was instantiated from
  key: string                 // definition key; several instances may share it (rework)
  type: string                // handler id (defaults to key)
  title: string; completedLabel: string; description: string
  phase: string
  party: TaskParty; actors: TaskParty[]   // owner, and who may complete it (default [owner])
  assignee: Assignee
  status: TaskStatus
  blocksGoLive: boolean
  dueDate: string | null      // ISO day
  dependsOnKeys: string[]     // resolved to the latest instance of each key
  dependsOnTaskIds: string[]  // explicit instances (rework)
  context: Record<string, Json>  // facts copied in at creation, e.g. { amountCents }
  result: Record<string, Json> | null
  spawnedByTaskId: string | null
  completedAt / completedByUserId
}
```

## 3. Workflow template (data)

A template is a JSON document stored in `workflow_templates` (`key`, `version`, `definition_json`). A case keeps the template id it was created from; publishing version 2 never changes a running case. The default template is `us_eor_onboarding` v2 (`src/domain/tasks/default-workflow.ts`, seeded as a row). Version 2 added the customer-facing stages (§3.2); cases created from version 1 keep that version and read it through the phases fallback (§8.1).

```ts
type WorkflowTemplate = {
  key: string; version: number; title: string
  phases: { id: string; title: string }[]
  stages?: StageDefinition[]        // §3.2; absent in v1, readers then derive one stage per phase
  tasks: TaskDefinition[]
}

type StageDefinition = {
  id: string                        // unique; [a-z0-9_]+
  title: string; clientTitle?: string; workerTitle?: string
  description: string               // neutral, third person: what staff and any reader without wording of their own read
  clientDescription?: string; workerDescription?: string   // the same sentence in that reader's voice; default = description
  waitingLabel?: string             // imperative phrase for headlines ("complete their paperwork")
  quiet?: boolean                   // after-start work: a collapsed note, not a step
}

type TaskDefinition = {
  key: string                       // unique; [a-z0-9_]+
  type?: string                     // handler id; default = key
  title: string; completedLabel?: string; description: string
  phase: string                     // one of template.phases
  owner: TaskParty
  actors?: TaskParty[]              // may complete; default [owner]
  dependsOn?: string[]              // keys; must exist, graph must be acyclic
  condition?: Condition             // false => skipped (§4)
  due?: { offsetDays: number; minDaysFromCreation?: number }  // relative to the start date
  blocksGoLive: boolean
  context?: Record<string, { fact: string }>   // copy facts into task.context
  instantiate?: "start" | "on_demand"          // default "start"; on_demand only via rework
  rework?: { spawn: string[] }      // rejectable; keys of on_demand definitions to spawn
  trigger?: "go_live"               // the milestone (§5.5); at most one
  stage?: string                    // one of template.stages; required when the template has stages
  hidden?: boolean                  // system plumbing: never a row in client or worker views (§3.2)
  clientLabel?: string; workerLabel?: string   // plain-language title for each audience; default = title
  clientDescription?: string; workerDescription?: string   // one sentence in each audience's voice; default = description
}
```

Validation (`validateTemplate`, run when a template is loaded or published, and by tests): unique keys; every `dependsOn`, `rework.spawn` and `phase` reference exists; `dependsOn` never targets an `on_demand` or `go_live` definition; the dependency graph is acyclic; `system` tasks have no `actors` other than themselves; `rework.spawn` keys are `on_demand`; a `condition` references only known facts (§4) and may reference `result.<key>.*` only when `<key>` is a transitive dependency; a due offset never makes a task due before a dependency that also has a due date (offsets are non-decreasing along dependencies); exactly one `go_live` trigger exists and it is `system`, non-blocking, with no `dependsOn`; and, for stages, §3.2. Violations throw `DomainError("INVALID_WORKFLOW_TEMPLATE", { issues })`.

### 3.1 The default workflow, `us_eor_onboarding` v1 and v2 (v2 adds stages and labels only, §3.2)

Offsets are calendar days relative to the start date `S` (negative = before). A task is never due before the day it is created (§5.1).

| Phase | Key | Owner (actors) | Depends on | Condition | Due | Blocks go-live |
| --- | --- | --- | --- | --- | --- | --- |
| Order | `accept_agreement` | client | | `client.agreementSigned = false` | S−5 | yes |
| Order | `pay_deposit` | client (client, finance) | | `order.depositCents > 0` | S−5 | yes |
| Order | `confirm_deposit` | finance | `pay_deposit` | `order.depositCents > 0` | S−4 | yes |
| Order | `review_order` | specialist | `accept_agreement` | | S−5 | yes |
| Order | `generate_agreement` | system | `review_order` | | S−5 | yes |
| Order | `invite_worker` | system | `generate_agreement` | | S−5 | yes |
| Worker onboarding | `accept_invitation` | worker | `invite_worker` | | S−4 | yes |
| Worker onboarding | `sign_agreement` | worker | `accept_invitation` | | S−4 | yes |
| Worker onboarding | `personal_details` | worker | `accept_invitation` | | S−3 | yes |
| Worker onboarding | `i9_section1` | worker | `accept_invitation` | | S−3 | yes |
| Worker onboarding | `upload_documents` | worker | `i9_section1` | | S−3 | yes |
| Worker onboarding | `w4` | worker | `accept_invitation` | | S−3 | yes |
| Worker onboarding | `direct_deposit` | worker | `accept_invitation` | | S−3 | yes |
| Compliance | `verify_i9_section2` | specialist | `upload_documents` | | S−2 | yes |
| Payroll and start | `setup_payroll` | specialist | `sign_agreement`, `pay_deposit`, `confirm_deposit`, `w4`, `direct_deposit`, `verify_i9_section2` | | S−1 | yes |
| Payroll and start | `go_live` | system (trigger) | all blocking tasks | | S | no |
| After start | `benefits_decision` | worker | `accept_invitation` | `order.benefitPackage` is set | S+30 | no |
| After start | `submit_benefit_enrollments` | specialist | `benefits_decision`, `setup_payroll` | package set and `result.benefits_decision.decision = "enroll"` | S+35 | no |
| After start | `file_new_hire_report` | specialist | `setup_payroll` | | S+20 | no |
| (on demand) | `fix_documents` (type `upload_documents`) | worker | | | S−2, at least 2 days from creation | yes |

Notes. Creating the order **is** the client's signature on the employment agreement; `generate_agreement` therefore records the client signature when it produces the document, and `sign_agreement` records the worker's (so `setup_payroll` is gated on both). The master EOR agreement is company-level and is signed in the signing popup ([documents-and-signing.md](./documents-and-signing.md) §7.6), never by a checkbox. On Create order the client signs it inline before the order is allowed (`signMasterAgreementAction` runs the `sign_master_agreement` effect directly, so no task exists for it); `accept_agreement` exists only when the agreement was still unsigned at order time, and its inline action opens the same popup (`signAgreementTaskAction`), which completes the task through the engine (`completeTaskInTx`). Either path signs it for the company, completes every other open `accept_agreement` of that company, stores the signed PDF and its signature, and the client can download it. `benefits_decision` is offered to the worker from the invitation on but is due 30 days after the start and does not block go-live. `file_new_hire_report` depends only on payroll set-up; "post-start" is its due date, not a gate. The I-9 Section 2 legal outer limit (3 business days after the start date, `business-days.ts`) is only shown as context in its due text; the task is due before the start.

### 3.2 Stages (the customer-facing view)

Tasks are the engine's unit of work and far too granular to show a customer ("Verify I-9 Section 2", "Invite the worker"). A template therefore also defines **stages**: a short, ordered list of customer-readable steps, and every task names the stage it counts toward. Nothing in the UI names a stage or a task; it renders whatever stages the template defines.

Stage order is the order of `stages`. Validation (`validateTemplate`) adds: stage ids are unique and match `[a-z0-9_]+`; when a template has `stages`, every task has a known `stage` and every stage has at least one task; a task that depends on another is never in an earlier stage than its dependency (so the stepper never shows a stage finished before the work it needs); `hidden` is allowed only on `system` tasks; a `quiet` stage holds no blocking work and no `go_live` trigger, and quiet stages come last. A template without `stages` (version 1) must not name a stage on any task.

`hidden` tasks are pure plumbing (the agreement is generated, the invitation is sent, the go-live trigger). They never render as rows in client or worker views, but their completion counts toward their stage, so a stage is never complete while its plumbing is unfinished. `clientLabel` / `workerLabel` are the plain-language titles a customer or employee reads instead of the task `title` ("Identity & work eligibility check" instead of "Verify I-9 Section 2"); the staff audience always reads `title`.

Wording is per audience, from data. Every task and stage has a neutral `description` in the third person ("The worker signs their agreement and completes their personal, tax and payment details."), which staff read. `clientDescription` and `workerDescription` carry the same sentence to the person reading ("Your employee signs…", "Sign your agreement and…"); a reader without one gets `description`. `taskDescription` and `stageDescription` (`src/domain/tasks/stages.ts`) are the only resolvers, and every surface that shows a task or stage to a customer goes through them: `projectStages` (item and stage descriptions, so the client Onboarding tab and the employee stepper and task frames), the task inbox row (`taskDescriptionFor`, which every portal's task list and the generic task page read) and the client onboarding task view. The same applies to the past-tense `completedLabel` that feeds the activity feed: it is written in plain language for everyone who can read the feed (no form numbers, no "the worker"). A customer never reads a sentence about "the worker" or "the client", and the employee never reads "your employee". The employee task screens keep their own, richer copy where a screen has one; the template wording is what the frame, stepper and inbox show without it.

The default `us_eor_onboarding` v3 stages, with the tasks that count toward each:

| Stage (client title) | Tasks (`hidden` marked) |
| --- | --- |
| Confirm your order | `accept_agreement`, `pay_deposit`, `review_order` |
| Invite your employee (employee: "Create your account") | `generate_agreement` (hidden), `invite_worker` (hidden), `accept_invitation` |
| Employee paperwork (employee: "Your paperwork") | `sign_agreement`, `personal_details`, `i9_section1`, `upload_documents`, `w4`, `direct_deposit` |
| Verification (employee: "Document check") | `verify_i9_section2`, `fix_documents` |
| Payroll setup | `confirm_deposit`, `setup_payroll` |
| Start date | `go_live` (hidden) |
| After they start (`quiet`; employee: "After you start") | `benefits_decision`, `submit_benefit_enrollments`, `file_new_hire_report` |

Versioning. Adding stages is a new template version (v2) and per-audience wording another (v3): `ensureWorkflowTemplates` inserts the `us_eor_onboarding@3` row, new orders use the highest version, and every case keeps the version it was created from, so a used version is never redefined (a case on v2 keeps the wording it was created with; its tasks copied the v2 `description`, and the audience fallback is that text). A case on v1 has no stage data, so `projectStages` derives one stage per phase from it (no hidden tasks, no friendly labels): it shows the old phases as stages until its person is reseeded or finished. `pnpm db:seed` rebuilds the demo world on the newest version.

## 4. Conditions and facts

```ts
type Condition =
  | { fact: string; op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte"; value: Json }
  | { fact: string; op: "in"; value: Json[] }
  | { fact: string; op: "set" | "unset" }        // null/undefined = unset
  | { op: "and" | "or"; of: Condition[] }
  | { op: "not"; of: Condition }
```

Facts are a flat map. **Order facts** are frozen on the case when it is created (`onboarding_cases.facts_json`): `order.startDate`, `order.endDate`, `order.fixedTerm`, `order.benefitPackage` (`standard` | `premium` | null), `order.stateCode`, `order.wageUnit`, `order.depositCents`, `order.workerName`, `order.workerEmail`, `client.agreementSigned` (as of order creation, after any inline acceptance). **Result facts** are `result.<key>.<field>` from the latest `done` instance of `<key>`.

Evaluation is three-valued (`true`, `false`, `pending`): a missing fact is `pending`; `and` is false if any part is false, `or` is true if any is true. The settle pass skips a task as soon as its condition is `false`, and also when it is still `pending` after all its dependencies are resolved (the result it wanted was never produced). A condition is therefore evaluated as early as it is decidable, and a skipped task never blocks.

## 5. Engine

All functions are pure (`src/domain/tasks/engine.ts`); they take the current task array and an `EngineContext` (`template`, order `facts`, `now`, `newId`, `handlers`, `parties`, handler `env`) and return `{ tasks, changed, events, effects }`. The service persists `changed`, writes `events`, applies `effects`, and re-reads state with the transaction rule ([architecture.md](./architecture.md) §4).

### 5.1 `instantiateTasks(ctx, existing = [])`

Creates one instance per `instantiate: "start"` definition (assignee by party, §2.1; `context` from facts; due date = `max(S + offsetDays, creationDay + minDaysFromCreation)`), then runs the settle pass. System tasks that become ready run immediately in the same call. `existing` are the case's earlier tasks: a restarted onboarding (reactivating a cancelled case, [case-state-machine.md](./case-state-machine.md) §3) keeps its history and the new instances continue the `seq`; only the new ones are reported as `changed`. Facts come from `buildOrderFacts` (`facts.ts`), the one place the frozen order facts are assembled; a restart builds them again from the current state (agreement now signed, deposit still owed = nothing when the deposit invoice is paid or processing), so a deposit already held creates no new `pay_deposit` task (condition false → `skipped`).

### 5.2 Settle pass

Repeat until nothing changes: for each open task in `seq` order, evaluate its condition (§4) and its dependencies. A dependency on a key means the **latest non-cancelled instance** of that key; `dependsOnTaskIds` are exact instances. `false` condition → `skipped`; dependencies resolved and condition true → `ready`; otherwise `blocked`. A `ready` task whose party is `system` (except the `go_live` trigger) runs its handler with no actor, becomes `done` and emits `task_completed` with a null actor. The graph is finite and acyclic, so the pass terminates.

### 5.3 `completeTask(taskId, actor, payload)`

Checks in this order, each failing with a `DomainError`: the task exists in the case (`TASK_NOT_FOUND`); the actor may act on it (§5.6, `FORBIDDEN_ROLE`); it is `ready` (`TASK_NOT_READY`, with its status); the handler parses the payload (`INVALID_TASK_PAYLOAD`, with `field`). Then: status `done`, `completedAt`, `completedBy`, handler `result`, an event, the handler's `effects`, and the settle pass. A task can be completed exactly once; completing it again is `TASK_NOT_READY`.

### 5.4 `rejectTask(taskId, actor, reason)`

Only tasks whose definition has `rework`. Same authorization and readiness checks, `reason` through `assertRejectReason` (`INVALID_REJECT_REASON`; reuses `RejectReason`, [domain.md](./domain.md) §5 W3), otherwise `TASK_NOT_REJECTABLE`. The task becomes `rejected` (`result = { reason }`, event `task_rejected`). For each key in `rework.spawn` a new instance is created (`spawnedByTaskId` = the rejected task; `context = { reason, rejectedTaskId }`). Then a **replacement instance of the rejected task's own definition** is created whose `dependsOnTaskIds` are the spawned instances, so it is `blocked` until the rework is done and every dependent (which depends on the key, i.e. the latest instance) is blocked again. Rejections are history; there is no loop construct, a second rejection simply spawns another pair.

### 5.5 Go-live (lazy)

The definition with `trigger: "go_live"` becomes `ready` when every latest blocking instance is resolved, and `done` when additionally `today ≥ startDate`. `projectTasks` applies the same rule with the reader's `now` and **never persists**; a mutation after the start date persists it through the settle pass. Nothing depends on `go_live`, so time never has to propagate through the graph.

### 5.6 Authorization

`canActOnTask(task, actor, parties)`: some `p` in `task.actors` such that: `client` → role `client_hr` and the actor's company is the case's company; `worker` → role `worker` and the actor is the case's worker; `specialist` → `onboarding_specialist`; `finance` → `finance`; `system` → never. The assignee decides whose inbox shows the task, not who is allowed: a colleague at the client can pay the deposit.

### 5.7 `cancelOpenTasks`

Open tasks become `cancelled` (used by cancel and terminate). Done, skipped and rejected tasks stay.

### 5.8 `reopenTask(tasks, { key, actor, note }, ctx)`

For a finished step whose real-world outcome turned out not to hold (the deposit payment failed after the client "paid"). It is generic: the engine names no key; the service decides which key to reopen. When the latest instance of `key` is `done` and no latest task that depends on `key` is `done`, it creates a **new instance** of the same definition (`spawnedByTaskId` = the done instance, `context = { reopenedTaskId, note }`), writes `task_reopened` (`{ taskId, reopenedTaskId, key, label, note }`) and runs the settle pass, so every dependent is blocked again (its dependency's latest instance is open). The done instance stays as history. Otherwise nothing changes and no event is written: a step that is not done has nothing to reopen, and once a dependent is done the work has moved on and is not undone. The stage view shows the note on the reopened step ("needs you" row, `StageItem.reopenNote`) and the timeline reads "<label>: try again". The template is untouched (no version bump); the service that reopens a deposit step also restricts it to an `open`, not-yet-live case (billing-and-invoicing B8).

## 6. Handlers and effects

`handlers` maps a task `type` to `{ parse(raw, { task, actor, env }) → payload, complete({ task, payload, actor, now, facts }) → { result?, effects? } }`. Adding a form validation later means replacing one `parse`. `result` is stored on the task, is visible to the client and to conditions, and **must not contain sensitive data**. `effects` are data the service applies in the transaction:

| Effect | Applied as |
| --- | --- |
| `pay_deposit_invoice` | an `initiated` payment of the deposit invoice with the saved method (or the one in `paymentId`); [billing-and-invoicing.md](./billing-and-invoicing.md) §12 |
| `resolve_deposit` | `settled`: the payment succeeds; `received`: a succeeded payment without a method |
| `record_benefit_election` | the case's first election as version 1 of `benefit_election_versions` (`source: onboarding`), and the `benefit_elections` row equal to it; later invoices bill the version in force for their pay period ([billing-and-invoicing.md](./billing-and-invoicing.md) §13). Later changes are not tasks: the employee's Benefits page records them through the same service |
| `sign_master_agreement` | client agreement `signed`, then completes the company's other open `accept_agreement` tasks. The signing service (`src/server/master-agreement.ts`) runs it inside the same transaction that stores the `company_documents` row and its signature; completing the task generically (`{accepted: true}`) still runs it but stores no document |
| `generate_document` | `DocumentGenerator.generate` → `generated_documents` row plus the client's signature |
| `sign_document` | a `document_signatures` row for the worker |
| `store_form` | a `form_submissions` row; `sensitive` fields are encrypted into `encrypted_json` |
| `invite_worker` | placeholder: nothing is sent; the event is the record |

Default handlers (payloads are validated for shape and enums only, so the forms library can tighten them): `accept_agreement {accepted: true}`; `pay_deposit {savedMethodId, paymentId?}` (client: starts the payment; Finance may complete it with `{resolution: "received"}`); `confirm_deposit {resolution: "settled" | "received"}` (Finance); `review_order {note?}`; `generate_agreement`, `invite_worker` (system); `accept_invitation {accepted: true}`; `sign_agreement {typedName}`; `personal_details {legalName, phone, dateOfBirth, ssn, address}`; `i9_section1 {citizenshipStatus, workAuthExpiresOn?}` (`I9Attestation`); `upload_documents {documentIds}` (the active documents of the case must satisfy `isWorkAuthListComboValid`, `INVALID_LIST_COMBO`; the employee's submit service also refuses an upload without its document details); `w4 {filingStatus, …}` (federal only; the case's submission feeds the payroll withholding of every invoice generated afterwards); `direct_deposit {accountHolderName, routingNumber, accountNumber, accountType}` (result `{ last4 }`); `verify_i9_section2 {documentTitle, issuingAuthority, documentNumber, expiresOn?}` (built by the server from the employee's entries on the active `case_documents` rows, never from the specialist's input; for List B + C the titles, issuers and numbers are joined and the earliest expiry is used; `store_form` encrypts the number and the result is `{verified: true}`); `setup_payroll {payFrequency}`; `benefits_decision {decision: "enroll", healthTier?, retirementDeferralPct?}` (at least one of the two) or `{decision: "decline"}`, which records the election; `submit_benefit_enrollments {confirmationNumber}`; `file_new_hire_report {confirmationNumber}`.

## 7. Deposit

`depositCents = min(quote.totals.committed.monthlyCents, quote.term.committedCents)` for a fixed term, else the monthly committed total ([domain.md](./domain.md) §7.2). A zero deposit (for example after a restart that already holds one) skips `pay_deposit` and `confirm_deposit`. It is frozen in the order facts and copied into `pay_deposit.context.amountCents`.

The deposit is an **invoice** (`deposit:<hireId>`, kind `deposit`), created with the order. The client completes `pay_deposit` by choosing the company's saved payment method, which creates an `initiated` payment of that invoice (simulated: no processor). `confirm_deposit` then belongs to Finance: it completes when the payment settles (`settlePayment` completes it automatically), or when Finance records the deposit `received` outside the product. A failed payment makes the invoice payable again and, while the order is open, not yet live and nothing depending on `pay_deposit` is done, reopens `pay_deposit` for the client with a note (§5.8, billing-and-invoicing B8); `confirm_deposit` blocks again until they pay. Cancelling the order voids an unpaid deposit invoice; a restart owes nothing when the deposit was paid or is processing. Refunds and crediting the deposit against invoices are out of scope. The full model is [billing-and-invoicing.md](./billing-and-invoicing.md) §12.

## 8. Derivations (`projectTasks`, `personStatusFor`)

`projectTasks(tasks, { now, startDate })` returns the tasks with their effective status (go-live applied), and:

- `blockingOpen`: open tasks with `blocksGoLive`; `nextTasks`: the `ready` ones, ordered by due date then `seq`.
- `goLiveReached`: the go-live task is effectively `done`.
- `progress`: `{ done, total }` over blocking tasks (skipped excluded, rework counted once: rejected and cancelled instances are history).
- `waitingOn`: the distinct parties owning ready blocking tasks (`system` excluded), ordered by earliest due; the client sees "You", "Worker" or "Northwind" (specialist, Finance and system collapse, [acl.md](./acl.md) I4).
- `overdue(task)`: open and `dueDate < today`.
- **At risk**: the case is open, go-live is not reached, and (some open blocking task is overdue, or the start date has passed). This is the whole rule: it does not predict dependents, because a dependent's own due date is already no later than its dependency's by template validation. Non-blocking tasks (benefits, new-hire report) can be overdue but never put the start at risk.

`personStatusFor({ lifecycle, goLiveReached, endDate, now })`: `cancelled` or `terminated` → `inactive`; otherwise `onboarding` until go-live; after go-live `active`, or `inactive` when the term has ended ([domain.md](./domain.md) §2.2). The people list repeats this in SQL (`statusCondition`: no open blocking task, `start_date ≤ today`) and a test keeps the two identical.

### 8.1 Stages (`projectStages`)

`projectStages(tasks, template, audience, now, startDate?)` (`src/domain/tasks/stages.ts`) is the customer-facing projection of the same tasks; it is pure and never writes. It returns the template's stages in order, each with:

- `status`: `complete` when every counted task is resolved (done or skipped); `current` when something in it is ready now (several stages can be current at once, because work is not strictly sequential: the client can still owe the deposit while the employee does paperwork); `blocked` when it has started but everything left waits on another stage; `upcoming` when it has not started.
- `progress { done, total }` over every counted task of the stage, **hidden plumbing included** (so `done === total` exactly when the stage is complete), and `visibleProgress` over the tasks that render as rows, which is what "4 of 6 steps done" means. Only each key's latest instance counts and skipped tasks are not counted, so rework does not inflate the total; a rejection can lower a stage's done count (a second rejection replaces a finished fix) and nothing else can.
- `waitingOn` (`client` | `employee` | `northwind`): the party owning the earliest-due ready human task; `needsYou`: ready, visible tasks the viewer can act on; `dueDate`: the earliest open due date; `atRisk`: an open blocking task of the stage is overdue (or the go-live milestone is); `milestone`: the stage holds the go-live trigger, so its date is the start date.
- `items`: the rows listed for the audience, in creation order, with the audience's label.
- `rework`: Northwind sent work back. A rejection leaves its rejected instance as history and spawns the rework tasks plus a replacement of the rejected task; the projection shows the **spawned** task once, carrying Northwind's reason, and no rejected rows. A second rejection replaces it (still one).

Audiences:

| Audience | Stages | Rows | Labels |
| --- | --- | --- | --- |
| `client` | all, the `quiet` stage as a collapsed note | only the tasks the client must do are prominent (`needsYou`, with the inline action); the rest are read-only under "View details"; hidden tasks never | `clientTitle`, `clientLabel` |
| `worker` | only stages that hold a task the employee may act on; progress and status are scoped to those tasks | the employee's own tasks only, as a to-do stepper | `workerTitle`, `workerLabel` |
| `staff` | all | every task, hidden plumbing included (the detailed view) | `title` |

Wording (`src/lib/stage-view.ts`): the status headline ("Waiting on you: pay the deposit", "Waiting on Maya Chen: complete their paperwork — 4 of 6 done", "All set — starts Mon, Jan 12"), the stage summary line, and who owns a step ("You", the employee's first name, "Northwind"; provider staff stay collapsed to Northwind for customers, [acl.md](./acl.md) I4). A stage that sent work back is named first in the headline.

## 9. The Onboarding tab

The tab is the **stage stepper** ([ui-guidelines.md](./ui-guidelines.md) C25–C26), not a task list. At the top, one headline sentence of status. Below, the template's stages as one vertical stepper: completed stages collapse to one line with a check (and open to their steps), current stages are expanded with their description, summary ("4 of 6 steps done · waiting on Maya"), earliest due date ("Due Oct 22", "Was due Oct 20" in the danger tone), Northwind's reason when work was sent back, any task the client must do as a prominent row with its action inline (chosen by task `type`: `pay_deposit` shows the amount, `accept_agreement` shows the fee and a **Review and sign** button that opens the signing popup), and a "View details" disclosure of the other visible steps, read-only and in plain language. Upcoming stages are muted. After-start work is one collapsed note. The case's own activity (order, agreement, notes from Northwind, lifecycle; not task completions, which are the stages) sits in a collapsed "Activity" note. The staff and employee audiences use the same component with their own detail ([§8.1](#81-stages-projectstages)). The people list shows the next step in the same friendly wording and "N of M stages done".

## 10. Out of scope

Onboarding specialist, Finance and worker screens (their queues exist as queries only; the employee stage stepper and the staff audience exist as a projection and a component, not wired to a route); real PDF generation and e-sign (the `DocumentGenerator` and `sign_document` seams exist; the placeholder generator records metadata only); real form schemas (handlers validate shape); email delivery; deposit refunds; template editing UI; claiming a role-queue task; SLA timers; holidays in due dates.

## 11. Verification

Vitest MUST prove:

1. Template validation: the default template is valid; duplicate keys, a missing dependency, a cycle, a dependency on an `on_demand` or `go_live` definition, an unknown phase or fact, a result reference outside the transitive dependencies, and decreasing due offsets are each rejected.
2. Conditions: three-valued truth tables; `set`/`unset`; skipped tasks never block; an undecidable condition after its dependencies resolve skips.
3. Instantiation: with and without a package, with the master agreement signed or not, fixed term or indefinite; due dates from offsets and the creation-day floor; assignees by party.
4. Execution: only a `ready` task completes; no task completes before its dependencies; system tasks auto-run in the same call; owners (and listed `actors`) only; `FORBIDDEN_ROLE`, `TASK_NOT_READY`, `INVALID_TASK_PAYLOAD`.
5. Rejection: a rejected `verify_i9_section2` spawns `fix_documents` and a new `verify_i9_section2`; dependents re-block; history is kept; a second rejection works; `INVALID_REJECT_REASON`, `TASK_NOT_REJECTABLE`.
   Reopen (`reopenTask`): a done step gets a new ready instance with the note and its dependents block again; history is kept; nothing happens when the step is not done or a dependent is already done; the deposit service tests cover failing a deposit payment (`markDepositNotReceived`, which Finance's Mark failed calls, and `failPayment`), a multi-invoice payment, a case past `confirm_deposit` and a cancelled order.
6. Lazy go-live: reached exactly when every blocking task is resolved and `today ≥ startDate`; derived on read without writes; persisted by a later mutation.
7. Property tests: random orders (start and end dates, package on or off, agreement signed or not) run through random valid completions; invariants hold at every step (dependency order, blocking tasks done implies go-live possible after the start date, skipped never blocks, owners only, at most one open instance per key, no dependent ready while its dependency is open).
8. Service: create order → tasks in the database and facts frozen; deposit invoice and payment on pay, settle and receive; `accept_agreement` cascades company-wide; generated document row and signatures; sensitive form fields stored encrypted; cancel and terminate cancel open tasks; the inbox and role-queue queries; the people list status and at-risk agree with the domain derivation.
9. Seed: the world is inserted directly and every person comes from `createOrder` and task operations under a simulated clock with seeded-RNG fake data ([data-model.md](./data-model.md) §5); the seed test replays each case's events against the engine and re-derives the stored tasks and lifecycle, and checks that each scenario kind shows the status, waiting-on and at-risk it promises (just ordered, mid-onboarding, rework, waiting for start, active, fixed-term, ended term, cancelled, restarted, terminated, reactivated, at risk).
10. Restart: reactivating a cancelled case instantiates the template again after the cancelled tasks, re-freezes the facts, and keeps history; a held deposit is not asked for again.
11. Stages: the default template's stages cover every task and every stage has a task; validation rejects a missing or unknown stage, an empty stage, a stage out of dependency order, a hidden human task and a blocking quiet stage; hidden tasks count toward `progress`; a stage is `complete` exactly when all its counted tasks are done or skipped; stage order is stable and progress never falls except through a rejection; rejected rework shows once with its reason, also after a second rejection; clients, employees and staff each get their own rows and labels, with friendly labels for every customer-visible task; a v1 template falls back to one stage per phase; component tests per audience; seeded cases all project stages.
12. Audience wording (`src/domain/tasks/__tests__/audience-wording.test.ts`): every task the client can see and every task the employee can act on, and each stage they see, has non-empty wording for that audience that is not in staff voice ("the worker" or "the client" to a customer, "your employee" to the employee); staff read `description`; a missing `clientDescription` or `workerDescription` falls back to `description`; the stage projection carries it; completed labels have no form numbers; the default template is at least v3. The server test (`src/server/__tests__/audience-wording.test.ts`) reads the same wording back through the client person view, the employee case and the inbox rows.
13. Seeded due dates (`src/db/__tests__/seed-due-dates.test.ts`): no seeded task is due before `start + offsetDays` or before its creation-day floor, and every task whose rule is on or after the start date is due on or after the start date. A late-looking filing is the seed leaving the person stalled, not a date anchored to the wrong day.
