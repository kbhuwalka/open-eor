/**
 * The task UI registry: for each task `type`, where and how people do it (task-inbox.md §2).
 *
 * It mirrors the server handler registry (`DEFAULT_HANDLERS`, tasks-and-workflow.md §6): the
 * handler decides what a completion means, this registry decides what the *screen* around it is.
 * The inbox components and the generic task routes consult only this registry and the workflow
 * template data (`clientLabel` / `workerLabel`, stages); nothing else names a task type.
 *
 * Pure: no I/O, no React. Server read models call it to build `TaskInboxRow`s (so the components
 * receive a ready `href`, `surface` and `actionLabel`), and tests walk it against the default
 * workflow so a new template task cannot ship without a registration.
 *
 * Adding a screen for a type is two edits: flip/adjust its entry here if the surface changes,
 * then register the React component in `TASK_SCREENS` (page) or `TASK_DIALOGS` (dialog) under
 * `src/components/tasks/`.
 */
import type { Json, TaskParty } from "@/domain/tasks"
import type { UserRole } from "@/domain/types"

import { formatCents } from "./format"
import { rejectReasonText } from "./task-view"

export const PORTALS = ["client", "worker", "onboarding", "finance"] as const
/** A portal is identified by its route prefix (`/client`, `/worker`, `/onboarding`, `/finance`). */
export type Portal = (typeof PORTALS)[number]

const PORTAL_ROLE: Record<Portal, UserRole> = {
  client: "client_hr",
  worker: "worker",
  onboarding: "onboarding_specialist",
  finance: "finance",
}

export function roleForPortal(portal: Portal): UserRole {
  return PORTAL_ROLE[portal]
}

export function portalForRole(role: UserRole): Portal {
  switch (role) {
    case "client_hr":
      return "client"
    case "worker":
      return "worker"
    case "onboarding_specialist":
      return "onboarding"
    case "finance":
      return "finance"
  }
}

/**
 * A portal's home, where a person lands when no task is left and where the "done" notice shows:
 * the client's Home, the employee's to-do list, the specialist's inbox and the Finance Home.
 */
export function portalHomeHref(portal: Portal): string {
  return `/${portal}`
}

/** The portal where each party works; `system` works nowhere. */
export function portalForParty(party: TaskParty): Portal | null {
  switch (party) {
    case "client":
      return "client"
    case "worker":
      return "worker"
    case "specialist":
      return "onboarding"
    case "finance":
      return "finance"
    case "system":
      return null
  }
}

/**
 * How a task is done from a list:
 * - `inline`: one control in the row completes it with `completeWith`; no extra input.
 * - `dialog`: the row's action opens a modal over the list (`TASK_DIALOGS`); the task route shows
 *   the same dialog behind a button.
 * - `page`: the row's action navigates to the full task page (`TASK_SCREENS`).
 */
export type TaskSurface = "inline" | "dialog" | "page"

/** What the registry needs to know about a task; both `Task` and `TaskInboxRow` satisfy it. */
export type TaskUiSubject = {
  id: string
  caseId: string
  key: string
  type: string
  title: string
  description: string
  context: Readonly<Record<string, Json>>
}

export type TaskUiEntry = {
  surface: TaskSurface
  /** Portals whose users may open this type. Empty for system tasks, which nobody opens. */
  portals: readonly Portal[]
  /** The row's action: "Pay deposit $1,200.00", "Review order". Defaults to "Open". */
  actionLabel(task: TaskUiSubject): string
  /** An optional extra line under the title (an amount, why work was sent back). */
  detail(task: TaskUiSubject): string | null
  /** Where the action lives for `portal`. Dialog types may point at the page that hosts the action. */
  href(task: TaskUiSubject, portal: Portal): string
  /**
   * The payload the generic fallback (and an `inline` row) may send for "Mark complete". Present
   * only when the handler needs nothing the user must type; absent means the fallback is read-only.
   */
  completeWith?: Json
  /** The definition has `rework`: the fallback offers Reject with a reason. */
  rejectable?: boolean
}

/**
 * Where a task is worked from in `portal`. The specialist does tasks in the Home's drawer, so a
 * specialist task opens it. Finance has no task page: its work is settling payments, so every
 * Finance task points at Payments. The client and the employee have a task page.
 */
export function taskPageHref(task: Pick<TaskUiSubject, "id">, portal: Portal): string {
  if (portal === "onboarding") return `/onboarding?open=${task.id}`
  if (portal === "finance") return "/finance/payments"
  return `/${portal}/tasks/${task.id}`
}

