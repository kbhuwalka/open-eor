"use client"

import { useMemo, useState } from "react"

import { Pagination } from "@/components/data-table/pagination"
import { SortableHead, type SortDirection } from "@/components/data-table/sortable-head"
import { InvoiceStatusBadge } from "@/components/finance/invoice-status-badge"
import { MoneyCell } from "@/components/finance/money-cell"
import { Checkbox } from "@/components/ui/checkbox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatIsoDay } from "@/lib/finance-format"
import { INVOICE_KIND_LABEL, isPayableRow, type InvoiceRow } from "@/lib/finance-view"
import { DEFAULT_PAGE_SIZE, showPagination, totalPagesFor } from "@/lib/pagination"

type SortKey = "number" | "person" | "due" | "amount"

const COMPARE: Record<SortKey, (a: InvoiceRow, b: InvoiceRow) => number> = {
  number: (a, b) => a.number.localeCompare(b.number),
  person: (a, b) => a.personName.localeCompare(b.personName),
  due: (a, b) => a.dueDate.localeCompare(b.dueDate),
  amount: (a, b) => a.totalCents - b.totalCents,
}

type Sort = { key: SortKey; dir: SortDirection } | null

/** none → asc → desc → none (ui-guidelines C6). */
function cycle(sort: Sort, key: SortKey): Sort {
  if (!sort || sort.key !== key) return { key, dir: "asc" }
  return sort.dir === "asc" ? { key, dir: "desc" } : null
}

export type InvoiceTableProps = {
  rows: readonly InvoiceRow[]
  selected: ReadonlySet<string>
  onSelectedChange: (next: Set<string>) => void
  /** Opens an invoice, with every listed id in the table's current order (all pages) for the drawer's Previous and Next. */
  onOpen: (row: InvoiceRow, orderedIds: string[]) => void
  /** False disables the row checkboxes (no payment method or online payment unavailable). */
  canPay: boolean
  /** Shown in the body when `rows` is empty (the caller knows whether filters are active). */
  emptyMessage: React.ReactNode
}

/**
 * Invoices as a data table: sortable columns, a checkbox on every payable row, whole-row click to
 * open the invoice, and the shared pagination bar once there are more than ten.
 */
export function InvoiceTable({ rows, selected, onSelectedChange, onOpen, canPay, emptyMessage }: InvoiceTableProps) {
  const [sort, setSort] = useState<Sort>(null)
  const [pageIndex, setPageIndex] = useState(1)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE)

  const sorted = useMemo(() => {
    if (!sort) return [...rows]
    const compare = COMPARE[sort.key]
    return [...rows].sort((a, b) => (sort.dir === "asc" ? compare(a, b) : compare(b, a)))
  }, [rows, sort])

  const totalPages = totalPagesFor(sorted.length, pageSize)
  const page = Math.min(pageIndex, totalPages)
  const visible = sorted.slice((page - 1) * pageSize, page * pageSize)
  const payableOnPage = visible.filter(isPayableRow)
  const selectedOnPage = payableOnPage.filter((row) => selected.has(row.id))
  const allSelected = payableOnPage.length > 0 && selectedOnPage.length === payableOnPage.length

  function toggle(id: string, checked: boolean) {
    const next = new Set(selected)
    if (checked) next.add(id)
    else next.delete(id)
    onSelectedChange(next)
  }

  function toggleAll(checked: boolean) {
    const next = new Set(selected)
    for (const row of payableOnPage) {
      if (checked) next.add(row.id)
      else next.delete(row.id)
    }
    onSelectedChange(next)
  }

  const head = (key: SortKey, label: string, className?: string) => (
    <SortableHead
      label={label}
      active={sort?.key === key}
      direction={sort?.dir ?? "asc"}
      onSort={() => setSort((current) => cycle(current, key))}
      className={className}
    />
  )

  return (
    <section aria-label="Invoices" className="overflow-hidden rounded-lg border border-border" data-testid="invoice-table">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-10 pl-4">
              {payableOnPage.length > 0 ? (
                <Checkbox
                  aria-label="Select all payable invoices on this page"
                  checked={allSelected}
                  indeterminate={selectedOnPage.length > 0 && !allSelected}
                  disabled={!canPay}
                  onCheckedChange={(checked) => toggleAll(checked)}
                  data-testid="select-all"
                />
              ) : null}
            </TableHead>
            {head("number", "Invoice")}
            {head("person", "Person")}
            {head("due", "Due")}
            {head("amount", "Amount", "text-right")}
            <TableHead className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={6} className="py-10 text-center whitespace-normal text-muted-foreground" data-testid="no-invoices">
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            visible.map((row) => (
              <TableRow
                key={row.id}
                className="relative"
                data-testid="invoice-row"
                data-invoice-id={row.id}
                data-status={row.displayStatus}
                data-state={selected.has(row.id) ? "selected" : undefined}
              >
                <TableCell className="w-10 pl-4">
                  {isPayableRow(row) ? (
                    <Checkbox
                      aria-label={`Select ${row.number}`}
                      checked={selected.has(row.id)}
                      disabled={!canPay}
                      onCheckedChange={(checked) => toggle(row.id, checked)}
                      className="relative z-10"
                      data-testid="invoice-select"
                    />
                  ) : null}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col items-start">
                    <button
                      type="button"
                      onClick={() => onOpen(row, sorted.map((item) => item.id))}
                      className="font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
                      data-testid="invoice-open"
                    >
                      {row.number}
                    </button>
                    <span className="text-xs text-muted-foreground">{INVOICE_KIND_LABEL[row.kind]}</span>
                  </div>
                </TableCell>
                <TableCell data-testid="invoice-person">
                  <div className="flex flex-col items-start">
                    <span>{row.personName}</span>
                    {row.personTitle ? <span className="text-xs text-muted-foreground">{row.personTitle}</span> : null}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground tabular-nums">{formatIsoDay(row.dueDate)}</TableCell>
                <TableCell>
                  <MoneyCell cents={row.totalCents} className="font-medium" />
                </TableCell>
                <TableCell>
                  <div className="flex flex-col items-start gap-0.5">
                    <InvoiceStatusBadge status={row.displayStatus} />
                    {row.paidDate ? (
                      <span className="text-xs text-muted-foreground tabular-nums">{formatIsoDay(row.paidDate)}</span>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {showPagination(sorted.length) ? (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={sorted.length}
          pageSize={pageSize}
          onPageChange={setPageIndex}
          onPageSizeChange={(size) => {
            setPageSize(size)
            setPageIndex(1)
          }}
        />
      ) : null}
    </section>
  )
}
