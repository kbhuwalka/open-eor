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
import type { BarListRow } from "@/lib/finance-chart-view"
import { financeInvoiceHref } from "@/lib/invoice-links"
import { ageTakeaway, type ReceivablesChip, type ReceivablesFigures as Figures } from "@/lib/receivables-view"
import type { FinanceReceivablesPage } from "@/server/finance-lists"

import { ReceivablesFigures } from "./receivables-figures"

export type ReceivablesDashboardProps = {
  figures: Figures
  byAge: readonly BarListRow[]
  chips: readonly ReceivablesChip[]
  /** The age filter off, the client and other parameters kept. */
  clearHref: string
  table: FinanceReceivablesPage
}

/**
 * Receivables (docs/finance-portal.md §2.5, ui-guidelines C32), laid out like the Finance Home: the
 * figures line, the By age chart across the page (a bar list whose rows filter the table with
 * `?bucket=`), then "Unpaid invoices" with the chip of the selected age and the table in the
 * chase order. The client is the header's filter (`?client=`), which narrows all three. Every
 * filter is a link the server renders from the URL; a plain click navigates softly in a
 * transition, so the figures and the table dim until the server answers. A table row opens the
 * invoice in the Invoices drawer.
 */
export function ReceivablesDashboard({ figures, byAge, chips, clearHref, table }: ReceivablesDashboardProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [cursor, setCursor] = useState<string | null>(null)

  const navigate = useCallback((href: string) => startTransition(() => router.push(href, { scroll: false })), [router])
  const openInvoice = useCallback((id: string) => router.push(financeInvoiceHref(id)), [router])
  useListCursor({ ids: table.rows.map((row) => row.id), cursor, onCursor: setCursor, onOpen: openInvoice, enabled: true })

  const dim = cn("transition-opacity", pending && "opacity-60")

  return (
    <div className="flex flex-col gap-8">
      <div className={dim} aria-busy={pending}>
        <ReceivablesFigures figures={figures} />
      </div>

      <BarList
        title="By age"
        takeaway={ageTakeaway(byAge)}
        variant="section"
        rows={byAge}
        rowHeader="Days late"
        emptyMessage="Nothing is owed."
        onNavigate={navigate}
        testId="by-age"
      />

      <section
        aria-labelledby="receivables-invoices-title"
        aria-busy={pending}
        className="relative flex flex-col gap-3"
        data-testid="receivables-invoices"
        data-total={table.total}
        data-total-cents={table.summary.outstandingCents}
      >
        <RefetchBar pending={pending} testId="receivables-refetching" />
        <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-2">
          <h3 id="receivables-invoices-title" className="text-base font-semibold">
            Unpaid invoices{" "}
            <span className="font-normal text-muted-foreground tabular-nums">
              <span aria-hidden>· </span>
              <span data-testid="receivables-count">{table.total}</span>
            </span>
          </h3>
          {chips.length > 0 ? (
            <FilterChips
              chips={chips.map((chip) => ({ key: chip.key, label: chip.label, remove: { href: chip.href, run: () => navigate(chip.href) } }))}
              clear={{ href: clearHref, run: () => navigate(clearHref) }}
            />
          ) : null}
        </div>
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
