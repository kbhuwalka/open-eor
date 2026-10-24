import Link from "next/link"
import { CircleCheck, Download } from "lucide-react"

import { SummaryCard, SummaryRow } from "@/components/summary-card"
import { buttonVariants } from "@/components/ui/button"
import type { EmployeeScreenData } from "@/lib/employee-screen-data"
import { formatDay } from "@/lib/format"

/** What a finished task shows instead of its form: the done line, what was given (nothing sensitive in full) and the way on. */
export function CompletedPanel({
  data,
}: {
  data: EmployeeScreenData & { completed: NonNullable<EmployeeScreenData["completed"]> }
}) {
  const { completed, next } = data
  return (
    <section className="flex flex-col gap-4" data-testid="task-completed" aria-label="Completed">
      <div role="status" className="flex items-center gap-2 text-sm font-medium">
        <CircleCheck aria-hidden className="size-4 text-status-success-foreground" />
        Done {formatDay(new Date(completed.completedAt), new Date(data.nowIso))}
      </div>
      {completed.rows.length > 0 ? (
        <SummaryCard>
          {completed.rows.map((row) => (
            <SummaryRow key={row.label} label={row.label}>
              {row.value}
            </SummaryRow>
          ))}
        </SummaryCard>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {next ? (
          <Link href={next.href} className={buttonVariants()} data-testid="completed-next">
            Next: {next.label}
          </Link>
        ) : null}
        {completed.documentId ? (
          <a
            href={`/worker/documents/${completed.documentId}/download`}
            className={buttonVariants({ variant: "outline" })}
            data-testid="completed-download"
          >
            <Download data-icon="inline-start" />
            Download signed copy
          </a>
        ) : null}
        <Link href="/worker" className={buttonVariants({ variant: next ? "ghost" : "default" })}>
          Back to your checklist
        </Link>
      </div>
    </section>
  )
}
