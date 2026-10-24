/**
 * Task service and queues (tasks-and-workflow.md §5, §8). Mutations run the pure engine inside
 * one transaction; queries return the tasks assigned to a user or a role queue. The queues of the
 * onboarding specialist and Finance roles live here too.
 */
import { and, asc, eq, inArray, lt, or, sql, type AnyColumn, type SQL } from "drizzle-orm"

import type { SessionUser } from "@/auth"
import type { AppDatabase } from "@/db/client"
import { clientCompanies, hireRequests, onboardingCases, tasks as tasksTable, users } from "@/db/schema"
import { todayIso } from "@/domain/employment-term"
import { isOverdue, rejectTask, settleTasks, type Task } from "@/domain/tasks"

import {
  actorOf,
  assertOpen,
  commitEngineResult,
  completeTaskInTx,
  engineContext,
  loadCase,
  loadTasks,
} from "./case-engine"
import type { CaseServiceDeps } from "./deps"
import { NotFoundError } from "./deps"
import { rowToTask } from "./task-store"

/** Completes a ready task as `actor`. Authorization is the task's `actors` (acl §4). */
export function completeTaskAsActor(
  deps: CaseServiceDeps,
  input: { actor: SessionUser; taskId: string; payload: unknown },
): { caseId: string; key: string } {
  return deps.db.transaction((tx) =>
    completeTaskInTx(tx, deps, { taskId: input.taskId, actor: actorOf(input.actor), payload: input.payload }),
  )
}

/** Rejects a rejectable task: the rejected instance stays as history and rework is spawned. */
export function rejectTaskAsActor(
  deps: CaseServiceDeps,
  input: { actor: SessionUser; taskId: string; reason: unknown },
): { caseId: string; key: string } {
  return deps.db.transaction((tx) => {
    const row = tx.select().from(tasksTable).where(eq(tasksTable.id, input.taskId)).get()
    if (!row) throw new NotFoundError("Task")
    const record = loadCase(tx, row.caseId)
    assertOpen(record)
    const ctx = engineContext(tx, deps, record)
    const actor = actorOf(input.actor)
    const result = rejectTask(loadTasks(tx, record.id), { taskId: input.taskId, actor, reason: input.reason }, ctx)
    commitEngineResult(tx, deps, record, result, actor)
    return { caseId: record.id, key: row.key }
  })
}

/**
 * Persists time-dependent state (the go-live milestone) for one case. Reads never write; call
 * this before an operation that needs the stored tasks to match the clock.
 */
export function settleCase(deps: CaseServiceDeps, caseId: string): void {
  deps.db.transaction((tx) => {
    const record = loadCase(tx, caseId)
    if (record.lifecycle !== "open") return
    const result = settleTasks(loadTasks(tx, record.id), engineContext(tx, deps, record))
    if (result.changed.length > 0) commitEngineResult(tx, deps, record, result, null)
  })
}

// ── Queues ──────────────────────────────────────────────────────────

export type QueueItem = {
  taskId: string
  caseId: string
  key: string
  type: string
  title: string
  phase: string
  party: Task["party"]
  /** Creation order within the case: the workflow order used to break ties (`task-order.ts`). */
  seq: number
  dueDate: string | null
  overdue: boolean
  workerName: string
  clientId: string
  clientName: string
  blocksGoLive: boolean
  /** Assigned to the person (`user`) or waiting in a role queue they work (`role`). */
  scope: "user" | "role"
}

type QueueScope =
  | { kind: "user"; userId: string }
  | { kind: "role"; role: "onboarding_specialist" | "finance" }

/** Optional narrowing and paging for the queue reads; every field defaults to "no restriction". */
export type QueueOptions = {
  /** Only the tasks assigned to the person (`user`) or only the role queue (`role`). */
  scope?: "user" | "role"
  /** Only tasks past their due day. */
  overdueOnly?: boolean
  /** Every word must appear (case-insensitively) in the task title, the person's name or the client's name. */
  search?: string
  limit?: number
  offset?: number
}

export type QueuePage = { items: QueueItem[]; total: number }

function assignedTo(scope: QueueScope): SQL | undefined {
  return scope.kind === "user"
    ? and(eq(tasksTable.assigneeKind, "user"), eq(tasksTable.assigneeUserId, scope.userId))
    : and(eq(tasksTable.assigneeKind, "role"), eq(tasksTable.assigneeRole, scope.role))
}

function contains(column: AnyColumn, word: string): SQL {
  return sql`instr(lower(${column}), ${word.toLowerCase()}) > 0`
}

function queueWhere(scopes: QueueScope[], now: Date, options: QueueOptions): SQL | undefined {
  const conditions: (SQL | undefined)[] = [
    or(...scopes.map(assignedTo)),
    eq(tasksTable.status, "ready"),
    eq(onboardingCases.lifecycle, "open"),
  ]
  if (options.overdueOnly) conditions.push(lt(tasksTable.dueDate, todayIso(now)))
  for (const word of (options.search ?? "").split(/\s+/).filter(Boolean)) {
    conditions.push(
      or(
        contains(tasksTable.title, word),
        contains(users.displayName, word),
        contains(clientCompanies.name, word),
      ),
    )
  }
  return and(...conditions)
}

