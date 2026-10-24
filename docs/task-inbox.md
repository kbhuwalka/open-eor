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

Registered today: `accept_agreement` and `pay_deposit` (`dialog`, client, link to the case page), `confirm_deposit` (`dialog`, finance), `review_order`, `setup_payroll`, `verify_i9_section2`, `submit_benefit_enrollments`, `file_new_hire_report` (`page`, onboarding), and the employee types `accept_invitation`, `sign_agreement`, `personal_details`, `i9_section1`, `upload_documents`, `w4`, `direct_deposit`, `benefits_decision` (`page`, worker).

## 3. Inbox read models

`src/server/task-inbox.ts` builds plain view models (`TaskInboxRow` in `src/lib/task-inbox-view.ts`) from `inboxPage` / `inboxForUser` / `roleQueue` in `src/server/tasks.ts`. Components take those view models and nothing else.

| Function | Returns | Used by |
| --- | --- | --- |
| `openTaskCount(db, user)` | tasks waiting for this person (own plus role queue) | the sidebar badge |
| `attentionFor(db, user, now, limit)` | `{ rows, total }`, most urgent first | client `AttentionPanel` |
| `todoFor(db, user)` | `TodoView`: `progress`, `ready`, `upcoming`, `done` | employee `TaskTodoList` |
| `staffInbox(db, user, query)` | `TaskInboxPage`: one page of rows (`total`, `page`, `totalPages`), the Client and Task `options` and `empty`. `query` is `{ q, client, task, status, page, size }`; the list is every open task the role can see, urgency order, the filters AND together | specialist and Finance `TaskInboxTable` |
| `inboxTotals(db, user, now)` | `{ open }`: every task the user can see, regardless of filters | the Onboarding home's Open tasks tile |
| `nextTaskFor(db, user, afterTaskId)` | the most urgent other task as a row, or null | task completion (§5) |

`inboxPage` options (all optional, the old callers are unchanged): `scope` (`"user"` or `"role"`), `overdueOnly`, `search` (case-insensitive over task, person and client words), `limit`, `offset`. `limit: 0` returns only `total`.

**Staff home filters.** The specialist and Finance homes show one list, with no Mine / Role queue / Overdue tabs: every ready task of an open case the user can see (their own plus the role queue, acl A1). Assignment stays in the data (`row.scope` is `mine` or `queue`, `QueueOptions.scope` still narrows) but the home neither filters by it nor shows it. `staffInbox` loads that ordered set and filters in memory, because it is team-sized and each flag then has one definition.

- Search is the existing `inboxPage` search over task, person and client words.
- Client is a `clientId`; Task is the template task `key`, labelled with the audience label from the registry (`clientLabel` / staff `title`). Both option lists are the distinct values of the whole visible set (never narrowed by the other filters, so a choice cannot dead-end) and ordered by label.
- Status is one typed list, `TASK_STATUS_FILTERS` in `src/lib/task-inbox-view.ts`: **Overdue** (past due), **At risk** and **Due this week** (today through today + 6, `DUE_WEEK_DAYS`). "Ready" is not an option because every task in the inbox is ready. At risk is task level: the task blocks the start date (`blocksGoLive`) and its case is at risk by `projectTasks` (a blocking task is overdue, or the start date has passed). `taskMatchesStatus` is the one definition the server and the tests share.
- The default sort is due soonest with overdue first and undated last (`compareTaskUrgency`); there are no sortable columns.
- URL: `q`, `client`, `task`, `status`, `page`, `size`. Defaults stay out of the URL; the old `?filter=overdue` still opens as `status=overdue`.

## 4. Generic task route

`/client/tasks/[taskId]`, `/worker/tasks/[taskId]`, `/onboarding/tasks/[taskId]` and `/finance/tasks/[taskId]` are one-line routes over the shared `TaskPage` (`src/components/tasks/task-page.tsx`). `TaskPage` runs in `Suspense` (it reads the session), loads the task with `loadTaskPage` (`src/server/task-page.ts`), 404s when that returns null, and renders `screenFor(type)` with the props in §6.

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

Status today: `pay_deposit` has a dialog (`PayDepositDialog`). `accept_agreement` links to the case page until the signing slice registers its dialog, and `confirm_deposit` opens the read-only fallback until Finance registers one. Both are one-line additions here.

## 7. Components

All in `src/components/tasks/`, all taking view models, none naming a task type. Styling rules are ui-guidelines C27 to C29.

