import Link from "next/link"
import { cn } from "cn"

import { formatIsoDay } from "@/lib/finance-format"
import type { HistoryEntry } from "@/lib/finance-portal-view"

const DOT: Record<HistoryEntry["tone"], string> = {
  neutral: "bg-muted-foreground",
  info: "bg-status-info-foreground",
  success: "bg-status-success-foreground",
  danger: "bg-status-danger-foreground",
}

/** Oldest first, on the same marker-and-hairline idiom as the activity timeline. */
export function InvoiceHistory({ entries }: { entries: readonly HistoryEntry[] }) {
  return (
    <ol className="flex flex-col" data-testid="invoice-history">
      {entries.map((entry, index) => (
        <li key={entry.key} className="relative flex gap-3 pb-5 last:pb-0" data-testid="history-entry">
          {index < entries.length - 1 ? <span aria-hidden className="absolute top-3 bottom-0 left-[3px] w-px bg-border" /> : null}
          <span aria-hidden className={cn("relative mt-1.5 size-2 shrink-0 rounded-full", DOT[entry.tone])} />
          <div className="flex min-w-0 flex-col gap-0.5 text-sm">
            <span className="font-medium">{entry.title}</span>
            {entry.detail ? <span className="text-xs text-muted-foreground">{entry.detail}</span> : null}
            <span className="text-xs text-muted-foreground tabular-nums">
              {entry.at ? formatIsoDay(entry.at) : "Date not recorded"}
              {entry.paymentId ? (
                <>
                  {" · "}
                  <Link
                    href={`/finance/payments/${encodeURIComponent(entry.paymentId)}`}
                    className="rounded-sm font-mono underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {entry.paymentId}
                  </Link>
                </>
              ) : null}
            </span>
          </div>
        </li>
      ))}
    </ol>
  )
}
