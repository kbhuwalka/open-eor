"use client"

import { useState } from "react"
import { cn } from "cn"
import { ChevronRight } from "lucide-react"

import type { BillingClientGroup } from "@/lib/billing-run-view"
import { INVOICE_KIND_LABEL } from "@/lib/finance-view"
import { formatCents } from "@/lib/format"

const plural = (n: number, one: string, many: string = `${one}s`) => `${n} ${n === 1 ? one : many}`

const COUNT = "w-24 shrink-0 text-right text-muted-foreground tabular-nums"
const MONEY = "w-32 shrink-0 text-right tabular-nums"

/**
 * What Run billing would issue, one row per client (invoices and total), each expanding in place
 * to that client's invoices (person, kind, amount). Rows have only a bottom border (C43 look).
 */
export function BillingByClient({ groups }: { groups: readonly BillingClientGroup[] }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const toggle = (companyId: string) =>
    setOpen((current) => {
      const next = new Set(current)
      if (next.has(companyId)) next.delete(companyId)
      else next.add(companyId)
      return next
    })

  return (
    <section aria-labelledby="by-client-heading" className="flex flex-col gap-2" data-testid="by-client">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="by-client-heading" className="text-sm font-medium">
          By client
        </h3>
        {groups.length > 0 ? <span className="text-xs text-muted-foreground tabular-nums">{plural(groups.length, "client")}</span> : null}
      </div>
      {groups.length === 0 ? (
        <p className="border-t border-border py-3 text-sm text-muted-foreground" data-testid="by-client-empty">
          Nothing waiting to be issued.
        </p>
      ) : (
        <ul className="border-t border-border">
          {groups.map((group) => {
            const expanded = open.has(group.companyId)
            const panel = `by-client-${group.companyId.replace(/\W+/g, "-")}`
            return (
              <li key={group.companyId} className="border-b border-border" data-testid="by-client-row" data-company-id={group.companyId}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={panel}
                  onClick={() => toggle(group.companyId)}
                  className="flex h-10 w-full items-center gap-3 rounded-sm px-2 text-left text-sm outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50"
                  data-testid="by-client-toggle"
                >
                  <ChevronRight aria-hidden className={cn("size-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")} />
                  <span className="min-w-0 flex-1 truncate font-medium">{group.companyName}</span>
                  <span className={COUNT}>{plural(group.count, "invoice")}</span>
                  <span className={cn(MONEY, "font-medium")}>{formatCents(group.totalCents)}</span>
                </button>
                {expanded ? (
                  <ul id={panel} aria-label={`${group.companyName}: invoices the run would issue`} className="pb-1">
                    {group.invoices.map((invoice) => (
                      <li
                        key={invoice.id}
                        className="flex h-9 items-center gap-3 border-t border-border/60 pr-2 pl-9 text-sm"
                        data-testid="by-client-invoice"
                      >
                        <span className="min-w-0 flex-1 truncate">{invoice.personName}</span>
                        <span className={COUNT}>{INVOICE_KIND_LABEL[invoice.kind]}</span>
                        <span className={MONEY}>{formatCents(invoice.totalCents)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
