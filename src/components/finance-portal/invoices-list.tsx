"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Search, X } from "lucide-react"

import { Pagination } from "@/components/data-table/pagination"
import { SortableHead } from "@/components/data-table/sortable-head"
import { InvoiceStatusBadge } from "@/components/finance/invoice-status-badge"
import { MoneyCell } from "@/components/finance/money-cell"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Input } from "@/components/ui/input"
import { OptionSelect, type Option } from "@/components/ui/option-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatIsoDay, formatIsoRange } from "@/lib/finance-format"
import {
  cycleInvoiceSort,
  hasInvoiceFilters,
  invoicesSearch,
  withInvoicesChange,
  type FinanceInvoicesQuery,
} from "@/lib/finance-portal-query"
import { INVOICE_KIND_LABEL, INVOICE_STATUS_LABEL } from "@/lib/finance-view"
import { showPagination } from "@/lib/pagination"
import type { InvoiceSortKey, InvoiceStatusFilterValue, InvoiceListRow, Page } from "@/server/billing-queries"

const ALL = "all"
const SEARCH_DEBOUNCE_MS = 300

const STATUS_OPTIONS: Option[] = [
  { value: "all", label: "All statuses" },
  ...(["due", "overdue", "processing", "paid", "void"] as const).map((status) => ({
    value: status,
    label: status === "due" ? "Due (open and overdue)" : INVOICE_STATUS_LABEL[status],
  })),
]

const KIND_OPTIONS: Option[] = [
  { value: ALL, label: "All kinds" },
  { value: "payroll", label: INVOICE_KIND_LABEL.payroll },
  { value: "deposit", label: INVOICE_KIND_LABEL.deposit },
]

export type InvoicesListProps = {
  data: Page<InvoiceListRow>
  query: FinanceInvoicesQuery
  companies: readonly { id: string; name: string }[]
}

/**
 * Every invoice of every client: filters (status, client, kind, issue date range), search, sortable
 * columns and the pagination bar. All state is in the URL; each change navigates inside a
 * transition so the current rows stay (dimmed) until the next page arrives.
 */