const noDetail = () => null

type EntryInput = Partial<TaskUiEntry> & Pick<TaskUiEntry, "surface" | "portals">

function entry(input: EntryInput & { action?: string }): TaskUiEntry {
  const { action, ...rest } = input
  return {
    actionLabel: () => action ?? "Open",
    detail: noDetail,
    href: taskPageHref,
    ...rest,
  }
}

function amountOf(task: TaskUiSubject): number | null {
  const amount = task.context.amountCents
  return typeof amount === "number" ? amount : null
}

/** Why Northwind sent the work back, from the rework context ("Document expired — note"). */
function reworkReason(task: TaskUiSubject): string | null {
  const reason = task.context.reason
  if (typeof reason !== "object" || reason === null || Array.isArray(reason)) return null
  const { code, note } = reason as { code?: unknown; note?: unknown }
  if (typeof code !== "string") return null
  return `Sent back: ${rejectReasonText({ code, ...(typeof note === "string" ? { note } : {}) })}`
}

/** The page a client works on a person's onboarding from, where the stage stepper also lists the task. */
const clientCaseHref = (task: TaskUiSubject) => `/client/people/${task.caseId}`

const system = entry({ surface: "page", portals: [] })

export const TASK_UI_REGISTRY: Readonly<Record<string, TaskUiEntry>> = {
  accept_agreement: entry({
    surface: "dialog",
    portals: ["client"],
    action: "Accept agreement",
    href: clientCaseHref,
  }),
  pay_deposit: entry({
    surface: "dialog",
    portals: ["client"],
    actionLabel: (task) => {
      const amount = amountOf(task)
      return amount === null ? "Pay deposit" : `Pay deposit ${formatCents(amount)}`
    },
    href: clientCaseHref,
  }),
  confirm_deposit: entry({
    surface: "page",
    portals: ["finance"],
    action: "Confirm deposit",
    href: () => "/finance/payments",
    detail: (task) => {
      const amount = amountOf(task)
      return amount === null ? null : `Deposit of ${formatCents(amount)}`
    },
  }),
  review_order: entry({ surface: "page", portals: ["onboarding"], action: "Review order", completeWith: {} }),
  accept_invitation: entry({
    surface: "page",
    portals: ["worker"],
    action: "Accept invitation",
    completeWith: { accepted: true },
  }),
  sign_agreement: entry({ surface: "page", portals: ["worker"], action: "Review and sign" }),
  personal_details: entry({ surface: "page", portals: ["worker"], action: "Add your details" }),
  i9_section1: entry({ surface: "page", portals: ["worker"], action: "Confirm eligibility" }),
  upload_documents: entry({
    surface: "page",
    portals: ["worker"],
    action: "Upload documents",
    detail: reworkReason,
  }),
  w4: entry({ surface: "page", portals: ["worker"], action: "Complete form" }),
  direct_deposit: entry({ surface: "page", portals: ["worker"], action: "Add bank details" }),
  verify_i9_section2: entry({
    surface: "page",
    portals: ["onboarding"],
    action: "Verify documents",
    rejectable: true,
  }),
  setup_payroll: entry({ surface: "page", portals: ["onboarding"], action: "Set up payroll" }),
  benefits_decision: entry({ surface: "page", portals: ["worker"], action: "Choose benefits" }),
  submit_benefit_enrollments: entry({ surface: "page", portals: ["onboarding"], action: "Submit enrollments" }),
  file_new_hire_report: entry({ surface: "page", portals: ["onboarding"], action: "File report" }),
  generate_agreement: system,
  invite_worker: system,
  go_live: system,
}

/** Types the registry does not know open a read-only page in any portal that may see the task. */
export const VIEW_FALLBACK: TaskUiEntry = entry({ surface: "page", portals: PORTALS, action: "View" })

export function isRegisteredTaskType(type: string): boolean {
  return Object.hasOwn(TASK_UI_REGISTRY, type)
}

/** The registered entry, or the read-only view fallback. Never undefined. */
export function taskUiFor(type: string): TaskUiEntry {
  return isRegisteredTaskType(type) ? TASK_UI_REGISTRY[type] : VIEW_FALLBACK
}

/** May `portal` open a task of this type? Unregistered types may be opened (read-only) anywhere. */
export function taskOpensIn(type: string, portal: Portal): boolean {
  return taskUiFor(type).portals.includes(portal)
}

export function taskHref(task: TaskUiSubject, portal: Portal): string {
  return taskUiFor(task.type).href(task, portal)
}
