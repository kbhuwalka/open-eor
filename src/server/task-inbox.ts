/**
 * Read models for the per-portal home inboxes (task-inbox.md §3). Everything here is a query over
 * `inboxForUser` / `roleQueue` plus the template's wording; the ordering, wording and registry
 * lookups are the pure functions in `src/lib/task-inbox-view.ts`, `task-order.ts` and
 * `task-ui-registry.ts`. Nothing here names a task type or key.
 *
 * ACL: an inbox is exactly the tasks assigned to the user, plus the role queue of a specialist or
 * Finance user (`inboxForUser`). No query takes a user id from anywhere but the session user passed
 * in, so one client, worker or role can never read another's rows.
 */
import { and, eq, inArray } from "drizzle-orm"

import type { SessionUser } from "@/auth"
import type { AppDatabase } from "@/db/client"
import { loadTemplateById } from "@/db/workflow-templates"
import { clientCompanies, hireRequests, onboardingCases, tasks as tasksTable, users } from "@/db/schema"
import { todayIso } from "@/domain/employment-term"
import { projectTasks, type Task, type TaskDefinition } from "@/domain/tasks"
import { nextTask, compareTaskUrgency } from "@/lib/task-order"
import {
  audienceForPortal,
  taskInboxRow,
  taskMatchesStatus,
  todoProgress,
  type TaskInboxOption,
  type TaskInboxPage,
  type TaskInboxQuery,
  type TaskInboxRow,
  type TodoView,
} from "@/lib/task-inbox-view"
import { portalForRole, type Portal } from "@/lib/task-ui-registry"

import { countInbox, inboxPage, tasksForCases, type QueueItem } from "./tasks"
import { rowToTask } from "./task-store"

type Viewer = Pick<SessionUser, "id" | "role">

type Wording = Pick<TaskDefinition, "clientLabel" | "workerLabel" | "clientDescription" | "workerDescription">
type LabelIndex = Map<string, Map<string, Wording>>

/** Template wording per template version, loaded once per call. */
function labelsFor(db: AppDatabase, tasks: readonly Pick<Task, "templateId">[], index: LabelIndex = new Map()): LabelIndex {
  for (const { templateId } of tasks) {
    if (index.has(templateId)) continue
    const labels = new Map<string, Wording>()
    for (const definition of loadTemplateById(db, templateId).template.tasks) {
      labels.set(definition.key, {
        clientLabel: definition.clientLabel,
        workerLabel: definition.workerLabel,
        clientDescription: definition.clientDescription,
        workerDescription: definition.workerDescription,
      })
    }
    index.set(templateId, labels)
  }
  return index
}

/**
 * The cases whose start is at risk (`projectTasks(...).atRisk`: a blocking task is overdue, or the
 * start date has passed). Derived on read from every task of the case, never stored.
 */
function atRiskCases(db: AppDatabase, caseIds: readonly string[], now: Date): Set<string> {
  const unique = [...new Set(caseIds)]
  if (unique.length === 0) return new Set()
  const starts = db
    .select({ caseId: onboardingCases.id, startDate: hireRequests.startDate })
    .from(onboardingCases)
    .innerJoin(hireRequests, eq(hireRequests.id, onboardingCases.hireRequestId))
    .where(inArray(onboardingCases.id, unique))
    .all()
  const tasksByCase = tasksForCases(db, unique)
  return new Set(
    starts
      .filter(({ caseId, startDate }) => projectTasks(tasksByCase.get(caseId) ?? [], { now, startDate }).atRisk)
      .map(({ caseId }) => caseId),
  )
}

/** Turns queue items (already scoped to the viewer) into rows with full task detail and template wording. */
function rowsForItems(db: AppDatabase, viewer: Viewer, portal: Portal, items: readonly QueueItem[], now: Date): TaskInboxRow[] {
  if (items.length === 0) return []
  const found = db
    .select()
    .from(tasksTable)
    .where(inArray(tasksTable.id, items.map((item) => item.taskId)))
    .all()
    .map(rowToTask)
  const byId = new Map(found.map((task) => [task.id, task]))
  const labels = labelsFor(db, found)
  const staff = audienceForPortal(portal) === "staff"
  const atRisk = staff ? atRiskCases(db, items.map((item) => item.caseId), now) : new Set<string>()
  return items.flatMap((item) => {
    const task = byId.get(item.taskId)
    if (!task) return []
    return [
      taskInboxRow({
        task,
        portal,
        user: viewer,
        labels: labels.get(task.templateId)?.get(task.key),
        personName: item.workerName,
        clientId: item.clientId,
        clientName: item.clientName,
        caseAtRisk: atRisk.has(item.caseId),
        now,
      }),
    ]
  })
}

/** The number on the sidebar: tasks waiting for this person (their own plus their role queue). */
export function openTaskCount(db: AppDatabase, user: Viewer, now: Date = new Date()): number {
  return countInbox(db, user, now)
}

/** The client's "Needs your attention": their most urgent tasks and how many there are in all. */
export function attentionFor(
  db: AppDatabase,
  user: Viewer,
  now: Date = new Date(),
  limit = 3,
): { rows: TaskInboxRow[]; total: number } {
  const { items, total } = inboxPage(db, user, now, { limit })
  return { rows: rowsForItems(db, user, portalForRole(user.role), items, now), total }
}

/**
 * The task to open after `afterTaskId`: the person's most urgent open task other than it, or null
 * when nothing is left (the caller then returns to the inbox home). `afterTaskId` is usually the
 * task just completed, which is no longer in the inbox; it is skipped anyway.
 */
