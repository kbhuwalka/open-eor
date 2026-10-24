# Task inboxes

## 1. Purpose and assumptions

Every portal home is an inbox: it lists the tasks assigned to the signed-in user (or to their role queue) and sends them to the page where each task is done. This spec owns the pieces that are the same in all four portals: the task UI registry, the generic task route, the inbox components and the rules that scope and order them. Portal agents build task screens on top and do not re-implement any of this.

Owned elsewhere (do not redefine here): the task model, statuses, parties and the engine ([tasks-and-workflow.md](./tasks-and-workflow.md)); who may act on a task ([acl.md](./acl.md) §3–§4); the stage stepper a client reads progress in ([ui-guidelines.md](./ui-guidelines.md) C25).

Assumptions:

- The server handler registry (`DEFAULT_HANDLERS`, keyed by task `type`) decides what completing a task does. The UI registry in this doc mirrors it: same key, same "add one entry per type" rule.
- Nothing outside the two registries (`TASK_UI_REGISTRY` and the screen and dialog maps) names a task type or key. A new type works, read-only, before anyone registers it.
- Inbox read models only ever take the session user. No query takes a user id from a request.

## 2. Task UI registry

`src/lib/task-ui-registry.ts` is pure (no React, no database). One entry per task `type`:

```ts
type TaskSurface = "inline" | "dialog" | "page"

type TaskUiEntry = {
  surface: TaskSurface                       // how the action is done from a list
  portals: readonly Portal[]                 // portals that may open it; [] for system tasks
  actionLabel(task: TaskUiSubject): string   // the row button, default "Open"
  detail(task: TaskUiSubject): string | null // one muted line under the title (amount, rework reason)
  href(task: TaskUiSubject, portal: Portal): string // where the action goes, default /<portal>/tasks/<id>
  completeWith?: Json                        // payload for one-click completion (inline rows, fallback "Mark complete")
  rejectable?: boolean                       // the fallback may offer "Send back" when the definition has `rework`
}
```

`Portal` is `"client" | "worker" | "onboarding" | "finance"` and is the route prefix. `TaskUiSubject` is the task fields the registry needs (`id`, `caseId`, `key`, `type`, `title`, `description`, `context`).

| Surface | A row's action |
| --- | --- |
| `inline` | One button completes the task with `completeWith`, then the page reloads with a notice. Only for tasks that need no input. |
| `dialog` | Opens the dialog registered in `TASK_DIALOGS` over the list. A `dialog` type with no registered dialog links to its `href` instead. |
| `page` | Navigates to `href`, normally the generic task page. |

Rules:

- R1. Every task type of the default workflow, and every type with a server handler, MUST be registered (a test fails otherwise). System tasks (`generate_agreement`, `invite_worker`, `go_live`) are registered with `portals: []`: nobody opens them.
- R2. An unregistered type is not an error. `taskUiFor(type)` returns `VIEW_FALLBACK` (`page`, every portal, "View", no payload), so the task opens read-only on the generic page.
- R3. `portals` MUST include the portal of the task's owner party (`portalForParty`). A portal not listed gets a 404 from the task route, whatever its other permissions.
- R4. `completeWith` MUST be a payload the real handler's `parse` accepts (a test runs it).
- R5. Wording is the template's: the row title is the definition's `clientLabel` / `workerLabel` for those audiences and the task `title` for staff. The registry supplies the action label and detail only.

Registered today: `accept_agreement` and `pay_deposit` (`dialog`, client, link to the case page), `confirm_deposit` (`page`, finance, linking to `/finance/payments`, where the deposit is the first payment to settle), `review_order`, `setup_payroll`, `verify_i9_section2`, `submit_benefit_enrollments`, `file_new_hire_report` (`page`, onboarding), and the employee types `accept_invitation`, `sign_agreement`, `personal_details`, `i9_section1`, `upload_documents`, `w4`, `direct_deposit`, `benefits_decision` (`page`, worker).

## 3. Inbox read models

`src/server/task-inbox.ts` builds plain view models (`TaskInboxRow` in `src/lib/task-inbox-view.ts`) from `inboxPage` / `inboxForUser` / `roleQueue` in `src/server/tasks.ts`. Components take those view models and nothing else.