| Component | Portal | Notes |
| --- | --- | --- |
| `AttentionPanel` | client home | Bordered "Needs your attention" panel, three rows then "View all (N)" expands in place; renders nothing when empty. Test ids `attention-panel`, `attention-row`, `attention-view-all`. |
| `TaskTodoList` | employee home (replaced there by `EmployeeHome`, [employee-portal.md](./employee-portal.md) §4) | "N of M done", the next task with a primary "Continue", other ready tasks, locked tasks muted, completed work collapsed. Test ids `todo-progress`, `todo-next`, `todo-ready`, `todo-upcoming`, `todo-done`. |
| `TaskInboxTable`, `TaskInboxHome` | specialist, Finance | One shared table, configured per portal by `TASK_INBOX_CONFIG` in `src/lib/task-inbox-config.ts` (pure data: base path, columns, filters, search placeholder, empty copy). Columns task, person, client, due, status (person, client and status fold away below `md`); no Assigned to and no Open button: the task title is a stretched link over the whole row (C43), to `taskUiFor(type).href`. Search plus Client, Task and Status filters, Clear while one is on, pagination above ten (C11). State lives in the URL. A filter with no match says "No tasks match these filters" with Clear; an empty inbox says "Nothing needs you right now". Test ids `task-inbox`, `task-row`, `task-link`, `task-search`, `client-filter`, `task-filter`, `status-filter`, `clear-task-filters`, `no-tasks`. |
| `TaskRowAction` | all | The per-row action by surface (§2). |
| `TaskPage`, `TaskScreenFrame`, `TaskDetailFallback`, `TaskNotice` | all | The route, the screen frame, the fallback and the success line. |
| `TaskInboxSkeleton`, `TaskTodoSkeleton`, `AttentionSkeleton`, `TaskPageSkeleton` | all | Mirror the final layouts (L2a). |

Where they are used: the client home renders `AttentionPanel` above the people list; `/worker` is the checklist (`TaskTodoList`); `/onboarding` and `/finance` are `TaskInboxHome` (the summary, then `TaskInboxTable`). Each sidebar's inbox item shows `openTaskCount`.

## 8. ACL summary

- A1. An inbox is the tasks assigned to the session user plus, for a specialist or Finance user, the tasks in their role's queue. Two users of the same role see the same queue; the specialist queue and the Finance queue never overlap.
- A2. A client sees only tasks of cases in their own company; an employee only their own tasks. Other companies' and other employees' rows are never returned by any read model here.
- A3. The task route is the only way into a task and applies §4 on every request; a Server Action re-applies it, so a forged task id fails with `not_found`.
- A4. System tasks are never listed or opened.

## 9. Out of scope

Claiming or locking queue tasks (any specialist may act, [work-auth-review.md](./work-auth-review.md) Q3); notifications; reassigning tasks; bulk actions; the portal-specific task screens themselves; a task detail for a closed case beyond the read-only view.

## 10. Verification

Vitest:

- `src/lib/__tests__/task-ui-registry.test.ts`: every default-workflow type and handler type is registered, owner portal listed, system tasks have no portal, unknown type falls back to the read-only page, `completeWith` parses with the real handler.
- `src/lib/__tests__/task-order.test.ts`: overdue first, due date, undated last, workflow order, determinism, `nextTask`.
- `src/lib/__tests__/task-inbox-view.test.ts`: row wording per audience, due text, query parsing and round trip (including the legacy `filter=overdue`), `taskMatchesStatus`, progress.
- `src/server/__tests__/task-inbox.test.ts` on the seeded database: SQL order equals `compareTaskUrgency`, paging, filters, ACL per client and per role queue, `openTaskCount`, `nextTaskFor`, `todoFor`, `loadTaskPage` returns null for the wrong user, portal, role or a system task; `staffInbox` filters (each alone and combined), option lists from the whole visible set, at-risk, paging and the ACL (a specialist never sees Finance tasks and the reverse).
- `src/components/tasks/__tests__/`: `AttentionPanel`, `TaskTodoList` and `TaskInboxTable` empty, loaded, expanded and filtered (columns per config, whole-row link, filter and clear behaviour, the filtered and true empty states).

Playwright `e2e/task-home-filters.spec.ts` (read-only, `DATABASE_FILE` required, desktop, dark and 390px) covers both homes: no Assigned to column and no tabs, every open task in urgency order, a click on any cell and a middle click open the task, the options equal the database, filters combine and clear from the URL, the no-match state, search and paging; it also covers the Finance payments covered-invoices dialog.

Playwright `e2e/task-inbox.spec.ts` against a seeded copy of the database outside the project (`DATABASE_FILE`; the last three tests change data and run serially), one block per portal home: the client's "Needs your attention" count equals its own open tasks and a `pay_deposit` row opens its dialog, another client sees only their company and gets the 404 UI on this client's task; the employee home leads with Continue to the most urgent task and a wrong user gets the 404 UI; the specialist home is one list equal to the role's queue (open tile, no tabs, no Assigned to, no Open button), searches, opens the task from a click anywhere on the row, shows the no-match state, and the I-9 row opens its own screen with no generic Mark complete; the Finance home lists only deposits to confirm, filters by client and opens the deposits page; finishing: the specialist's review through Approve order lands on the next task with the success line, an employee accepts the invitation on its screen and the next step becomes ready, a client pays a deposit from the home panel (the row goes, Finance gets a Confirm deposit task).
