import Link from "next/link"
import { Fragment } from "react"
import { Undo2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DueLabel, TaskStatusBadge } from "@/components/tasks/task-bits"
import { formatRelative } from "@/lib/format"
import type { StaffCaseDetail, StaffTaskItem } from "@/server/onboarding-portal/case-detail"

/**
 * Every task on the case, by stage (onboarding-portal.md §3): the owner, the status, who finished
 * it and when, the rework history, and the action for the tasks the specialist can do now.
 * Hidden tasks (system steps) are not listed; sent-back attempts sit under the step they belong to.
 */
export function CaseTasksTab({ stages, now }: { stages: StaffCaseDetail["stages"]; now: Date }) {
  return (
    <div className="flex flex-col gap-6" data-testid="case-tasks">
      {stages.map((stage) => {
        const items = stage.items.filter((item) => !item.hidden)
        if (items.length === 0) return null
        return (
          <section key={stage.id} className="flex flex-col gap-2" data-testid={`case-stage-${stage.id}`} aria-labelledby={`stage-${stage.id}-title`}>
            <h3 id={`stage-${stage.id}-title`} className="text-sm font-semibold">{stage.title}</h3>
            <ul className="overflow-hidden rounded-lg border border-border">
              {items.map((item) => (
                <TaskRow key={item.id} item={item} now={now} />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function TaskRow({ item, now }: { item: StaffTaskItem; now: Date }) {
  return (
    <li className="flex flex-col gap-1.5 px-4 py-3 not-first:border-t not-first:border-border" data-testid="case-task" data-task-type={item.type} data-task-status={item.status}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-medium">{item.label}</span>
          <span className="text-xs text-muted-foreground">
            {item.ownerLabel}
            {item.completedAt ? (
              <Fragment>
                {" · "}Done {formatRelative(item.completedAt, now)}
                {item.completedBy ? ` by ${item.completedBy}` : ""}
              </Fragment>
            ) : null}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {item.status !== "done" ? <DueLabel dueDate={item.dueDate} now={now} className="text-xs" /> : null}
          <TaskStatusBadge row={{ status: item.status, overdue: item.overdue }} />
          {item.action ? (
            <Button variant="outline" size="sm" render={<Link href={item.action.href} />} nativeButton={false} data-testid="case-task-action">
              {item.action.label}
            </Button>
          ) : null}
        </div>
      </div>
      {item.rework ? (
        <p className="flex items-start gap-1.5 text-xs text-status-danger-foreground" data-testid="case-task-rework">
          <Undo2 aria-hidden className="mt-0.5 size-3 shrink-0" />
          Sent back, waiting on a fix: {item.rework}
        </p>
      ) : null}
      {item.sentBack.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground" data-testid="case-task-history">
          {item.sentBack.map((entry) => (
            <li key={entry.at}>
              Sent back {formatRelative(entry.at, now)} by {entry.by}: {entry.reason}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}