export function InvoicesList({ data, query, companies }: InvoicesListProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function go(next: FinanceInvoicesQuery) {
    startTransition(() => router.replace(`/finance/invoices${invoicesSearch(next)}`, { scroll: false }))
  }

  const [text, setText] = useState(query.q)
  const lastPushed = useRef(query.q)
  useEffect(() => {
    if (query.q !== lastPushed.current) {
      lastPushed.current = query.q
      setText(query.q)
    }
  }, [query.q])
  useEffect(() => {
    const trimmed = text.trim()
    if (trimmed === lastPushed.current) return
    const timer = setTimeout(() => {
      lastPushed.current = trimmed
      go(withInvoicesChange(query, { q: trimmed }))
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // `go` and `query` only matter when the timer fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  const companyOptions: Option[] = [{ value: ALL, label: "All clients" }, ...companies.map((c) => ({ value: c.id, label: c.name }))]

  const sortHead = (key: InvoiceSortKey, label: string, className?: string) => (
    <SortableHead
      label={label}
      active={query.sort === key}
      direction={query.dir}
      onSort={() => go(withInvoicesChange(query, cycleInvoiceSort(query, key)))}
      className={className}
    />
  )

  function clearFilters() {
    lastPushed.current = ""
    setText("")
    go(withInvoicesChange(query, { q: "", status: "all", kind: null, company: null, from: null, to: null }))
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3" role="search" data-testid="invoice-filters">
        <div className="relative min-w-56 flex-[2_1_16rem]">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Search person or invoice number"
            aria-label="Search invoices"
            className="pl-9"
            data-testid="invoice-search"
          />
        </div>
        <div className="w-44">
          <OptionSelect
            options={STATUS_OPTIONS}
            value={query.status}
            onValueChange={(value) => go(withInvoicesChange(query, { status: value as InvoiceStatusFilterValue }))}
            data-testid="status-filter"
          />
        </div>
        <div className="w-36">
          <OptionSelect
            options={KIND_OPTIONS}
            value={query.kind ?? ALL}
            onValueChange={(value) => go(withInvoicesChange(query, { kind: value === ALL ? null : (value as "payroll" | "deposit") }))}
            data-testid="kind-filter"
          />
        </div>
        <div className="w-48">
          <OptionSelect
            options={companyOptions}
            value={query.company ?? ALL}
            onValueChange={(value) => go(withInvoicesChange(query, { company: value === ALL ? null : value }))}
            data-testid="company-filter"
          />
        </div>
        <div className="flex items-center gap-2" role="group" aria-label="Issue date range">
          <div className="w-40">
            <DatePicker
              value={query.from ?? ""}
              max={query.to ?? undefined}
              placeholder="Issued from"
              onValueChange={(value) => go(withInvoicesChange(query, { from: value || null }))}
              data-testid="from-filter"
            />
          </div>
          <span aria-hidden className="text-muted-foreground">
            –
          </span>
          <div className="w-40">
            <DatePicker
              value={query.to ?? ""}
              min={query.from ?? undefined}
              placeholder="Issued to"
              onValueChange={(value) => go(withInvoicesChange(query, { to: value || null }))}
              data-testid="to-filter"
            />
          </div>
        </div>
        {hasInvoiceFilters(query) ? (
          <Button variant="ghost" onClick={clearFilters} data-testid="clear-filters">
            <X data-icon="inline-start" />
            Clear
          </Button>
        ) : null}
      </div>

      <section
        aria-label="Invoices"
        aria-busy={pending}
        className="relative overflow-hidden rounded-lg border border-border"
        data-testid="invoices-table"
      >
        {pending ? <div aria-hidden className="absolute inset-x-0 top-0 z-10 h-0.5 animate-pulse bg-primary" data-testid="invoices-refetching" /> : null}
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {sortHead("number", "Invoice")}
              <TableHead className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Client</TableHead>
              {sortHead("person", "Person")}
              <TableHead className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Period</TableHead>
              {sortHead("issueDate", "Issued")}
              {sortHead("dueDate", "Due")}
              {sortHead("total", "Amount", "text-right")}
              {sortHead("status", "Status")}
            </TableRow>
          </TableHeader>
          <TableBody className={pending ? "opacity-60 transition-opacity" : "transition-opacity"}>
            {data.rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={8} className="py-10 text-center whitespace-normal text-muted-foreground" data-testid="no-invoices">
                  {hasInvoiceFilters(query) ? (
                    <>
                      No invoices match these filters.{" "}
                      <button type="button" onClick={clearFilters} className="underline underline-offset-4">
                        Clear filters
                      </button>
                    </>
                  ) : (
                    "No invoices yet. Run billing to issue the first ones."
                  )}
                </TableCell>
              </TableRow>
            ) : (
              data.rows.map((row) => (
                <TableRow key={row.id} className="relative" data-testid="invoice-row" data-invoice-id={row.id} data-status={row.displayStatus}>
                  <TableCell>
                    <div className="flex flex-col items-start">
                      <Link
                        href={`/finance/invoices/${encodeURIComponent(row.id)}`}
                        className="font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
                        data-testid="invoice-open"
                      >
                        {row.number}
                      </Link>
                      <span className="text-xs text-muted-foreground">{INVOICE_KIND_LABEL[row.kind]}</span>
                    </div>
                  </TableCell>
                  <TableCell>{row.companyName}</TableCell>
                  <TableCell>{row.personName}</TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {row.periodStart && row.periodEnd ? formatIsoRange(row.periodStart, row.periodEnd) : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">{formatIsoDay(row.issueDate)}</TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">{formatIsoDay(row.dueDate)}</TableCell>
                  <TableCell>
                    <MoneyCell cents={row.totalCents} className="font-medium" />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-0.5">
                      <InvoiceStatusBadge status={row.displayStatus} />
                      {row.paidDate ? <span className="text-xs text-muted-foreground tabular-nums">{formatIsoDay(row.paidDate)}</span> : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {showPagination(data.total) ? (
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            pageSize={data.pageSize}
            onPageChange={(page) => go(withInvoicesChange(query, { page }))}
            onPageSizeChange={(size) => go(withInvoicesChange(query, { size: size as FinanceInvoicesQuery["size"] }))}
          />
        ) : null}
      </section>
    </div>
  )
}