| Function | Returns | Used by |
| --- | --- | --- |
| `openTaskCount(db, user)` | tasks waiting for this person (own plus role queue) | the sidebar badge |
| `attentionFor(db, user, now, limit?)` | `{ rows, total }`, most urgent first; every row when `limit` is omitted | client Home "To do" (§8) |
| `todoFor(db, user)` | `TodoView`: `progress`, `ready`, `upcoming`, `done` | employee `TaskTodoList` |
| `staffInbox(db, user, query)` | `TaskInboxPage`: one page of rows (`total`, `page`, `totalPages`), the Client and Task `options` and `empty`. `query` is `{ q, client, task, status, page, size }`; the list is every open task the role can see, urgency order, the filters AND together | the paged form of `staffHome`, kept for its tests (no page renders a paged staff inbox since the Finance one was replaced by the Finance Home) |
| `staffHome(db, user, query, now)` | `StaffHomePage`: the same visible set, search and filters, unpaged, each row with its person's start date | the specialist's `SpecialistHome` |
| `inboxTotals(db, user, now)` | `{ open }`: every task the user can see, regardless of filters | the Onboarding home's Open tasks tile |
| `nextTaskFor(db, user, afterTaskId)` | the most urgent other task as a row, or null | task completion (§5) |

`inboxPage` options (all optional, the old callers are unchanged): `scope` (`"user"` or `"role"`), `overdueOnly`, `search` (case-insensitive over task, person and client words), `limit`, `offset`. `limit: 0` returns only `total`.

**Staff home filters.** The specialist home shows one list, with no Mine / Role queue / Overdue tabs: every ready task of an open case the user can see (their own plus the role queue, acl A1). Assignment stays in the data (`row.scope` is `mine` or `queue`, `QueueOptions.scope` still narrows) but the home neither filters by it nor shows it. Finance has no task list: its one task type, `confirm_deposit`, is a deposit payment, so it waits first in Payments > To settle and on the Finance Home's "Waiting on you" ([finance-portal.md](./finance-portal.md) §2.6), and `taskPageHref` sends every Finance task to `/finance/payments`. `staffHome` (and `staffInbox`) load that ordered set and filter in memory, because it is team-sized and each flag then has one definition.

- Search is the existing `inboxPage` search over task, person and client words.
- Client is a `clientId`; Task is the template task `key`, labelled with the audience label from the registry (`clientLabel` / staff `title`). Both option lists are the distinct values of the whole visible set (never narrowed by the other filters, so a choice cannot dead-end) and ordered by label.
- Status is one typed list, `TASK_STATUS_FILTERS` in `src/lib/task-inbox-view.ts`: **Overdue** (past due), **At risk** and **Due this week** (today through today + 6, `DUE_WEEK_DAYS`). "Ready" is not an option because every task in the inbox is ready. At risk is task level: the task blocks the start date (`blocksGoLive`) and its case is at risk by `projectTasks` (a blocking task is overdue, or the start date has passed). `taskMatchesStatus` is the one definition the server and the tests share.
- The default sort is due soonest with overdue first and undated last (`compareTaskUrgency`); there are no sortable columns.
- URL: `q`, `client`, `task`, `status`, `page`, `size`. Defaults stay out of the URL; the old `?filter=overdue` still opens as `status=overdue`.

## 4. Generic task route

`/client/tasks/[taskId]` and `/worker/tasks/[taskId]` are one-line routes over the shared `TaskPage` (Finance has no task page: its one task type, `confirm_deposit`, is done by settling the deposit in Payments, finance-portal §2.2) (`src/components/tasks/task-page.tsx`). `TaskPage` runs in `Suspense` (it reads the session), loads the task with `loadTaskPage` (`src/server/task-page.ts`), 404s when that returns null, and renders `screenFor(type)` with the props in §6.

Authorization (`loadTaskPage`, server-side, from the session user). The task opens only when all hold; otherwise `notFound()`, the same answer other portals give for another company's case, so existence does not leak:

