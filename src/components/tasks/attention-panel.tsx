"use client"

import { useId, useState } from "react"
import { CircleAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { TaskInboxRow } from "@/lib/task-inbox-view"

import { DueLabel } from "./task-bits"
import { TaskRowAction } from "./task-row-action"

export const ATTENTION_COLLAPSED_ROWS = 3

/**
 * The client home's "Needs your attention" (ui-guidelines C28): a compact bordered panel with the
 * client's most urgent tasks, three at first and the rest behind "View all". Each row's action follows
 * the registry surface: a dialog opens in place, anything else goes to the page where it is done.
 * Renders nothing when there is nothing to do, so the people list is never pushed down for no reason.
 * `rows` are already scoped to the signed-in client and ordered by urgency.
 */
export function AttentionPanel({
  rows,
  total,
  nowIso,
}: {
  rows: readonly TaskInboxRow[]
  /** Open tasks in all; may exceed `rows.length` when the server capped the list. */
  total: number
  nowIso: string
}) {
  const headingId = useId()
  const [expanded, setExpanded] = useState(false)
  if (rows.length === 0) return null
  const now = new Date(nowIso)
  const visible = expanded ? rows : rows.slice(0, ATTENTION_COLLAPSED_ROWS)
  const canExpand = rows.length > ATTENTION_COLLAPSED_ROWS

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-lg border border-border bg-card"
      data-testid="attention-panel"
    >
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <h3 id={headingId} className="flex items-center gap-2 text-sm font-medium">
          <CircleAlert aria-hidden className="size-4 text-status-warning-foreground" />
          Needs your attention
          <span className="text-muted-foreground tabular-nums" data-testid="attention-count">
            {total}
          </span>
        </h3>
        {canExpand ? (
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            data-testid="attention-view-all"
          >
            {expanded ? "Show less" : `View all (${total})`}
          </Button>
        ) : null}
      </header>
      <ul className="divide-y divide-border">
        {visible.map((row) => (
          <li
            key={row.id}
            className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            data-testid="attention-row"
            data-task-type={row.type}
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-medium">{row.title}</span>
              <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                <span>{row.personName}</span>
                {row.detail ? <span aria-hidden>·</span> : null}
                {row.detail ? <span>{row.detail}</span> : null}
                {row.dueDate ? <span aria-hidden>·</span> : null}
                <DueLabel dueDate={row.dueDate} now={now} />
              </span>
            </div>
            <div className="shrink-0">
              <TaskRowAction row={row} />
            </div>
          </li>
        ))}
      </ul>
      {expanded && total > rows.length ? (
        <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          Showing {rows.length} of {total}.
        </p>
      ) : null}
    </section>
  )
}
