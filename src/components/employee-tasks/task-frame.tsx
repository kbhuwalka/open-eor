import type { ReactNode } from "react"
import Link from "next/link"
import { Lock, TriangleAlert } from "lucide-react"
import { cn } from "cn"

import { PageHeader } from "@/components/page-header"
import { buttonVariants } from "@/components/ui/button"
import type { EmployeeScreenData } from "@/lib/employee-screen-data"
import { dueLabel } from "@/lib/employee-view"
import { rejectReasonText } from "@/lib/task-view"

/** The thin "N of M done" bar; widths are attributes so no inline style is needed (ui-guidelines T5). */
export function ProgressBar({ done, total, label }: { done: number; total: number; label: string }) {
  const percent = total === 0 ? 0 : Math.round((done / total) * 100)
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox="0 0 100 2"
      preserveAspectRatio="none"
      className="h-1.5 w-full overflow-hidden rounded-full"
    >
      <rect width="100" height="2" className="fill-muted" />
      <rect width={percent} height="2" className="fill-primary" />
    </svg>
  )
}

/**
 * The frame every employee task screen shares (ui-guidelines C35): "Task 3 of 8" with the due date
 * and a progress bar, the task's friendly title, and, when Northwind sent the work back, why.
 * One column capped at `max-w-2xl`, so the wizards inside keep their own width.
 */
export function EmployeeTaskFrame({
  data,
  description,
  children,
}: {
  data: EmployeeScreenData
  description?: string
  children: ReactNode
}) {
  const { step } = data
  const now = new Date(data.nowIso)
  const due = data.completed ? null : dueLabel(step.dueDate, now)
  const done = step.status === "done"
  return (
    <div
      className="flex w-full max-w-2xl flex-col gap-6"
      data-testid="employee-task"
      data-task-type={step.type}
      data-task-status={step.status}
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
          <span className="font-medium tabular-nums" data-testid="task-position">
            Task {step.position} of {step.total}
          </span>
          {done ? (
            <span>Done</span>
          ) : due ? (
            <span className={cn("tabular-nums", due.danger && "text-status-danger-foreground")} data-overdue={due.danger || undefined}>
              {due.text}
            </span>
          ) : null}
        </div>
        <ProgressBar
          done={step.position - (done ? 0 : 1)}
          total={step.total}
          label={`Task ${step.position} of ${step.total}`}
        />
      </div>
      <PageHeader title={step.label} description={description ?? step.description} />
      {step.rework && !done ? <SentBack reason={step.rework} /> : null}
      {data.canAct || data.completed ? children : <NotOpen data={data} />}
    </div>
  )
}

/** A task that cannot be done yet (or any more): say why and point at what can be done. */
function NotOpen({ data }: { data: EmployeeScreenData }) {
  const waiting = data.step.status === "blocked"
  return (
    <section
      className="flex flex-col items-start gap-4 rounded-lg border border-dashed border-border px-6 py-8"
      data-testid="task-not-open"
    >
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Lock aria-hidden className="size-4 shrink-0" />
        {waiting
          ? "This step opens after the steps before it are done."
          : "This step is closed. Contact Northwind if something needs to change."}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {data.next ? (
          <Link href={data.next.href} className={buttonVariants()}>
            Next: {data.next.label}
          </Link>
        ) : null}
        <Link href="/worker" className={buttonVariants({ variant: data.next ? "ghost" : "default" })}>
          Back to your checklist
        </Link>
      </div>
    </section>
  )
}

function SentBack({ reason }: { reason: { code: string; note?: string } }) {
  return (
    <div
      role="note"
      className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-4 text-sm"
      data-testid="sent-back"
    >
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-status-danger-foreground" />
      <div className="flex flex-col gap-1">
        <span className="font-medium">Northwind sent this back</span>
        <span className="text-status-danger-foreground">{rejectReasonText(reason)}</span>
        <span className="text-xs text-muted-foreground">Fix what is described above, then send it again.</span>
      </div>
    </div>
  )
}
