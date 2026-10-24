/**
 * Plain view models for the task inboxes and the generic task page (task-inbox.md §3–§4), and the
 * pure functions that build them. Server read models (`src/server/task-inbox.ts`,
 * `src/server/task-page.ts`) load the data; everything that decides wording, ordering and state
 * lives here so it is testable without a database. Components take these types only.
 */
import { addDaysIso, todayIso } from "@/domain/employment-term"
import type { StageAudience } from "@/domain/tasks"
import type { Json, RoleQueue, Task, TaskStatus } from "@/domain/tasks/types"

import { formatDay } from "./format"
import { DEFAULT_PAGE_SIZE, isPageSize, type PageSize } from "./pagination"
import { ownerText } from "./stage-view"
import { parseDay } from "./task-view"
import { taskUiFor, type Portal, type TaskSurface } from "./task-ui-registry"

/** Whose wording a view uses: customers read `clientLabel`, employees `workerLabel`, staff the title. */
export type TaskAudience = StageAudience

export function audienceForPortal(portal: Portal): TaskAudience {
  switch (portal) {
    case "client":
      return "client"
    case "worker":
      return "worker"
    default:
      return "staff"
  }
}

/** One task as a list shows it. Every field is already worded for the viewer's audience. */
export type TaskInboxRow = {
  id: string
  caseId: string
  /** Handler id; the dialog registry (`TASK_DIALOGS`) and the screen registry key on it. */
  type: string
  /** Audience wording: the template's `clientLabel` / `workerLabel`, else the title. */
  title: string
  description: string
  /** An extra line from the registry (the deposit amount, why work was sent back). */
  detail: string | null
  surface: TaskSurface
  /** Where the row's action goes (`taskUiFor(type).href`). */
  href: string
  actionLabel: string
  /** The payload an `inline` row sends; null for every other surface. */
  inlinePayload: Json | null
  status: TaskStatus
  dueDate: string | null
  overdue: boolean
  personName: string
  clientId: string
  clientName: string
  /** The template key (`review_order`): what the Task filter of a staff home groups by. */
  key: string
  /** The task blocks the start date and the person's start is at risk (`projectTasks().atRisk`). */
  atRisk: boolean
  /** Who the task waits on, for this audience: "You", "Maya", "Northwind", "Onboarding queue". */
  assigneeLabel: string
  /** `mine`: assigned to the viewer. `queue`: waiting in a role queue the viewer works. */
  scope: "mine" | "queue"
  blocksGoLive: boolean
  completedAt: string | null
  /** Facts copied onto the task at creation (an amount, a rework reason). Dialogs read it. */
  context: Record<string, Json>
}

export const ROLE_QUEUE_LABEL: Record<RoleQueue, string> = {
  onboarding_specialist: "Onboarding queue",
  finance: "Finance queue",
}

type TemplateLabels = { clientLabel?: string; workerLabel?: string; clientDescription?: string; workerDescription?: string }

/** The template's wording for a task as `audience` reads it. */
export function taskTitleFor(task: Pick<Task, "title">, labels: TemplateLabels | undefined, audience: TaskAudience): string {
  if (audience === "client") return labels?.clientLabel ?? task.title
  if (audience === "worker") return labels?.workerLabel ?? task.title
  return task.title
}

/** The template's explanation of a task as `audience` reads it; staff and a missing key read the stored description. */
export function taskDescriptionFor(task: Pick<Task, "description">, labels: TemplateLabels | undefined, audience: TaskAudience): string {
  if (audience === "client") return labels?.clientDescription ?? task.description
  if (audience === "worker") return labels?.workerDescription ?? task.description
  return task.description
}

export type TaskRowInput = {
  task: Task
  portal: Portal
  user: { id: string }
  /** The template definition's labels for `task.key`; absent for a template that no longer has the key. */
  labels?: TemplateLabels
  personName: string
  clientId: string
  clientName: string
  /** The person's start is at risk (`projectTasks(...).atRisk` of the case); only a task that blocks the start inherits it. */
  caseAtRisk?: boolean
  now: Date
}

