# Case lifecycle

## 1. Purpose and assumptions

This spec owns what is **stored** about an `OnboardingCase`'s standing, and how onboarding **derives** from tasks. It replaces the old ten-state machine: there is no `state` column and no transition matrix for onboarding. Which step a person is on, who is waiting on whom, whether the start is at risk and whether the person is `onboarding` or `active` are all read from the case's tasks ([tasks-and-workflow.md](./tasks-and-workflow.md)).

What remains explicit is the set of client decisions that cannot be inferred from tasks: cancel, terminate, reactivate, and the fixed-term end date. They are pure functions in `src/domain/case-lifecycle.ts`, enforced on the server for every mutation ([acl.md](./acl.md) §5). UI MAY hide controls, but hiding is never the enforcement.

Assumptions:

- Role ids come from [acl.md](./acl.md) §2.
- Event types and payloads come from [domain.md](./domain.md) §9; term rules from [domain.md](./domain.md) §2.2.
- Persistence columns come from [data-model.md](./data-model.md).

## 2. Lifecycle

`onboarding_cases.lifecycle` is one of exactly three literals, exported as `CASE_LIFECYCLES`:

| Lifecycle | Meaning |
| --- | --- |
| `open` | The default. The case has tasks; the person is onboarding, then active (derived) |
| `cancelled` | The client withdrew the order before it went live. Open tasks are `cancelled` |
| `terminated` | The client ended a live person's employment. Open tasks are `cancelled` |

Everything else a UI used to call a state is derived (§4).

## 3. Operations (contracts)

All functions are pure and return `{ nextLifecycle, event }` (plus the reactivation extras) or throw `DomainError`. Persistence applies the result, the task changes and the event atomically ([architecture.md](./architecture.md) §4), re-reading `lifecycle` and the tasks inside the transaction, so a stale UI cannot double-apply: the second attempt fails with `ILLEGAL_TRANSITION`.

| Id | Operation | Actor | From → To | Preconditions (beyond role) | Event |
| --- | --- | --- | --- | --- | --- |
| T0 | `createOrder` | `client_hr` | none → `open` | role belongs to the company; email unused; `assertWageAllowed`; at least 5 business days of notice ([domain.md](./domain.md) §2.1 H4); end date after the start; instantiates the task graph from the active template | `order_created` |
| T9 | `clientCancelOrder` | `client_hr` | `open → cancelled` | go-live **not** reached (derived); optional `note`; case belongs to the actor's company (else not found). Open tasks become `cancelled` | `request_cancelled` |
| T10 | `clientTerminate` | `client_hr` | `open → terminated` | go-live reached (derived); `effectiveOn` is an ISO date (else `ILLEGAL_TRANSITION`); for a fixed term `effectiveOn` MUST NOT be after the end date (`LAST_DAY_AFTER_END_DATE`; ending early is allowed, [domain.md](./domain.md) §2.2 M6). The go-live task is persisted first, so history says the person started; then open tasks become `cancelled` | `terminated` |
| T11 | `clientReactivate` | `client_hr` | `terminated → open`; `cancelled → open` (restart); or a renewal on `open` (below) | optional `note`; case belongs to the actor's company. Never yields an ended person: when `end_date` is before today the call must carry a new term (`newEndDate`, `null` = indefinite, else after today and after the start; `TERM_REQUIRED` / `END_DATE_NOT_FUTURE` / `END_DATE_BEFORE_START`), persisted on the hire and recorded as `{ endDate }` | `reactivated` |

Reactivation by source:

- From `terminated`: the tasks are kept as they were (they stay `cancelled`/`done`; the person had already started), so the person is `active` again. Onboarding is not repeated.
- From `cancelled`: onboarding **restarts**. The facts are frozen again from today's state (is the master agreement signed now; the deposit still owed is the original deposit minus what the ledger holds; the term), and the template's start tasks are instantiated again with fresh `seq` after the cancelled ones. History is kept, so the timeline shows the cancellation and the restart. The template version is the case's own, not the newest.
- Renewal (not a lifecycle change): an `open`, live person whose fixed term has ended reads as `inactive`. `clientReactivate` accepts that case and delegates to `clientRenewTerm`, which keeps `open`, updates `end_date` and writes `reactivated`; from an open person with a running or indefinite term it is `ILLEGAL_TRANSITION` ([domain.md](./domain.md) §2.2 M7–M8).

