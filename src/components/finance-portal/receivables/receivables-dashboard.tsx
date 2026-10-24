"use client"

import { useCallback, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { cn } from "cn"

import { UrlPagination } from "@/components/data-table/url-pagination"
import { useListCursor } from "@/components/dense-list"
import { EmptyState } from "@/components/empty-state"
import { BarList } from "@/components/finance-portal/charts/bar-list"
import { InvoicesTable } from "@/components/finance-portal/invoices-table"
import { FilterChips, RefetchBar } from "@/components/finance-portal/list-controls"
import { buttonVariants } from "@/components/ui/button"
import { ChartLegendList } from "@/components/ui/chart"
import type { BarListRow } from "@/lib/finance-chart-view"
import { financeInvoiceHref } from "@/lib/invoice-links"
import type { ReceivablesChip, ReceivablesFigures as Figures } from "@/lib/receivables-view"
import type { FinanceReceivablesPage } from "@/server/finance-lists"

import { ReceivablesFigures } from "./receivables-figures"

export type ReceivablesDashboardProps = {
  figures: Figures
  byAge: readonly BarListRow[]
  byClient: readonly BarListRow[]
  chips: readonly ReceivablesChip[]
  /** Both filters off, the other parameters kept. */
  clearHref: string
  table: FinanceReceivablesPage
}

const CLIENT_LEGEND = [
  { key: "overdue", label: "Overdue", tone: "alert" as const },
  { key: "not-yet-due", label: "Not yet due", tone: "neutral" as const },
]

/**
 * Receivables (docs/finance-portal.md §2.5, ui-guidelines C32): the figures line, the By age and
 * By client bar lists that filter the table (`?bucket=`, `?client=`), the chips of what is
 * selected, and the unpaid invoices in the chase order. Every filter is a link the server renders
 * from the URL; a plain click navigates softly in a transition, so the figures and the table dim
 * until the server answers. A table row opens the invoice in the Invoices drawer.
 */
export function ReceivablesDashboard({ figures, byAge, byClient, chips, clearHref, table }: ReceivablesDashboardProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [cursor, setCursor] = useState<string | null>(null)

  const navigate = useCallback((href: string) => startTransition(() => router.push(href, { scroll: false })), [router])
  const openInvoice = useCallback((id: string) => router.push(financeInvoiceHref(id)), [router])
  useListCursor({ ids: table.rows.map((row) => row.id), cursor, onCursor: setCursor, onOpen: openInvoice, enabled: true })

  const dim = cn("transition-opacity", pending && "opacity-60")

  return (
    <div className="flex flex-col gap-6">
      <div className={dim} aria-busy={pending}>
        <ReceivablesFigures figures={figures} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2" data-testid="receivables-charts">
        <BarList title="By age" rows={byAge} rowHeader="Days late" emptyMessage="Nothing is owed." onNavigate={navigate} testId="by-age" />
        <BarList
          title="By client"
          rows={byClient}
          rowHeader="Client"
          emptyMessage="No client owes money of this age."
          onNavigate={navigate}
          testId="by-client"
          footer={<ChartLegendList items={CLIENT_LEGEND} className="px-2.5" />}
        />
      </div>

      {chips.length > 0 ? (
        <FilterChips
          chips={chips.map((chip) => ({ key: chip.key, label: chip.label, remove: { href: chip.href, run: () => navigate(chip.href) } }))}
          clear={{ href: clearHref, run: () => navigate(clearHref) }}
        />
      ) : null}

      <section
        aria-label="Unpaid invoices"
        aria-busy={pending}
        className="relative flex flex-col gap-4"
        data-testid="receivables-invoices"
        data-total={table.total}
        data-total-cents={table.summary.outstandingCents}
      >
        <RefetchBar pending={pending} testId="receivables-refetching" />
        <div className={dim}>
          {table.total === 0 ? (
            <div data-testid="no-receivable-invoices">
              <EmptyState
                message="No unpaid invoices match these filters."
                action={
                  <Link
                    href={clearHref}
                    scroll={false}
                    onClick={(event) => {
                      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                      event.preventDefault()
                      navigate(clearHref)
                    }}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    Clear
                  </Link>
                }
              />
            </div>
          ) : (
            <InvoicesTable
              variant="receivables"
              rows={table.rows}
              today={table.today}
              cursor={cursor}
              hrefOf={financeInvoiceHref}
              onOpen={openInvoice}
            />
          )}
        </div>
        <UrlPagination page={table.page} totalPages={table.totalPages} total={table.total} pageSize={table.pageSize} />
      </section>
    </div>
  )
}
