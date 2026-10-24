"use client"

import { useId, useState } from "react"

import { DueLabel } from "@/components/tasks/task-bits"
import { TaskRowAction } from "@/components/tasks/task-row-action"
import { Button } from "@/components/ui/button"
import { capTodo, groupTodo, HOME_LIST_ROWS, startLine, type ClientTodoItem, type ClientTodoView } from "@/lib/client-home"

/**
 * "To do" on the client Home (ui-guidelines C28): the client's own jobs, worded as jobs. The
 * heading carries the count and, in the danger tone, how many are overdue; then rows of one height
 * with only a bottom border. A run of the same job is one group: its header says what and why
 * once, then one row per person. Every row ends in the same two right-aligned columns: the due
 * text (red only when overdue) and an outline button that does what the task's row action does
 * (`TaskRowAction`: a dialog task opens its dialog in place). Three task rows first, the rest
 * behind "View all", which expands in place.
 */
export function ClientTodo({ view, nowIso }: { view: ClientTodoView; nowIso: string }) {
  const headingId = useId()
  const [expanded, setExpanded] = useState(false)
  const now = new Date(nowIso)
  const groups = groupTodo(view.items)
  const capped = capTodo(groups, HOME_LIST_ROWS)
  const visible = expanded ? groups : capped.groups

  return (
    <section aria-labelledby={headingId} className="flex flex-col" data-testid="client-todo">
      <div className="flex min-h-8 items-center justify-between gap-3 pb-2">
        <h3 id={headingId} className="flex flex-wrap items-baseline gap-x-2 text-base font-semibold">
          <span>To do</span>
          {view.items.length > 0 ? (
            <span className="font-normal text-muted-foreground tabular-nums" data-testid="todo-count">
              <span aria-hidden>· </span>
              {view.total}
            </span>
          ) : null}
          {view.overdueCount > 0 ? (
            <span className="text-sm font-normal text-status-danger-foreground tabular-nums" data-testid="todo-overdue">
              {view.overdueCount} overdue
            </span>
          ) : null}
        </h3>
        {capped.hidden > 0 ? (
          <Button variant="ghost" size="sm" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} data-testid="todo-view-all">
            {expanded ? "Show less" : "View all"}
          </Button>
        ) : null}
      </div>

      {view.items.length === 0 ? (
        <p className="border-t border-border pt-3 text-sm text-muted-foreground" data-testid="todo-empty">
          You&apos;re all caught up.
        </p>
      ) : (
        <ul className="border-t border-border">
          {visible.map((group) =>
            group.kind === "single" ? (
              <TodoRow key={group.item.row.id} item={group.item} title={group.item.title} detail={group.item.why} now={now} />
            ) : (
              <li key={`group-${group.items[0].row.id}`} data-testid="todo-group" data-task-type={group.type}>
                <div className="flex min-h-14 flex-col justify-center border-b border-border py-2 text-sm">
                  <span data-testid="todo-group-title">
                    <span className="font-semibold">{group.title}</span>{" "}
                    <span className="text-muted-foreground tabular-nums">· {group.count}</span>
                  </span>
                  <span className="text-muted-foreground">{group.why}</span>
                </div>
                <ul aria-label={group.title}>
                  {group.items.map((item) => (
                    <TodoRow
                      key={item.row.id}
                      item={item}
                      title={item.personName}
                      detail={startLine(item.startDate, now)}
                      now={now}
                      grouped
                    />
                  ))}
                </ul>
              </li>
            ),
          )}
        </ul>
      )}
      {expanded && view.total > view.items.length ? (
        <p className="pt-2 text-xs text-muted-foreground">
          Showing {view.items.length} of {view.total}.
        </p>
      ) : null}
    </section>
  )
}

function TodoRow({
  item,
  title,
  detail,
  now,
  grouped = false,
}: {
  item: ClientTodoItem
  title: string
  detail: string
  now: Date
  grouped?: boolean
}) {
  return (
    <li
      className="flex min-h-14 items-center gap-4 border-b border-border py-2 text-sm"
      data-testid="todo-row"
      data-task-type={item.row.type}
      data-grouped={grouped || undefined}
    >
      <div className={grouped ? "flex min-w-0 flex-1 flex-col pl-4" : "flex min-w-0 flex-1 flex-col"}>
        <span>{title}</span>
        <span className="text-muted-foreground">{detail}</span>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-4">
        <DueLabel dueDate={item.row.dueDate} now={now} className="whitespace-nowrap sm:w-28 sm:text-right" />
        <div className="flex justify-end sm:w-36">
          <TaskRowAction row={item.row} variant="outline" size="sm" label={item.actionLabel} />
        </div>
      </div>
    </li>
  )
}