/** Builds the row for one task. The registry decides surface, label and link; the template, the wording. */
export function taskInboxRow(input: TaskRowInput): TaskInboxRow {
  const { task, portal, user, personName, clientId, clientName, now } = input
  const audience = audienceForPortal(portal)
  const ui = taskUiFor(task.type)
  const subject = { ...task, context: task.context }
  const open = task.status === "ready" || task.status === "blocked"
  const assigneeLabel =
    audience === "staff" && task.assignee.kind === "role"
      ? ROLE_QUEUE_LABEL[task.assignee.role]
      : ownerText(task.party, audience, personName)
  return {
    id: task.id,
    caseId: task.caseId,
    type: task.type,
    title: taskTitleFor(task, input.labels, audience),
    description: taskDescriptionFor(task, input.labels, audience),
    detail: ui.detail(subject),
    surface: ui.surface,
    href: ui.href(subject, portal),
    actionLabel: ui.actionLabel(subject),
    inlinePayload: ui.surface === "inline" ? (ui.completeWith ?? null) : null,
    status: task.status,
    dueDate: task.dueDate,
    overdue: open && task.dueDate !== null && task.dueDate < todayIso(now),
    personName,
    clientId,
    clientName,
    key: task.key,
    atRisk: open && task.blocksGoLive && input.caseAtRisk === true,
    assigneeLabel,
    scope: task.assignee.kind === "user" && task.assignee.userId === user.id ? "mine" : "queue",
    blocksGoLive: task.blocksGoLive,
    completedAt: task.completedAt ? task.completedAt.toISOString() : null,
    context: task.context,
  }
}

// ── Due dates ───────────────────────────────────────────────────────

export type DueText = { text: string; danger: boolean }

/** "Due Oct 22", "Due today", "Was due Oct 20" (danger) or null without a due date. */
export function dueText(dueDate: string | null, now: Date): DueText | null {
  if (dueDate === null) return null
  const today = todayIso(now)
  const day = formatDay(parseDay(dueDate), now)
  if (dueDate < today) return { text: `Was due ${day}`, danger: true }
  if (dueDate === today) return { text: "Due today", danger: false }
  return { text: `Due ${day}`, danger: false }
}

// ── Staff home state (URL) ──────────────────────────────────────────

/**
 * The Status filter of a staff home: the derived flags a task can carry while it is open. Every
 * task in the inbox is `ready` (blocked work is not anyone's yet), so "Ready" would match all of
 * them and is not an option; the rest are derived from the due date and the case's start risk.
 */
export const TASK_STATUS_FILTERS = ["overdue", "at_risk", "due_this_week"] as const
export type TaskStatusFilter = (typeof TASK_STATUS_FILTERS)[number]

export const TASK_STATUS_FILTER_LABEL: Record<TaskStatusFilter, string> = {
  overdue: "Overdue",
  at_risk: "At risk",
  due_this_week: "Due this week",
}

/** "Due this week" is today and the six days after it, the same window as "Starting this week". */
export const DUE_WEEK_DAYS = 7

export function isTaskStatusFilter(value: unknown): value is TaskStatusFilter {
  return typeof value === "string" && (TASK_STATUS_FILTERS as readonly string[]).includes(value)
}

/** Whether an open task carries the flag `filter` names. The one definition the server and the tests share. */
export function taskMatchesStatus(
  filter: TaskStatusFilter,
  task: { overdue: boolean; atRisk: boolean; dueDate: string | null },
  now: Date,
): boolean {
  switch (filter) {
    case "overdue":
      return task.overdue
    case "at_risk":
      return task.atRisk
    case "due_this_week": {
      if (task.dueDate === null) return false
      const today = todayIso(now)
      return task.dueDate >= today && task.dueDate <= addDaysIso(today, DUE_WEEK_DAYS - 1)
    }
  }
}

export type TaskInboxQuery = {
  q: string
  /** Client company id. */
  client: string | null
  /** Template task key. */
  task: string | null
  status: TaskStatusFilter | null
  page: number
  size: PageSize
}

export const DEFAULT_TASK_INBOX_QUERY: TaskInboxQuery = {
  q: "",
  client: null,
  task: null,
  status: null,
  page: 1,
  size: DEFAULT_PAGE_SIZE,
}

type RawParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

const ID = /^[\w-]{1,64}$/

