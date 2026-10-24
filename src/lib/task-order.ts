/**
 * The one ordering of a person's tasks (task-inbox.md §6): overdue first, then due date (no due
 * date last), then workflow order, then case and id so the order is total and stable.
 *
 * "Workflow order" is `seq`, the creation order within a case, which is the template's definition
 * order. `inboxPage` in `src/server/tasks.ts` sorts in SQL by the same keys; a test keeps the two
 * identical.
 */
export type OrderableTask = {
  id: string
  caseId: string
  seq: number
  dueDate: string | null
}

/** Open and past its due day. `today` is the local `YYYY-MM-DD` (`todayIso(now)`). */
export function isPastDue(task: Pick<OrderableTask, "dueDate">, today: string): boolean {
  return task.dueDate !== null && task.dueDate < today
}

export function compareTaskUrgency(a: OrderableTask, b: OrderableTask, today: string): number {
  const aLate = isPastDue(a, today)
  const bLate = isPastDue(b, today)
  if (aLate !== bLate) return aLate ? -1 : 1
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1
    if (b.dueDate === null) return -1
    return a.dueDate < b.dueDate ? -1 : 1
  }
  if (a.seq !== b.seq) return a.seq - b.seq
  if (a.caseId !== b.caseId) return a.caseId < b.caseId ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function sortByUrgency<T extends OrderableTask>(tasks: readonly T[], today: string): T[] {
  return [...tasks].sort((a, b) => compareTaskUrgency(a, b, today))
}

/**
 * The task to send someone to after `afterTaskId`: the most urgent of `candidates` that is not
 * that task. `candidates` are the person's open tasks; the finished task is usually already gone,
 * and is skipped anyway so a stale list never loops back to it.
 */
export function nextTask<T extends OrderableTask>(
  candidates: readonly T[],
  afterTaskId: string | null,
  today: string,
): T | null {
  return sortByUrgency(candidates, today).find((task) => task.id !== afterTaskId) ?? null
}
