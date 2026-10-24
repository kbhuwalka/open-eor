"use client"

import { cn } from "cn"

import { RowOpener } from "@/components/dense-list"
import { InvoiceStatusDot } from "@/components/finance/invoice-status-badge"
import { MoneyCell } from "@/components/finance/money-cell"
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatIsoDayInYear } from "@/lib/finance-format"
import { invoiceRowLabel, STAFF_INVOICE_STATUS_LABEL, type StaffInvoiceRow } from "@/lib/finance-staff-view"
import { daysLate } from "@/lib/receivables-view"

const HEAD = "text-xs font-medium tracking-wide text-muted-foreground uppercase"

/**
 * Client then Person fold away as the table's own width shrinks (a container query, so the
 * sidebar is accounted for); the drawer still has both.
 */
const PERSON_COLUMN = "hidden @xl:table-cell"
const CLIENT_COLUMN = "hidden @2xl:table-cell"

const settled = (row: StaffInvoiceRow) => row.displayStatus === "paid" || row.displayStatus === "void"

/**
 * `invoices`: the Invoices page, with the Status column. `receivables`: the Receivables table of
 * unpaid invoices, where every row is Unpaid or Overdue, so Days late ("17 days late", "in 6 days")
 * takes the Status column's place.
 */
export type InvoicesTableVariant = "invoices" | "receivables"

const VARIANT = {
  invoices: { caption: "Invoices", column: "Status", testId: "invoices-table" },
  receivables: { caption: "Unpaid invoices, oldest due first", column: "Days late", testId: "receivables-table" },
} as const satisfies Record<InvoicesTableVariant, { caption: string; column: string; testId: string }>

export type InvoicesTableProps = {
  rows: readonly StaffInvoiceRow[]
  /** `YYYY-MM-DD`: a due day prints its year only outside this one, and days late count to it. */
  today: string
  cursor: string | null
  hrefOf: (id: string) => string
  onOpen: (id: string) => void
  variant?: InvoicesTableVariant
}

/**
 * The Invoices records as a C6 table (ui-guidelines C30): one line per invoice with the number,
 * person, client, due day, status (or days late) and amount, in the server's fixed order and with
 * no sortable headers. The whole row opens the staff drawer: the number is a link to the row's
 * `?open=` URL stretched over the row, so a modified click opens a new tab.
 */
export function InvoicesTable({ rows, today, cursor, hrefOf, onOpen, variant = "invoices" }: InvoicesTableProps) {
  const { caption, column, testId } = VARIANT[variant]
  return (
    <div className="@container overflow-hidden rounded-lg border border-border">
      <Table className="table-fixed" data-testid={testId}>
        <TableCaption className="sr-only">{caption}</TableCaption>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead scope="col" className={cn(HEAD, "w-32")}>
              Invoice
            </TableHead>
            <TableHead scope="col" className={cn(HEAD, PERSON_COLUMN)}>
              Person
            </TableHead>
            <TableHead scope="col" className={cn(HEAD, CLIENT_COLUMN)}>
              Client
            </TableHead>
            <TableHead scope="col" className={cn(HEAD, "w-24")}>
              Due
            </TableHead>
            <TableHead scope="col" className={cn(HEAD, "w-28")}>
              {column}
            </TableHead>
            <TableHead scope="col" className={cn(HEAD, "w-28 text-right")}>
              Amount
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const late = variant === "receivables" ? daysLate(row.dueDate, today) : null
            return (
              <TableRow
                key={row.id}
                className="relative data-[cursor]:bg-muted"
                data-cursor={cursor === row.id || undefined}
                data-testid="invoice-row"
                data-invoice-id={row.id}
                data-status={row.displayStatus}
                data-kind={row.kind}
              >
                <TableCell>
                  <RowOpener
                    href={hrefOf(row.id)}
                    onOpen={() => onOpen(row.id)}
                    label={late ? invoiceRowLabel(row, late.label) : invoiceRowLabel(row)}
                    testId="invoice-open"
                  >
                    <span className="font-medium tabular-nums" data-testid="invoice-number">
                      {row.number}
                    </span>
                  </RowOpener>
                </TableCell>
                <TableCell className={cn(PERSON_COLUMN, "truncate")} title={row.personName || undefined} data-testid="invoice-person">
                  {row.personName || <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className={cn(CLIENT_COLUMN, "truncate text-muted-foreground")} title={row.companyName} data-testid="invoice-client">
                  {row.companyName}
                </TableCell>
                <TableCell className={cn("tabular-nums", settled(row) && "text-muted-foreground")} data-testid="invoice-due">
                  {formatIsoDayInYear(row.dueDate, today)}
                </TableCell>
                {late ? (
                  <TableCell
                    className={cn("tabular-nums", late.late ? "text-status-danger-foreground" : "text-muted-foreground")}
                    data-testid="invoice-days-late"
                    data-days={late.days}
                  >
                    {late.label}
                  </TableCell>
                ) : (
                  <TableCell data-testid="invoice-status">
                    <InvoiceStatusDot status={row.displayStatus} labels={STAFF_INVOICE_STATUS_LABEL} className="flex" />
                  </TableCell>
                )}
                <TableCell className="text-right" data-testid="invoice-amount">
                  <MoneyCell cents={row.totalCents} muted={row.displayStatus === "void"} />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
