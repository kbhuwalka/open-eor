import type { ReactNode } from "react"

import { PageHeader } from "@/components/page-header"
import { SummaryCard, SummaryRow } from "@/components/summary-card"
import { formatDay } from "@/lib/format"
import type { TaskCaseSummary, TaskInboxRow } from "@/lib/task-inbox-view"
import { parseDay } from "@/lib/task-view"
import type { Portal } from "@/lib/task-ui-registry"

import { DueLabel, TaskStatusBadge } from "./task-bits"

/**
 * The shared shape of a task screen (ui-guidelines C29, L3): `PageHeader` with the task's wording and
 * status, the screen's own content on the left, and a `w-80` rail on the right that says what the
 * task is, when it is due, who it waits on and which person it is for. Registered screens SHOULD
 * wrap their form in this so every task page reads the same; a form-only screen may skip the rail
 * with `rail={false}`.
 */
export function TaskScreenFrame({
  task,
  caseSummary,
  portal,
  nowIso,
  description,
  rail = true,
  children,
}: {
  task: TaskInboxRow
  caseSummary: TaskCaseSummary
  portal: Portal
  nowIso: string
  /** Overrides the header description (defaults to the template description). */
  description?: string
  rail?: boolean
  children: ReactNode
}) {
  const now = new Date(nowIso)
  return (
    <div className="flex flex-col gap-8" data-testid="task-screen" data-task-type={task.type} data-task-status={task.status}>
      <PageHeader
        title={task.title}
        description={description ?? task.description}
        actions={<TaskStatusBadge row={task} />}
      />
      {rail ? (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex min-w-0 flex-col gap-6">{children}</div>
          <TaskRail task={task} caseSummary={caseSummary} portal={portal} now={now} />
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-6">{children}</div>
      )}
    </div>
  )
}

function TaskRail({
  task,
  caseSummary,
  portal,
  now,
}: {
  task: TaskInboxRow
  caseSummary: TaskCaseSummary
  portal: Portal
  now: Date
}) {
  return (
    <aside aria-label="Task details" className="flex flex-col gap-4">
      <SummaryCard>
        <SummaryRow label="Status">
          <TaskStatusBadge row={task} />
        </SummaryRow>
        {task.status === "done" && task.completedAt ? (
          <SummaryRow label="Completed">{formatDay(new Date(task.completedAt), now)}</SummaryRow>
        ) : (
          <SummaryRow label="Due">
            <DueLabel dueDate={task.dueDate} now={now} fallback="No due date" />
          </SummaryRow>
        )}
        <SummaryRow label="Waiting on">{task.assigneeLabel}</SummaryRow>
        <SummaryRow label="Step">{caseSummary.phaseTitle}</SummaryRow>
      </SummaryCard>
      <SummaryCard>
        <SummaryRow label="Person">{caseSummary.personName}</SummaryRow>
        {portal === "client" ? null : <SummaryRow label="Client">{caseSummary.clientName}</SummaryRow>}
        <SummaryRow label="Role">{caseSummary.roleName}</SummaryRow>
        {caseSummary.startDate ? (
          <SummaryRow label="Start date">{formatDay(parseDay(caseSummary.startDate), now)}</SummaryRow>
        ) : null}
      </SummaryCard>
    </aside>
  )
}
