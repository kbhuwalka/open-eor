/**
 * Everything the product shows about a case's tasks is derived here, on read, with `now`
 * injected (tasks-and-workflow.md §8). Nothing in this file writes.
 */
import { todayIso } from "../employment-term"

import { isOpen, isResolved, latestByKey } from "./engine"
import type { Task, TaskParty, TaskStatus } from "./types"

export type ProjectedTask = Task & {
  /** Stored status, except the go-live milestone, which is derived from the date. */
  effectiveStatus: TaskStatus
  overdue: boolean
}

export type TaskProjection = {
  tasks: ProjectedTask[]
  /** Open tasks (effective status `blocked` or `ready`), in `seq` order. */
  open: ProjectedTask[]
  /** Open tasks that must be done before go-live (excluding the milestone itself). */
  blockingOpen: ProjectedTask[]
  goLiveReached: boolean
  /** Latest blocking instances, skipped excluded: done over total. */
  progress: { done: number; total: number }
  /** Parties owning ready blocking tasks, earliest due first; `system` is never listed. */
  waitingOn: TaskParty[]
  /** Every blocking task is done and the start date has not arrived. */
  waitingForStart: boolean
  atRisk: boolean
}

export function isOverdue(task: Pick<Task, "status" | "dueDate">, now: Date): boolean {
  return (task.status === "blocked" || task.status === "ready") && task.dueDate !== null && task.dueDate < todayIso(now)
}

function compareDue(a: Task, b: Task): number {
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1
    if (b.dueDate === null) return -1
    return a.dueDate < b.dueDate ? -1 : 1
  }
  return a.seq - b.seq
}

export function projectTasks(
  tasks: readonly Task[],
  input: { now: Date; startDate: string | null },
): TaskProjection {
  const today = todayIso(input.now)
  const latest = latestByKey(tasks)
  const blocking = [...latest.values()].filter((task) => task.blocksGoLive)
  const clear = blocking.every(isResolved)
  const started = input.startDate !== null && today >= input.startDate

  const projected: ProjectedTask[] = [...tasks]
    .sort((a, b) => a.seq - b.seq)
    .map((task) => {
      let effectiveStatus: TaskStatus = task.status
      if (task.trigger === "go_live" && latest.get(task.key)?.id === task.id && isOpen(task)) {
        effectiveStatus = !clear ? "blocked" : started ? "done" : "ready"
      }
      return { ...task, effectiveStatus, overdue: isOverdue({ status: effectiveStatus, dueDate: task.dueDate }, input.now) }
    })

  const open = projected.filter((task) => isOpen({ status: task.effectiveStatus }))
  const blockingOpen = open.filter((task) => task.blocksGoLive)
  const goLive = projected.find((task) => task.trigger === "go_live" && latest.get(task.key)?.id === task.id)
  const goLiveReached = goLive?.effectiveStatus === "done"

  const counted = blocking.filter((task) => task.status !== "skipped")
  const waitingOn: TaskParty[] = []
  for (const task of blockingOpen.filter((item) => item.effectiveStatus === "ready").sort(compareDue)) {
    if (task.party !== "system" && !waitingOn.includes(task.party)) waitingOn.push(task.party)
  }

  const hasOpenWork = open.length > 0
  const atRisk =
    hasOpenWork &&
    !goLiveReached &&
    (blockingOpen.some((task) => task.overdue) || (input.startDate !== null && input.startDate < today))

  return {
    tasks: projected,
    open,
    blockingOpen,
    goLiveReached,
    progress: { done: counted.filter((task) => task.status === "done").length, total: counted.length },
    waitingOn,
    waitingForStart: hasOpenWork && clear && !started,
    atRisk,
  }
}
