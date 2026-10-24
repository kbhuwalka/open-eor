import type { ReactNode } from "react"
import { cn } from "cn"

import { formatDay } from "@/lib/format"
import { parseDay } from "@/lib/task-view"
import type { OnboardingTaskView, OnboardingView } from "@/server/queries"

/**
 * The tasks still to do as timeline rows, grouped by workflow phase (tasks-and-workflow.md §7).
 * Render inside `CaseTimeline`'s `trailing` slot so completed events and upcoming tasks read as
 * one vertical list. `renderAction` supplies the inline control for tasks the client can finish.
 */
export function OnboardingTasks({
  onboarding,
  now,
  renderAction,
}: {
  onboarding: Pick<OnboardingView, "phases" | "tasks">
  now: Date
  renderAction?: (task: OnboardingTaskView) => ReactNode
}) {
  const groups = onboarding.phases
    .map((phase) => ({ phase, tasks: onboarding.tasks.filter((t) => t.phase === phase.id) }))
    .filter((group) => group.tasks.length > 0)
  const flat = groups.flatMap((group) => group.tasks)
  if (flat.length === 0) return null

  return (
    <>
      {groups.map(({ phase, tasks }) => [
        <li
          key={`phase-${phase.id}`}
          className="relative pb-3 pl-5 text-xs font-medium tracking-wide text-muted-foreground uppercase"
          data-testid={`phase-${phase.id}`}
        >
          <span aria-hidden className="absolute top-0 left-[3px] h-full w-px bg-border" />
          {phase.title}
        </li>,
        ...tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            now={now}
            last={task === flat[flat.length - 1]}
            action={renderAction?.(task)}
          />
        )),
      ])}
    </>
  )
}

function dueText(task: OnboardingTaskView, now: Date): { text: string; danger: boolean } | null {
  if (!task.dueDate) return null
  const day = formatDay(parseDay(task.dueDate), now)
  return task.overdue ? { text: `Was due ${day}`, danger: true } : { text: `Due ${day}`, danger: false }
}

function TaskRow({
  task,
  now,
  last,
  action,
}: {
  task: OnboardingTaskView
  now: Date
  last: boolean
  action: ReactNode
}) {
  const ready = task.status === "ready"
  const needsYou = ready && task.clientCanAct
  const due = task.isStart ? null : dueText(task, now)
  const start = task.isStart && task.dueDate ? formatDay(parseDay(task.dueDate), now) : null

  return (
    <li
      className="relative flex gap-3 pb-5 last:pb-0"
      data-status={ready ? "ready" : "blocked"}
      data-task={task.key}
      data-testid={`task-${task.key}`}
      aria-current={needsYou ? "step" : undefined}
    >
      {!last ? <span aria-hidden className="absolute top-3 left-[3px] h-full w-px bg-border" /> : null}
      <span
        aria-hidden
        className={cn(
          "relative mt-1.5 size-[7px] shrink-0 rounded-full",
          ready ? "bg-foreground ring-4 ring-foreground/15" : "border border-muted-foreground/60 bg-background"
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-baseline justify-between gap-4">
          <span className={cn("text-sm", ready ? "font-medium" : "text-muted-foreground")}>
            {task.isStart ? "Start date" : task.title}
          </span>
          {start ? (
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums" data-testid="task-start">
              {start}
            </span>
          ) : null}
        </div>
        <span className="text-xs text-muted-foreground">
          {task.isStart ? (
            "Northwind"
          ) : (
            <>
              {task.owner}
              {needsYou ? (
                <>
                  {" · "}
                  <span className="text-status-warning-foreground">Needs you</span>
                </>
              ) : null}
              {due ? (
                <>
                  {" · "}
                  <span
                    className={due.danger ? "text-status-danger-foreground" : undefined}
                    data-testid="task-due"
                  >
                    {due.text}
                  </span>
                </>
              ) : null}
            </>
          )}
        </span>
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </li>
  )
}
