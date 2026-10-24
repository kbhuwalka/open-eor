/**
 * The client Home's "To do" (ui-guidelines C28): the client's own open tasks as jobs, most urgent
 * first. Pure: the server passes `attentionFor`'s rows (already scoped to the signed-in client and
 * ordered by urgency) and this words them through `CLIENT_TODO_COPY`, groups runs of the same job
 * (`groupTodo`) and decides what shows before "View all" (`capTodo`).
 */
import { todayIso } from "@/domain/employment-term"
import { formatDay } from "@/lib/format"
import type { TaskInboxRow } from "@/lib/task-inbox-view"
import { clientTodoCopyFor, personNames } from "@/lib/task-client-copy"
import { parseDay } from "@/lib/task-view"

/** Task rows To do shows before its "View all". */
export const HOME_LIST_ROWS = 3

export type ClientTodoItem = {
  /** The task as the inbox builds it: the row action (dialog, link) works from it unchanged. */
  row: TaskInboxRow
  /** "Pay the deposit for Maya Chen". */
  title: string
  /** "Maya's start date can't be confirmed until this is paid." */
  why: string
  /** "Pay $4,200.00", "Review and sign". */
  actionLabel: string
  /** The person's full name: a grouped row's title, since its group header names the job. */
  personName: string
  /** The hire's start date (`YYYY-MM-DD`): a grouped row's second line. Null when there is none. */
  startDate: string | null
}

/**
 * One block of the list. `single`: a job on its own row with its own why line. `group`: two or
 * more consecutive jobs of one type under one header that says the why once; `count` is every job
 * of the run, also when `capTodo` shows only the first `items`.
 */
export type ClientTodoGroup =
  | { kind: "single"; item: ClientTodoItem }
  | { kind: "group"; type: string; title: string; why: string; count: number; items: ClientTodoItem[] }

export type ClientTodoView = {
  items: ClientTodoItem[]
  /** Every open task of the client; equals `items.length` unless the server capped the list. */
  total: number
  overdueCount: number
}

/**
 * Words each row. A type without client copy keeps the template's wording: its label as the title,
 * its client description as the why line and the registry's action label. `startDates` maps a
 * case id to its hire's start date; a case missing from it has none.
 * Precondition: `rows` are ordered most urgent first (`attentionFor`).
 */
export function clientTodoView(
  rows: readonly TaskInboxRow[],
  total: number,
  startDates: ReadonlyMap<string, string | null> = new Map(),
): ClientTodoView {
  const items = rows.map((row): ClientTodoItem => {
    const copy = clientTodoCopyFor(row.type)
    const person = personNames(row.personName)
    return {
      row,
      title: copy ? copy.title(person) : row.title,
      why: copy ? copy.why(person) : row.description,
      actionLabel: copy ? copy.action(row) : row.actionLabel,
      personName: person.name,
      startDate: startDates.get(row.caseId) ?? null,
    }
  })
  return { items, total: Math.max(total, items.length), overdueCount: rows.filter((row) => row.overdue).length }
}

/**
 * Runs of two or more consecutive items of one type with group copy become one `group`; every
 * other item is a `single`. Order is kept exactly, so the most urgent job still comes first and an
 * overdue task is never moved below a later one. A type without client copy is never grouped.
 */
export function groupTodo(items: readonly ClientTodoItem[]): ClientTodoGroup[] {
  const runs: ClientTodoItem[][] = []
  for (const item of items) {
    const last = runs.at(-1)
    if (last && last[0].row.type === item.row.type) last.push(item)
    else runs.push([item])
  }
  return runs.flatMap((run): ClientTodoGroup[] => {
    const group = clientTodoCopyFor(run[0].row.type)?.group
    if (!group || run.length < 2) return run.map((item) => ({ kind: "single", item }))
    return [{ kind: "group", type: run[0].row.type, title: group.title, why: group.why, count: run.length, items: run }]
  })
}

/**
 * The first `limit` task rows, in their blocks. A group cut by the limit keeps its header (and its
 * `count`) and shows only its first rows. `hidden` is how many task rows are behind "View all".
 */
export function capTodo(groups: readonly ClientTodoGroup[], limit: number): { groups: ClientTodoGroup[]; hidden: number } {
  const shown: ClientTodoGroup[] = []
  let room = limit
  let hidden = 0
  for (const group of groups) {
    const size = groupSize(group)
    if (room <= 0) {
      hidden += size
      continue
    }
    if (group.kind === "single" || size <= room) {
      shown.push(group)
      room -= size
      continue
    }
    shown.push({ ...group, items: group.items.slice(0, room) })
    hidden += size - room
    room = 0
  }
  return { groups: shown, hidden }
}

/** Task rows the block shows. */
export function groupSize(group: ClientTodoGroup): number {
  return group.kind === "single" ? 1 : group.items.length
}

/** A grouped row's second line: "Starts Nov 2", "Was to start Oct 20", or "No start date yet". */
export function startLine(startDate: string | null, now: Date): string {
  if (startDate === null) return "No start date yet"
  const day = formatDay(parseDay(startDate), now)
  return startDate < todayIso(now) ? `Was to start ${day}` : `Starts ${day}`
}