function queue(db: AppDatabase, scopes: QueueScope[], now: Date, options: QueueOptions = {}): QueuePage {
  const scoped = scopes.filter((scope) => !options.scope || scope.kind === options.scope)
  if (scoped.length === 0) return { items: [], total: 0 }
  const where = queueWhere(scoped, now, options)
  const base = db
    .select({
      task: tasksTable,
      workerName: users.displayName,
      clientId: clientCompanies.id,
      clientName: clientCompanies.name,
    })
    .from(tasksTable)
    .innerJoin(onboardingCases, eq(onboardingCases.id, tasksTable.caseId))
    .innerJoin(hireRequests, eq(hireRequests.id, onboardingCases.hireRequestId))
    .innerJoin(clientCompanies, eq(clientCompanies.id, hireRequests.clientCompanyId))
    .innerJoin(users, eq(users.id, onboardingCases.workerUserId))
    .where(where)
  const total =
    db
      .select({ n: sql<number>`count(*)` })
      .from(tasksTable)
      .innerJoin(onboardingCases, eq(onboardingCases.id, tasksTable.caseId))
      .innerJoin(hireRequests, eq(hireRequests.id, onboardingCases.hireRequestId))
      .innerJoin(clientCompanies, eq(clientCompanies.id, hireRequests.clientCompanyId))
      .innerJoin(users, eq(users.id, onboardingCases.workerUserId))
      .where(where)
      .get()?.n ?? 0
  if (options.limit === 0) return { items: [], total }
  // Same keys as `compareTaskUrgency` (src/lib/task-order.ts): a past due date sorts before a later
  // one, so "overdue first" needs no separate key; no due date sorts last.
  const ordered = base.orderBy(
    sql`${tasksTable.dueDate} is null`,
    asc(tasksTable.dueDate),
    asc(tasksTable.seq),
    asc(tasksTable.caseId),
    asc(tasksTable.id),
  )
  // SQLite needs a LIMIT to accept an OFFSET; -1 means "no limit".
  const rows = ordered.limit(options.limit ?? -1).offset(options.offset ?? 0).all()
  const items = rows.map(({ task: row, workerName, clientId, clientName }) => {
    const task = rowToTask(row)
    return {
      taskId: task.id,
      caseId: task.caseId,
      key: task.key,
      type: task.type,
      title: task.title,
      phase: task.phase,
      party: task.party,
      seq: task.seq,
      dueDate: task.dueDate,
      overdue: isOverdue(task, now),
      workerName,
      clientId,
      clientName,
      blocksGoLive: task.blocksGoLive,
      scope: task.assignee.kind === "role" ? ("role" as const) : ("user" as const),
    }
  })
  return { items, total }
}

function inboxScopes(user: Pick<SessionUser, "id" | "role">): QueueScope[] {
  const own: QueueScope = { kind: "user", userId: user.id }
  if (user.role !== "onboarding_specialist" && user.role !== "finance") return [own]
  return [own, { kind: "role", role: user.role }]
}

/**
 * A person's inbox, one page of it: ready tasks assigned to them, plus (for onboarding specialists
 * and Finance) their role's queue, narrowed and paged by `options`. `total` ignores paging.
 * Ordered by urgency (`compareTaskUrgency`).
 */
export function inboxPage(
  db: AppDatabase,
  user: Pick<SessionUser, "id" | "role">,
  now: Date = new Date(),
  options: QueueOptions = {},
): QueuePage {
  return queue(db, inboxScopes(user), now, options)
}

/** A person's whole inbox (see {@link inboxPage}); pass `options` to narrow or page it. */
export function inboxForUser(
  db: AppDatabase,
  user: Pick<SessionUser, "id" | "role">,
  now: Date = new Date(),
  options: QueueOptions = {},
): QueueItem[] {
  return inboxPage(db, user, now, options).items
}

/** How many tasks are waiting for this person: the number on their sidebar. */
export function countInbox(db: AppDatabase, user: Pick<SessionUser, "id" | "role">, now: Date = new Date()): number {
  return inboxPage(db, user, now, { limit: 0 }).total
}

/** Ready tasks waiting in a role queue (all cases). */
export function roleQueue(
  db: AppDatabase,
  role: "onboarding_specialist" | "finance",
  now: Date = new Date(),
  options: QueueOptions = {},
): QueueItem[] {
  return queue(db, [{ kind: "role", role }], now, options).items
}

/** Every task of a case, oldest first. Callers enforce that the actor may see the case. */
export function tasksForCase(db: AppDatabase, caseId: string): Task[] {
  return db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.caseId, caseId))
    .orderBy(asc(tasksTable.seq))
    .all()
    .map(rowToTask)
}

/** Tasks of many cases in one query, grouped by case (for list pages). */
export function tasksForCases(db: AppDatabase, caseIds: readonly string[]): Map<string, Task[]> {
  const grouped = new Map<string, Task[]>()
  if (caseIds.length === 0) return grouped
  const rows = db
    .select()
    .from(tasksTable)
    .where(inArray(tasksTable.caseId, [...caseIds]))
    .orderBy(asc(tasksTable.caseId), asc(tasksTable.seq))
    .all()
  for (const row of rows) {
    const list = grouped.get(row.caseId) ?? []
    list.push(rowToTask(row))
    grouped.set(row.caseId, list)
  }
  return grouped
}