1. the route's portal is the viewer's own portal (`portalForRole`; the portal layout already redirects other roles away);
2. the registry entry lists the portal (§2 R3);
3. the viewer may act on the task (`canActOnTask`: the task's `actors` parties; a client must belong to the case's company, a worker must be the case's worker) or the task is assigned to them or to their role's queue.

`canAct` is that actor check plus status `ready` plus an open case: a finished task or a closed case opens read-only. `rejectable` additionally needs the registry flag and a definition with `rework`. A screen MUST NOT assume `canAct`; it renders read-only when false.

The route answers with the 404 UI, which Next streams inside the page shell, so the HTTP status is 200. Tests assert the "This page could not be found" text, not the status.

## 5. Finishing a task

`src/server/task-actions.ts` holds the shared Server Actions: `completeTaskAction(taskId, payload?)` and `rejectTaskAction(taskId, reason)`. Both follow [acl.md](./acl.md) §6: the user comes from the session (R5), they re-run `loadTaskPage` (an unauthorized task is `not_found`), call `completeTaskAsActor` / `rejectTaskAsActor` (the engine enforces actors and readiness), return an `ActionResult<TaskOutcome>` and never throw (R1), and revalidate the portal layout (R4).

`TaskOutcome` is `{ nextHref, nextTitle, message }`. `nextHref` is the next task's page, else the portal home, with `?notice=<taskId>` added. The landing page (task page or home) renders `TaskNotice`, which asks the server for that task's title with the same authorization and shows one line ("Review the order is done."); a made-up id shows nothing, and no text from the URL is ever rendered.

Next-task ordering (`compareTaskUrgency`, `src/lib/task-order.ts`; `inboxPage` sorts in SQL by the same keys and a test keeps them equal):

1. overdue tasks first (a due date before today; due today is not overdue);
2. then earliest due date, no due date last;
3. then workflow order (`seq`, the creation order within the case);
4. then case id and task id, so the order is total.

`nextTaskFor` skips the task just finished, so a stale list never loops back to it. For staff the next task is the most urgent in the whole role queue, not the same case's.

## 6. Adding a task screen

A portal agent adds one screen per task type. The wiring is two files and one registry line.

1. Check the type's entry in `TASK_UI_REGISTRY`. Change `surface`, `actionLabel` or `href` there if the default does not fit; never hardcode a type anywhere else.
2. Build the screen in the portal's folder (for example `src/app/worker/tasks/w4-screen.tsx`). It receives `TaskScreenProps`:

   ```ts
   type TaskScreenProps = {
     portal: Portal
     nowIso: string                  // the server clock for this render
     task: TaskInboxRow              // wording already for the viewer's audience
     caseSummary: TaskCaseSummary    // person, client, role, start date, phase
     canAct: boolean
     onComplete: (payload?: unknown) => Promise<ActionResult<TaskOutcome>>
     onReject?: (reason: unknown) => Promise<ActionResult<TaskOutcome>>  // only when the viewer may send it back
     completeWith: Json | null
   }
   ```

   Wrap the form in `TaskScreenFrame` (PageHeader with the status badge, content left, the `w-80` rail right) and submit through `useTaskOutcome(props.onComplete)` (`src/components/tasks/use-task-outcome.ts`), which returns `{ submit, pending, error, clearError }`, shows nothing itself and navigates to `nextHref` on success. Render `error` next to the form.
3. Register it in `TASK_SCREENS` (`src/components/tasks/task-screens.tsx`), keyed by the task `type`:

   ```ts
   import { W4Screen } from "@/app/worker/tasks/w4-screen"

   export const TASK_SCREENS: Readonly<Record<string, TaskScreen>> = {
     w4: W4Screen,
   }
   ```

For a task done in a dialog from the list, register a dialog instead in `TASK_DIALOGS` (`src/components/tasks/task-dialogs.tsx`), a client component with `TaskDialogProps` (`row`, `open`, `onOpenChange`, `onDone`): it calls its own Server Action (or `completeTaskAction`) and then `onDone()`; it never decides where to navigate. The task route shows the same dialog behind a button (`DialogTaskScreen`).

Resolution order for a type: `TASK_SCREENS`, else `TASK_DIALOGS` behind a button, else `TaskDetailFallback`. The fallback shows title, description, who it waits on, due, status and the case and person, and offers "Mark complete" only when `completeWith` is set (a payload-free type) and "Send back" only when `onReject` is present.

Status today: `pay_deposit` (`PayDepositDialog`) and `accept_agreement` (`AcceptAgreementDialog`: prepares the company's master agreement when it opens, then the same `SigningDialog` the person page uses, completing through `signAgreementTaskAction`) have dialogs, so both open in place from the client Home and from `/client/tasks/[id]`. `confirm_deposit` opens the read-only fallback until Finance registers one, a one-line addition here.

## 7. Components

All in `src/components/tasks/`, all taking view models, none naming a task type. Styling rules are ui-guidelines C27 to C29.

| Component | Portal | Notes |
| --- | --- | --- |
| `TaskTodoList` | employee home (replaced there by `EmployeeHome`, [employee-portal.md](./employee-portal.md) §4) | "N of M done", the next task with a primary "Continue", other ready tasks, locked tasks muted, completed work collapsed. Test ids `todo-progress`, `todo-next`, `todo-ready`, `todo-upcoming`, `todo-done`. |
| `TaskRowAction` | all | The per-row action by surface (§2). |
| `TaskPage`, `TaskScreenFrame`, `TaskDetailFallback`, `TaskNotice` | all | The route, the screen frame, the fallback and the success line. |
| `TaskInboxSkeleton`, `TaskTodoSkeleton`, `TaskPageSkeleton` | all | Mirror the final layouts (L2a). |

Where they are used: the client Home (`/client`) is §8, built from `TaskRowAction` and its own components; `/worker` is the checklist (`TaskTodoList`); `/onboarding` is `SpecialistHome` (`src/components/onboarding-portal/`), the search and Client, Task and Status filters over grouped rows and a drawer, with its empty copy from `TASK_INBOX_CONFIG.onboarding` (onboarding-portal §6; test ids `task-inbox`, `task-row`, `task-link`, `task-search`, `client-filter`, `task-filter`, `status-filter`, `clear-task-filters`, `no-tasks`); `/finance` is the Finance Home, which has no task list ([finance-portal.md](./finance-portal.md) §2.6). Each sidebar's inbox item shows `openTaskCount`.

## 8. Client Home

`/client` is the client's Home; the people list is `/client/people` ([architecture.md](./architecture.md) route table). The page is a `PageHeader` "Home" with "Start a hire" (the page's one `default` button), the success line (`TaskNotice`), then two blocks in one `Suspense` (`ClientHomeSkeleton`, which mirrors both): the glance cards, then To do, 32px apart. The read model is `loadClientHome({ db, finance }, user, now)` in `src/server/client-home.ts`; the wording, grouping and arithmetic are pure functions in `src/lib/client-home/`; the components are in `src/components/client-home/`. Styling is ui-guidelines C28.

**Glance cards** (`GlanceCards`, view model `glanceCards({ people, invoices })` in `cards.ts`). Three cards, in this order; each is one link (the label is a stretched link over the card, named with its figure and label: "36 Onboarding, view people").

- **Onboarding**: how many of the company's people have person status `onboarding` (a label and the figure only, no second line; a zero is muted). Links to `/client/people?status=onboarding` (`ONBOARDING_PEOPLE_HREF`).
- **At risk**: how many of those have a start at risk (domain §9.1 O4, the same derivation as the People list's flag, `atRiskMessage`): a label and the figure only, no second line; the figure is in the danger tone above zero, and at zero a muted "0". Links to `/client/people?atRisk=1` (`AT_RISK_PEOPLE_HREF`).
- **Invoices due**: the total of `invoicesToPay`, exact dollars and cents, once; then "15 invoices" and, when part is overdue, "· $X overdue" in the danger tone ("· all overdue" when every one is). An outline "View" is drawn on the card (`aria-hidden`, under the stretched link, so the card stays one control). Links to the client Finance page (`CLIENT_FINANCE_PATH`), whose Invoices tab opens on every unpaid invoice, where the client pays (pay all due, pay selected, per invoice). With nothing payable the card is a muted "$0.00", "Nothing due", no View, and still links quietly to Finance (its payment history), so the three cards always behave alike. The Home has no pay button and no invoice rows; the saved payment method is shown on Finance only.

The two people counts are `peopleCounts(db, companyId, now)` beside `listPeople` in `src/server/queries.ts`: the onboarding count is the People list's SQL status condition, and the at-risk count is the same `atRiskCaseIds` the `atRisk=1` filter uses, so each card's figure equals the length of the list it opens (a unit test and an e2e test hold both). `invoicesToPay(invoices, todoRows)` is the company's payable invoices (`isPayableRow`) less any deposit a To do row pays (`paysInvoice` in `CLIENT_TODO_COPY`: the deposit of a case whose `pay_deposit` task is in To do), so that money appears once, on its To do row; a deposit with no such task stays in the total. It returns the count, total and overdue part as integer sums over the same rows, or null when nothing is left. Test ids `glance-cards`, `glance-card` (with `data-card` `onboarding`, `at-risk`, `invoices`), `glance-figure`, `glance-context`, `glance-view`.

**To do** (`ClientTodo`, view models `clientTodoView`, `groupTodo`, `capTodo`). The rows are `attentionFor` with no limit, unchanged: the client's own ready tasks of open cases, most urgent first (overdue first). The heading is "To do" with the count muted after it ("· 6", always equal to the Home badge in the sidebar) and, when any row is overdue, "N overdue" in the danger tone; "View all" on the right expands the rest in place (`aria-expanded`, then "Show less") once there are more than three task rows. Consecutive tasks of one type that has group copy become one group (`groupTodo`): a header with the group title and count ("Pay deposits · 3") and the why line said once ("Start dates can't be confirmed until these are paid."), then one row per person (the name, and "Starts Nov 2" from the hire's start date, which `loadClientHome` reads for the user's own company only). A lone task of a type is one row with its own verb-first title and why line. Order is never changed by grouping. Every row ends in the due text (red only when overdue: "Was due Oct 20") and an `outline` `sm` button, the same on every row; the button is `TaskRowAction` with the row's label, so `accept_agreement` and `pay_deposit` open their dialogs in place (§6) and anything else links to its `href`. Titles, why lines, labels and group copy come from `CLIENT_TODO_COPY` in `src/lib/task-client-copy.ts`, the typed sibling of the registry; a type without an entry keeps the template's `clientLabel`, description and the registry's action label, and is never grouped. Three task rows show (`capTodo`: a group cut by the cap keeps its header and full count). With nothing to do the heading stays and the block is one line: "You're all caught up." Test ids `client-todo`, `todo-count`, `todo-overdue`, `todo-group` (with `data-task-type`), `todo-group-title`, `todo-row` (with `data-task-type`, and `data-grouped` inside a group), `todo-view-all`, `todo-empty`.

ACL: everything comes from the session user. To do is the user's own inbox (A2), and the start dates are read only for cases of the user's company; the people counts are scoped to the user's company exactly as `listPeople` is, and are zero for a user without one; the invoices go through `FinanceDataSource`, scoped by the same company id.

## 9. ACL summary

- A1. An inbox is the tasks assigned to the session user plus, for a specialist or Finance user, the tasks in their role's queue. Two users of the same role see the same queue; the specialist queue and the Finance queue never overlap.
- A2. A client sees only tasks of cases in their own company; an employee only their own tasks. Other companies' and other employees' rows are never returned by any read model here.
- A3. The task route is the only way into a task and applies §4 on every request; a Server Action re-applies it, so a forged task id fails with `not_found`.
- A4. System tasks are never listed or opened.

## 10. Out of scope

Claiming or locking queue tasks (any specialist may act, [work-auth-review.md](./work-auth-review.md) Q3); notifications; reassigning tasks; bulk actions; the portal-specific task screens themselves; a task detail for a closed case beyond the read-only view.

## 11. Verification

Vitest:

- `src/lib/__tests__/task-ui-registry.test.ts`: every default-workflow type and handler type is registered, owner portal listed, system tasks have no portal, unknown type falls back to the read-only page, `completeWith` parses with the real handler.
- `src/lib/__tests__/task-order.test.ts`: overdue first, due date, undated last, workflow order, determinism, `nextTask`.
- `src/lib/__tests__/task-inbox-view.test.ts`: row wording per audience, due text, query parsing and round trip (including the legacy `filter=overdue`), `taskMatchesStatus`, progress.
- `src/server/__tests__/task-inbox.test.ts` on the seeded database: SQL order equals `compareTaskUrgency`, paging, filters, ACL per client and per role queue, `openTaskCount`, `nextTaskFor`, `todoFor`, `loadTaskPage` returns null for the wrong user, portal, role or a system task; `staffInbox` filters (each alone and combined), option lists from the whole visible set, at-risk, paging and the ACL (a specialist never sees Finance tasks and the reverse).
- `src/components/tasks/__tests__/`: `TaskTodoList` empty, loaded and expanded. The specialist home's rows, filters and empty states are tested with the onboarding portal (onboarding-portal §6).
- `src/lib/__tests__/task-ui-registry.test.ts` also checks that no Finance task links to a `/finance/tasks` page, registered type or not: `confirm_deposit`, `taskPageHref` and the fallback all open `/finance/payments`.
- Client Home: `src/lib/client-home/__tests__/` (To do wording, the start-date line, grouping only consecutive runs and never an unknown type, the cap keeping a cut group's count; each glance card's figure, tone, wording, link and accessible name, with the invoice variants: overdue part, all overdue, one invoice, nothing due; the invoice total's deposit rule and sums), `src/lib/__tests__/task-client-copy.test.ts` (copy for every default-workflow type the client does, group copy without names or raw keys), `src/server/__tests__/client-home.test.ts` on the seeded database (To do equals `attentionFor`; the people counts equal the People list's totals under `status=onboarding` and `atRisk=1` for every company; start dates of the user's own cases; the deposit once and the total equal to its invoices; never another company's invoices; nothing for a user without a company; paying empties both), `src/server/__tests__/people-list.test.ts` (`peopleCounts` against `listPeople`, the `atRisk` filter equal to the flagged rows), `src/components/client-home/__tests__/` (the cards as single named links, View inside the link, the money once, nothing-due and zero-at-risk states; To do's heading and count, overdue, single and grouped rows, outline buttons on every row, View all, both dialogs in place, the empty state), `src/lib/__tests__/client-nav.test.ts` (nav order, the badge on Home, active paths).

Playwright `e2e/task-home-filters.spec.ts` (read-only, `DATABASE_FILE` required, desktop, dark and 390px) covers the specialist home: every open task in urgency order, a middle click opens the task in a new tab, the options equal the database, filters combine and clear from the URL, the overdue and at-risk statuses, the no-match state and search; it also covers a Finance payment's covered invoices in the Payments drawer (the row says how many, the drawer lists each and opens it in place with Back).

Playwright `e2e/task-inbox.spec.ts` against a seeded copy of the database outside the project (`DATABASE_FILE`; the last three tests change data and run serially), one block per portal home: the client Home's To do count is its own open tasks and a `pay_deposit` row opens its dialog, another client sees only their company and gets the 404 UI on this client's task; the employee home leads with Continue to the most urgent task and a wrong user gets the 404 UI; the specialist home is one list equal to the role's queue (open tile, no tabs, no Assigned to, no Open button), searches, opens the task from a click anywhere on the row, shows the no-match state, and the I-9 row opens its own screen with no generic Mark complete; on the Finance Home every deposit to confirm has its payment waiting first in "Waiting on you", with no task list, and its row opens the payment in the Payments drawer, and neither the specialist nor a client can open a Finance task; finishing: the specialist's review through Approve order lands on the next task with the success line, an employee accepts the invitation on its screen and the next step becomes ready, a client pays a deposit from To do on the Home (the row goes, Finance gets a Confirm deposit task, and the payment waits on the Finance Home, raising its count and the nav's by one).

Playwright `e2e/client-home.spec.ts` on the same kind of copy (serial; the last three tests write): sign-in lands on Home, the nav is Home, People, Finance, Cost calculator with the badge on Home equal to To do's count, People at `/client/people` has Start a hire and no cards or task rows; the Onboarding card's figure equals the People list under `?status=onboarding`, and the At risk card's the list under `?atRisk=1` (every row flagged, the chip removes the filter); the Invoices card's View goes to Finance, where Due now is the card's total plus To do's deposits; To do groups the deposits with the why line once and a Pay button per person; paying a deposit from the group drops the row and the count (and the badge) and leaves the Invoices total unchanged; signing the agreement from To do in place; a client with nothing to do sees "You're all caught up" and, once paid up on Finance, "$0.00", "Nothing due" and no View.
