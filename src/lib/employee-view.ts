/**
 * View models and wording for the employee portal (employee-portal.md). Plain, serialisable data
 * and pure functions only, so server read models, components and tests share one definition.
 */
import { todayIso } from "@/domain/employment-term"
import type { ProjectedStage, StageItem } from "@/domain/tasks"
import type { BenefitPackage, WageUnit } from "@/domain/types"

import { formatStartDay } from "./stage-view"
import { parseDay } from "./task-view"

export const EMPLOYEE_TASK_HREF = (taskId: string) => `/worker/tasks/${taskId}`

/** One of the employee's own tasks, worded for them, with its place in their list. */
export type EmployeeStep = {
  id: string
  key: string
  type: string
  label: string
  description: string
  status: "blocked" | "ready" | "done"
  dueDate: string | null
  overdue: boolean
  canAct: boolean
  /** Northwind's reason when the task exists because work was sent back. */
  rework: { code: string; note?: string } | null
  href: string
  /** 1-based position in the employee's list, and the list's length ("Task 3 of 8"). */
  position: number
  total: number
}

export type EmployeeOrderView = {
  employerName: string
  roleTitle: string
  startDate: string
  endDate: string | null
  stateCode: string
  stateName: string
  wageCents: number
  wageUnit: WageUnit
  benefitPackage: BenefitPackage
  /** Pay date of the period that contains the start date. */
  firstPayDate: string
}

/** The employee's steps in workflow order, numbered, from the worker projection of their stages. */
export function stepsFromStages(stages: readonly ProjectedStage[], hrefFor: (item: StageItem) => string): EmployeeStep[] {
  const items = stages.flatMap((stage) => stage.items)
  return items.map((item, index) => ({
    id: item.id,
    key: item.key,
    type: item.type,
    label: item.label,
    description: item.description,
    status: item.status,
    dueDate: item.dueDate,
    overdue: item.overdue,
    canAct: item.canAct,
    rework: item.rework,
    href: hrefFor(item),
    position: index + 1,
    total: items.length,
  }))
}

/** The ready step to do next: earliest due date first, then workflow order. */
export function nextStep(steps: readonly EmployeeStep[], exceptId: string | null = null): EmployeeStep | null {
  const ready = steps.filter((step) => step.status === "ready" && step.canAct && step.id !== exceptId)
  ready.sort((a, b) => {
    if (a.dueDate !== b.dueDate) {
      if (a.dueDate === null) return 1
      if (b.dueDate === null) return -1
      return a.dueDate < b.dueDate ? -1 : 1
    }
    return a.position - b.position
  })
  return ready[0] ?? null
}

export function stepProgress(steps: readonly EmployeeStep[]): { done: number; total: number } {
  return { done: steps.filter((step) => step.status === "done").length, total: steps.length }
}

/** "Maya", from "Maya Chen". */
export function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}

export function welcomeHeadline(name: string, progress: { done: number; total: number }, onboarding: boolean): string {
  const first = firstNameOf(name)
  if (!onboarding) return `Welcome, ${first}`
  if (progress.total > 0 && progress.done === progress.total) return `Welcome, ${first} — all ${progress.total} tasks done`
  return `Welcome, ${first} — ${progress.done} of ${progress.total} ${progress.total === 1 ? "task" : "tasks"} done`
}

const DAY_MS = 86_400_000

/** Whole days from today to `iso` in the caller's calendar (negative once it has passed). */
export function daysUntil(iso: string, now: Date): number {
  const [y, m, d] = todayIso(now).split("-").map(Number)
  return Math.round((parseDay(iso).getTime() - new Date(y, m - 1, d).getTime()) / DAY_MS)
}

/** "You start Mon, Jan 12 — in 8 days", "You start tomorrow", "You started Oct 20". */
export function startCountdown(startDate: string, now: Date): { text: string; started: boolean } {
  const days = daysUntil(startDate, now)
  const day = formatStartDay(startDate)
  if (days > 1) return { text: `You start ${day} — in ${days} days`, started: false }
  if (days === 1) return { text: `You start tomorrow, ${day}`, started: false }
  if (days === 0) return { text: `You start today, ${day}`, started: false }
  return { text: `You started ${day}`, started: true }
}

/** "Due Oct 22" or "Was due Oct 20", with whether to use the danger tone. */
export function dueLabel(dueDate: string | null, now: Date): { text: string; danger: boolean } | null {
  if (!dueDate) return null
  const day = parseDay(dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })
  return dueDate < todayIso(now) ? { text: `Was due ${day}`, danger: true } : { text: `Due ${day}`, danger: false }
}

/** "Monday, January 12, 2027". */
export function longDay(iso: string): string {
  return parseDay(iso).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
}

/** "Jan 12, 2027". */
export function shortDay(iso: string): string {
  return parseDay(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}
