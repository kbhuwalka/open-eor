"use client"

import { useState } from "react"
import Link from "next/link"
import { Search, X } from "lucide-react"

import { EmptyState } from "@/components/empty-state"
import { InvoiceTable } from "@/components/finance/invoice-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { OptionSelect, type Option } from "@/components/ui/option-select"
import {
  INVOICE_STATUS_FILTER_LABEL,
  INVOICE_STATUS_FILTERS,
  filterInvoiceRows,
  payAllDueIds,
  selectionTotals,
  unpaidInvoiceRows,
  type InvoiceRow,
  type InvoiceStatusFilter,
} from "@/lib/finance-view"
import { formatCents } from "@/lib/format"

const STATUS_OPTIONS: Option[] = INVOICE_STATUS_FILTERS.map((value) => ({
  value,
  label: INVOICE_STATUS_FILTER_LABEL[value],
}))

export type InvoicesPanelProps = {
  /** Every invoice of the company; the panel lists only the unpaid ones (`unpaidInvoiceRows`). */
  invoices: readonly InvoiceRow[]
  selected: ReadonlySet<string>
  onSelectedChange: (next: Set<string>) => void
  onOpen: (row: InvoiceRow) => void
  onPay: (invoiceIds: string[]) => void
  canPay: boolean
  /** Why Pay is disabled; shown beside the buttons when `canPay` is false. */
  payDisabledReason: string
  /** Optional control of the status filter, so the page can jump to a filtered table. */
  status?: InvoiceStatusFilter
  onStatusChange?: (status: InvoiceStatusFilter) => void
}

export function InvoicesPanel({
  invoices,
  selected,
  onSelectedChange,
  onOpen,
  onPay,
  canPay,
  payDisabledReason,
  status: controlledStatus,
  onStatusChange,
}: InvoicesPanelProps) {
  const [ownStatus, setOwnStatus] = useState<InvoiceStatusFilter>("all")
  const status = controlledStatus ?? ownStatus
  const setStatus = onStatusChange ?? setOwnStatus
  const [query, setQuery] = useState("")

  const unpaid = unpaidInvoiceRows(invoices)

  if (invoices.length === 0) {
    return (
      <div data-testid="no-invoices-yet">
        <EmptyState
          message="No invoices yet. Invoices are issued 7 days before each pay date once a person starts."
          action={
            <Button variant="outline" nativeButton={false} render={<Link href="/client/people/new" />}>
              Start a hire
            </Button>
          }
        />
      </div>
    )
  }

  if (unpaid.length === 0) {
    return (
      <div data-testid="no-unpaid-invoices">
        <EmptyState message="Nothing to pay right now. Invoices you have paid, and payments still processing, are under Payments." />
      </div>
    )
  }

  const filtered = filterInvoiceRows(unpaid, { status, query })
  const filtersActive = status !== "all" || query.trim() !== ""
  const picked = selectionTotals(unpaid, selected)
  const dueIds = payAllDueIds(unpaid)
  const dueCents = unpaid.filter((row) => dueIds.includes(row.id)).reduce((total, row) => total + row.totalCents, 0)
  const hasPayable = dueIds.length > 0

  function changeFilters(next: { status?: InvoiceStatusFilter; query?: string }) {
    if (next.status !== undefined) setStatus(next.status)
    if (next.query !== undefined) setQuery(next.query)
    onSelectedChange(new Set())
  }

  function clearFilters() {
    changeFilters({ status: "all", query: "" })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3" role="search" data-testid="invoice-filters">
        <div className="relative min-w-56 flex-[2_1_16rem]">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => changeFilters({ query: e.target.value })}
            placeholder="Search person or invoice number"
            aria-label="Search invoices"
            className="pl-9"
            data-testid="invoice-search"
          />
        </div>
        <div className="w-44">
          <OptionSelect
            options={STATUS_OPTIONS}
            value={status}
            onValueChange={(value) => changeFilters({ status: value as InvoiceStatusFilter })}
            data-testid="invoice-status-filter"
          />
        </div>
        {filtersActive ? (
          <Button variant="ghost" onClick={clearFilters} data-testid="clear-invoice-filters">
            <X data-icon="inline-start" />
            Clear
          </Button>
        ) : null}
      </div>

      <InvoiceTable
        key={`${status}|${query}`}
        rows={filtered}
        selected={selected}
        onSelectedChange={onSelectedChange}
        onOpen={onOpen}
        canPay={canPay}
        emptyMessage={
          <>
            No unpaid invoices match these filters.{" "}
            <button type="button" onClick={clearFilters} className="underline underline-offset-4">
              Clear filters
            </button>
          </>
        }
      />

      {hasPayable ? (
        <div
          className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm"
          data-testid="pay-bar"
        >
          <span className="text-muted-foreground" data-testid="pay-bar-summary">
            {!canPay
              ? payDisabledReason
              : picked.count === 0
                ? `${dueIds.length} ${dueIds.length === 1 ? "invoice" : "invoices"} due · ${formatCents(dueCents)}`
                : `${picked.count} selected · ${formatCents(picked.totalCents)}`}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              disabled={!canPay}
              onClick={() => onPay(dueIds)}
              data-testid="pay-all-due"
            >
              Pay all due
            </Button>
            <Button
              disabled={!canPay || picked.count === 0}
              onClick={() => onPay(picked.ids)}
              data-testid="pay-selected"
            >
              {picked.count === 0 ? "Pay selected (0)" : `Pay selected (${picked.count}) · ${formatCents(picked.totalCents)}`}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