/** Never throws: anything unrecognised falls back to the default. */
export function parseTaskInboxQuery(params: RawParams): TaskInboxQuery {
  const client = first(params.client)
  const task = first(params.task)
  const status = first(params.status) ?? (first(params.filter) === "overdue" ? "overdue" : undefined)
  const page = Number.parseInt(first(params.page) ?? "", 10)
  const size = Number.parseInt(first(params.size) ?? "", 10)
  return {
    q: (first(params.q) ?? "").trim().slice(0, 100),
    client: client && ID.test(client) ? client : null,
    task: task && ID.test(task) ? task : null,
    status: isTaskStatusFilter(status) ? status : null,
    page: Number.isFinite(page) && page > 1 ? page : 1,
    size: isPageSize(size) ? size : DEFAULT_PAGE_SIZE,
  }
}

/** Query string with defaults omitted. */
export function taskInboxSearch(query: TaskInboxQuery): string {
  const p = new URLSearchParams()
  if (query.q) p.set("q", query.q)
  if (query.client) p.set("client", query.client)
  if (query.task) p.set("task", query.task)
  if (query.status) p.set("status", query.status)
  if (query.page > 1) p.set("page", String(query.page))
  if (query.size !== DEFAULT_PAGE_SIZE) p.set("size", String(query.size))
  const text = p.toString()
  return text ? `?${text}` : ""
}

/** A change to a filter, the search or the page size goes back to page 1; only `page` itself keeps it. */
export function withTaskInboxChange(query: TaskInboxQuery, patch: Partial<TaskInboxQuery>): TaskInboxQuery {
  return { ...query, ...patch, ...("page" in patch ? {} : { page: 1 }) }
}

export function hasTaskInboxFilters(query: TaskInboxQuery): boolean {
  return Boolean(query.q || query.client || query.task || query.status)
}

export type TaskInboxOption = { value: string; label: string }

/** What the Client and Task filters offer: only what the viewer's visible tasks actually have. */
export type TaskInboxOptions = {
  clients: TaskInboxOption[]
  tasks: TaskInboxOption[]
}

/** One page of a staff home table plus the filter options. */
export type TaskInboxPage = {
  rows: TaskInboxRow[]
  /** Rows matching the filters and search, across pages. */
  total: number
  page: number
  pageSize: number
  totalPages: number
  options: TaskInboxOptions
  /** The viewer has no open task at all (before any filter or search): the "nothing needs you" state. */
  empty: boolean
}

// ── Guided to-do (employee) ─────────────────────────────────────────

export type TodoProgress = { done: number; total: number }

/**
 * "N of M done" over the person's own tasks that count: open and done ones. Skipped, rejected
 * (history, replaced by a new instance) and cancelled tasks do not.
 */
export function todoProgress(rows: readonly Pick<TaskInboxRow, "status">[]): TodoProgress {
  const counted = rows.filter((row) => row.status === "ready" || row.status === "blocked" || row.status === "done")
  return { done: counted.filter((row) => row.status === "done").length, total: counted.length }
}

export type TodoView = {
  progress: TodoProgress
  /** Ready tasks, most urgent first; the first is "up next". */
  ready: TaskInboxRow[]
  /** Tasks that wait on something else; shown muted, not actionable. */
  upcoming: TaskInboxRow[]
  /** Finished tasks, newest first; shown collapsed. */
  done: TaskInboxRow[]
}

// ── Task page ───────────────────────────────────────────────────────

/** The case a task belongs to, as far as the viewer may know it. */
export type TaskCaseSummary = {
  caseId: string
  personName: string
  clientName: string
  roleName: string
  /** `YYYY-MM-DD`, or null when the hire has no start date yet. */
  startDate: string | null
  /** The template phase the task belongs to ("Worker onboarding"). */
  phaseTitle: string
}

/** Everything the generic task page and a registered screen render. Already scoped to the viewer. */
export type TaskPageData = {
  row: TaskInboxRow
  caseSummary: TaskCaseSummary
  /** The task is ready, its case is open and the viewer is one of its actors. */
  canAct: boolean
  /** The definition has `rework`: the viewer may send it back with a reason (when `canAct`). */
  rejectable: boolean
  /** Payload for the fallback's one-click "Mark complete"; null when the type needs input. */
  completeWith: Json | null
}
