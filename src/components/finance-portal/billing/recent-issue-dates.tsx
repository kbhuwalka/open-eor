import { formatIsoDay } from "@/lib/finance-format"
import { formatCents } from "@/lib/format"
import type { IssueDay } from "@/server/billing-preview"

const plural = (n: number, one: string, many: string = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The last issue dates, newest first (date, invoices, total): what earlier runs issued. Runs are not logged, so this is invoices by issue date. */
export function RecentIssueDates({ days }: { days: readonly IssueDay[] }) {
  return (
    <section aria-labelledby="recent-heading" className="flex flex-col gap-2" data-testid="recent-issues">
      <h3 id="recent-heading" className="text-sm font-medium">
        Recent issue dates
      </h3>
      {days.length === 0 ? (
        <p className="border-t border-border py-3 text-sm text-muted-foreground" data-testid="no-recent">
          No invoices have been issued yet.
        </p>
      ) : (
        <ul className="border-t border-border">
          {days.map((day) => (
            <li key={day.issueDate} className="flex h-10 items-center gap-3 border-b border-border px-2 text-sm" data-testid="recent-row">
              <span className="w-28 shrink-0 font-medium tabular-nums">{formatIsoDay(day.issueDate)}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground tabular-nums">{plural(day.count, "invoice")}</span>
              <span className="shrink-0 text-right tabular-nums">{formatCents(day.totalCents)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