export function nextTaskFor(
  db: AppDatabase,
  user: Viewer,
  afterTaskId: string | null,
  now: Date = new Date(),
): TaskInboxRow | null {
  const { items } = inboxPage(db, user, now, { limit: 3 })
  const next = nextTask(
    items.map((item) => ({ ...item, id: item.taskId })),
    afterTaskId,
    todayIso(now),
  )
  if (!next) return null
  return rowsForItems(db, user, portalForRole(user.role), [next], now)[0] ?? null
}

/** The viewer's open tasks and how many are overdue: the figures the staff home summaries show. */
export function inboxTotals(db: AppDatabase, user: Viewer, now: Date = new Date()): { open: number; overdue: number } {
  return {
    open: inboxPage(db, user, now, { limit: 0 }).total,
    overdue: inboxPage(db, user, now, { limit: 0, overdueOnly: true }).total,
  }
}

function distinctOptions(entries: Iterable<[string, string]>): TaskInboxOption[] {
  const seen = new Map<string, string>()
  for (const [value, label] of entries) if (!seen.has(value)) seen.set(value, label)
  return [...seen]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value))
}

/**
 * One page of a staff home (specialist, Finance): every open task the role can see, whether it is
 * assigned to the viewer or waiting in the role's queue (`inboxPage` decides, so the ACL is the
 * queue's), narrowed by the free-text search and the Client, Task and Status filters (all combined)
 * and paged, most urgent first. The Client and Task options are the distinct clients and task keys
 * of the whole visible set, so an option never leads to an empty list on its own. `query.page` is
 * clamped to the last page.
 *
 * The role's queue is team-sized, so the filters run over the loaded, already ordered list instead
 * of in SQL: one definition of each Status flag (`taskMatchesStatus`) serves the filter and the
 * rows, and At risk, which is derived per case from all its tasks, needs no SQL form.
 */
export function staffInbox(
  db: AppDatabase,
  user: Viewer,
  query: TaskInboxQuery,
  now: Date = new Date(),
): TaskInboxPage {
  const visible = inboxPage(db, user, now).items
  const searched = query.q ? inboxPage(db, user, now, { search: query.q }).items : visible
  const atRisk = query.status === "at_risk" ? atRiskCases(db, searched.map((item) => item.caseId), now) : null
  const matching = searched.filter(
    (item) =>
      (!query.client || item.clientId === query.client) &&
      (!query.task || item.key === query.task) &&
      (!query.status ||
        taskMatchesStatus(
          query.status,
          { overdue: item.overdue, atRisk: item.blocksGoLive && (atRisk?.has(item.caseId) ?? false), dueDate: item.dueDate },
          now,
        )),
  )
  const totalPages = Math.max(1, Math.ceil(matching.length / query.size))
  const page = Math.min(query.page, totalPages)
  const items = matching.slice((page - 1) * query.size, page * query.size)
  return {
    rows: rowsForItems(db, user, portalForRole(user.role), items, now),
    total: matching.length,
    page,
    pageSize: query.size,
    totalPages,
    options: {
      clients: distinctOptions(visible.map((item): [string, string] => [item.clientId, item.clientName])),
      tasks: distinctOptions(visible.map((item): [string, string] => [item.key, item.title])),
    },
    empty: visible.length === 0,
  }
}

/**
 * The employee's guided to-do list: every task assigned to them in an open case that is still to
 * do or done, split into ready (most urgent first), upcoming (waiting on something else) and done.
 */
export function todoFor(db: AppDatabase, user: Viewer, now: Date = new Date()): TodoView {
  const found = db
    .select({ task: tasksTable, workerName: users.displayName, clientId: clientCompanies.id, clientName: clientCompanies.name })
    .from(tasksTable)
    .innerJoin(onboardingCases, eq(onboardingCases.id, tasksTable.caseId))
    .innerJoin(hireRequests, eq(hireRequests.id, onboardingCases.hireRequestId))
    .innerJoin(clientCompanies, eq(clientCompanies.id, hireRequests.clientCompanyId))
    .innerJoin(users, eq(users.id, onboardingCases.workerUserId))
    .where(
      and(
        eq(tasksTable.assigneeKind, "user"),
        eq(tasksTable.assigneeUserId, user.id),
        inArray(tasksTable.status, ["ready", "blocked", "done"]),
        eq(onboardingCases.lifecycle, "open"),
      ),
    )
    .orderBy(tasksTable.caseId, tasksTable.seq)
    .all()
  const tasks = found.map((row) => rowToTask(row.task))
  const labels = labelsFor(db, tasks)
  const portal = portalForRole(user.role)
  const rows = found.map(({ workerName, clientId, clientName }, index) => {
    const task = tasks[index]
    return taskInboxRow({
      task,
      portal,
      user,
      labels: labels.get(task.templateId)?.get(task.key),
      personName: workerName,
      clientId,
      clientName,
      now,
    })
  })
  const today = todayIso(now)
  const seqOf = new Map(tasks.map((task) => [task.id, task.seq]))
  const orderable = (row: TaskInboxRow) => ({ id: row.id, caseId: row.caseId, seq: seqOf.get(row.id) ?? 0, dueDate: row.dueDate })
  const byUrgency = (a: TaskInboxRow, b: TaskInboxRow) => compareTaskUrgency(orderable(a), orderable(b), today)
  const completedAt = (row: TaskInboxRow) => row.completedAt ?? ""
  return {
    progress: todoProgress(rows),
    ready: rows.filter((row) => row.status === "ready").sort(byUrgency),
    upcoming: rows.filter((row) => row.status === "blocked").sort(byUrgency),
    done: rows.filter((row) => row.status === "done").sort((a, b) => completedAt(b).localeCompare(completedAt(a))),
  }
}