Non-lifecycle operations that still write events: `uploadCaseDocument` (`document_uploaded`), `addOpsNote` (`ops_note`), and every task completion, rejection or reopening (`task_completed`, `task_rejected`, `task_reopened`, [tasks-and-workflow.md](./tasks-and-workflow.md) §5). Signing the master agreement writes `agreement_signed`.

## 4. How onboarding derives from tasks

| Concept | Derivation |
| --- | --- |
| Go-live reached | the go-live trigger task is effectively `done`: every blocking task is resolved and the start date has arrived (lazy, [tasks-and-workflow.md](./tasks-and-workflow.md) §5.5) |
| Person status | `personStatusFor({ lifecycle, goLiveReached, endDate, now })` ([domain.md](./domain.md) §9.2): `cancelled`/`terminated` → `inactive`; else `onboarding` until go-live, then `active`, or `inactive` once the term has ended |
| Progress | blocking tasks done of total (rework counted once) |
| Waiting on | the parties owning ready blocking tasks; the client sees You, Worker or Northwind |
| Next step | the ready blocking task with the earliest due date |
| At risk | open, not live, and an open blocking task is overdue or the start date has passed |
| Waiting for start | every blocking task done and the start date still ahead |

Rework replaces the old reject loop: a specialist rejecting `verify_i9_section2` spawns a `fix_documents` task for the worker and a new `verify_i9_section2` behind it ([work-auth-review.md](./work-auth-review.md)).

## 5. Rules

- C1. A case is created `open` together with its `HireRequest`, its frozen facts and its tasks, and MUST NOT be created in any other lifecycle.
- C2. Lifecycle changes go only through the operations in §3, never by setting the column directly. Each checks actor role → preconditions → result, then persists atomically.
- C3. There are no terminal lifecycles: `cancelled` and `terminated` leave through T11. A live `open` person leaves only through T10.
- C4. Only `client_hr` can cancel, terminate or reactivate. `onboarding_specialist`, `finance` and `worker` get `FORBIDDEN_ROLE`; a client of another company gets not-found ([acl.md](./acl.md) §5).
- C5. Cancelling after go-live, and terminating before it, are `ILLEGAL_TRANSITION`. The person's status, not a stored state, decides.

## 6. Illegal operations (must be tested)

| Attempt | Expected error |
| --- | --- |
| `onboarding_specialist` or `finance` cancel, terminate or reactivate | `FORBIDDEN_ROLE` |
| cancel a live person | `ILLEGAL_TRANSITION` |
| terminate a person who has not gone live | `ILLEGAL_TRANSITION` |
| cancel or terminate a case that is not `open` | `ILLEGAL_TRANSITION` |
| reactivate an `open` person who is not live with an ended term | `ILLEGAL_TRANSITION` |
| reactivate a person whose end date has passed without choosing a new term | `TERM_REQUIRED` |
| reactivate with a new end date that is not after today | `END_DATE_NOT_FUTURE` |
| terminate with `effectiveOn` after the end date | `LAST_DAY_AFTER_END_DATE` |
| terminate with a malformed `effectiveOn` | `ILLEGAL_TRANSITION` |
| create an order with an end date not after the start date | `END_DATE_BEFORE_START` |
| complete or reject a task of a cancelled or terminated case | `CASE_NOT_OPEN` |
| a client of another company cancels, terminates or reactivates | not found |

## 7. Out of scope

Resuming a cancelled onboarding at the step it left (T11 restarts it instead); case reassignment between workers; SLA timers; changing a case's template version after creation.

## 8. Verification

`src/domain/__tests__/case-lifecycle.test.ts` MUST prove every row of §6 and the T9–T11 preconditions, including the renewal path and `restartTasks`. `src/server/__tests__/cases.test.ts` MUST prove, against a database:

1. T0 creates the case, snapshot, facts and tasks; the `accept_agreement` task exists only when the master agreement is unsigned.
2. Cancel cancels open tasks and keeps history; the person is `inactive`; completing a task afterwards fails.
3. Terminate before go-live is refused; after go-live it persists the go-live task, cancels the rest and the person is `inactive`; reactivating restores `active` with the same tasks.
4. Restart of a cancelled onboarding adds tasks after the cancelled ones, re-freezes the facts (a deposit already held is not asked for again) and keeps the history.
5. Term rules: last working day, a new term on reactivation, renewal of an ended term.
6. A client of another company, `onboarding_specialist`, `finance` and `worker` cannot cancel, terminate or reactivate.
