import { ChevronRight, CircleCheck, Lock } from "lucide-react"

import { EmptyState } from "@/components/empty-state"
import { formatDay } from "@/lib/format"
import type { TaskInboxRow, TodoView } from "@/lib/task-inbox-view"

import { DueLabel } from "./task-bits"
import { TaskRowAction } from "./task-row-action"

const DETAILS_SUMMARY =
  "inline-flex w-fit cursor-pointer list-none items-center gap-1 rounded-md text-sm text-muted-foreground transition-colors outline-none select-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden"

/**
 * The employee's guided to-do list (ui-guidelines C28): "N of M done" with a thin bar, the next task as
 * one prominent card with the primary Continue button, any other ready tasks as quiet rows, what is
 * still locked as muted rows, and finished work collapsed. `view` comes from `todoFor` and is already
 * scoped to the signed-in employee. Nothing here names a task type.
 */
export function TaskTodoList({ view, nowIso }: { view: TodoView; nowIso: string }) {
  const now = new Date(nowIso)
  const [next, ...more] = view.ready
  const { done, total } = view.progress
  const caughtUp = !next && view.upcoming.length === 0

  return (
    <div className="flex flex-col gap-8" data-testid="task-todo">
      {total > 0 ? <Progress done={done} total={total} /> : null}

      {next ? <UpNext row={next} now={now} /> : null}

      {caughtUp ? (
        <EmptyState message="You're all caught up. New steps show up here as soon as they're ready." />
      ) : !next ? (
        <EmptyState message="Nothing to do right now. Your next step opens as soon as the steps before it are done." />
      ) : null}

      {more.length > 0 ? (
        <section aria-labelledby="todo-more" className="flex flex-col gap-3">
          <h3 id="todo-more" className="text-lg font-medium">
            Also to do
          </h3>
          <ul className="flex flex-col gap-2">
            {more.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3"
                data-testid="todo-ready"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium">{row.title}</span>
                  <DueLabel dueDate={row.dueDate} now={now} className="text-xs" />
                </div>
                <TaskRowAction row={row} label="Open" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {view.upcoming.length > 0 ? (
        <section aria-labelledby="todo-later" className="flex flex-col gap-3">
          <h3 id="todo-later" className="text-lg font-medium">
            Coming up
          </h3>
          <ul className="flex flex-col gap-2">
            {view.upcoming.map((row) => (
              <li
                key={row.id}
                className="flex items-center gap-3 rounded-lg border border-border px-4 py-3 text-muted-foreground"
                data-testid="todo-upcoming"
              >
                <Lock aria-hidden className="size-4 shrink-0" />
                <span className="text-sm">{row.title}</span>
                <span className="ml-auto text-xs">Opens after your earlier steps</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {view.done.length > 0 ? (
        <details className="group" data-testid="todo-done">
          <summary className={DETAILS_SUMMARY}>
            <ChevronRight aria-hidden className="size-3.5 transition-transform group-open:rotate-90" />
            Completed ({view.done.length})
          </summary>
          <ul className="mt-3 flex flex-col gap-2 pl-4">
            {view.done.map((row) => (
              <li key={row.id} className="flex items-center gap-3 text-sm text-muted-foreground">
                <CircleCheck aria-hidden className="size-4 shrink-0 text-status-success-foreground" />
                <span>{row.title}</span>
                {row.completedAt ? (
                  <span className="ml-auto text-xs tabular-nums">{formatDay(new Date(row.completedAt), now)}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}

function Progress({ done, total }: { done: number; total: number }) {
  const percent = total === 0 ? 0 : Math.round((done / total) * 100)
  return (
    <section aria-label="Progress" className="flex flex-col gap-2">
      <p className="text-sm font-medium tabular-nums" data-testid="todo-progress">
        {done} of {total} done
      </p>
      <svg
        role="img"
        aria-label={`${done} of ${total} steps done`}
        viewBox="0 0 100 2"
        preserveAspectRatio="none"
        className="h-1.5 w-full overflow-hidden rounded-full"
      >
        <rect width="100" height="2" className="fill-muted" />
        <rect width={percent} height="2" className="fill-primary" />
      </svg>
    </section>
  )
}

function UpNext({ row, now }: { row: TaskInboxRow; now: Date }) {
  return (
    <section
      aria-label="Up next"
      className="flex flex-col gap-4 rounded-lg border border-border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between"
      data-testid="todo-next"
      data-task-type={row.type}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Up next</span>
        <span className="text-base font-medium">{row.title}</span>
        {row.detail ? <p className="text-xs text-muted-foreground">{row.detail}</p> : null}
        <DueLabel dueDate={row.dueDate} now={now} className="text-xs" />
      </div>
      <div className="shrink-0">
        <TaskRowAction row={row} variant="default" size="default" label="Continue" />
      </div>
    </section>
  )
}
