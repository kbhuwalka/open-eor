"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { Pagination } from "@/components/data-table/pagination"
import { EmptyState } from "@/components/empty-state"
import { BulkSettleDialog, FailPaymentDialog, SettlePaymentDialog } from "@/components/finance-portal/payment-actions"
import { CoveredInvoices } from "@/components/finance/covered-invoices-dialog"
import { PaymentStatusBadge } from "@/components/finance/invoice-status-badge"
import { MoneyCell } from "@/components/finance/money-cell"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatIsoDay } from "@/lib/finance-format"
import { PAYMENT_TABS, paymentsSearch, type FinancePaymentsQuery, type PaymentTab } from "@/lib/finance-portal-query"
import { plural } from "@/lib/finance-portal-view"
import { itemsFromCovered, type CoveredInvoice } from "@/lib/covered-invoices"
import { formatCents } from "@/lib/format"
import { showPagination } from "@/lib/pagination"
import type { Page, PaymentListRow } from "@/server/billing-queries"

const TH = "text-xs font-medium tracking-wide text-muted-foreground uppercase"

const TAB_LABEL: Record<PaymentTab, string> = { initiated: "Initiated", settled: "Settled", failed: "Failed" }

const EMPTY: Record<PaymentTab, string> = {
  initiated: "Nothing to reconcile. Payments that clients start appear here until you settle or fail them.",
  settled: "No settled payments yet. Payments you settle are listed here.",
  failed: "No failed payments. Payments you mark as failed are listed here with their reason.",
}

export type PaymentsQueueProps = {
  query: FinancePaymentsQuery
  data: Page<PaymentListRow>
  counts: Record<PaymentTab, number>
  /** The invoices each payment of the page covers, by payment id (`coveredInvoicesByPayment`). */
  covered: Record<string, readonly CoveredInvoice[]>
}

const invoiceHref = (id: string) => `/finance/invoices/${encodeURIComponent(id)}`

/** The covered invoices with their person, period and share; the list's own refs (number only) if the read model had none. */
const coveredItems = (row: PaymentListRow, covered: readonly CoveredInvoice[] | undefined) =>
  covered?.length ? itemsFromCovered(covered, invoiceHref) : row.invoices.map((invoice) => ({ ...invoice, href: invoiceHref(invoice.id) }))

const outcomeAt = (row: PaymentListRow) => (row.status === "failed" ? row.failedAt : row.settledAt)

/**
 * The payments Finance reconciles: Initiated (waiting for settlement), Settled and Failed tabs, a
 * server-paginated table, per-row Settle / Mark failed and a bulk "Settle selected". All state that
 * survives a reload lives in the URL.
 */
export function PaymentsQueue({ query, data, counts, covered }: PaymentsQueueProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function go(next: FinancePaymentsQuery) {
    startTransition(() => router.replace(`/finance/payments${paymentsSearch(next)}`, { scroll: false }))
  }

  return (
    <div className="flex flex-col gap-4">
      <Tabs value={query.tab} onValueChange={(tab) => go({ tab: tab as PaymentTab, page: 1, size: query.size })}>
        <TabsList aria-label="Payment status" data-testid="payment-tabs">
          {PAYMENT_TABS.map((tab) => (
            <TabsTrigger key={tab} value={tab} data-testid={`tab-${tab}`}>
              {TAB_LABEL[tab]}
              <span className="text-xs font-normal text-muted-foreground tabular-nums" data-testid={`tab-count-${tab}`}>
                {counts[tab]}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {data.total === 0 ? (
        <div data-testid="no-payments">
          <EmptyState message={EMPTY[query.tab]} />
        </div>
      ) : (
        <PaymentsTable
          key={`${query.tab}:${data.page}:${data.pageSize}`}
          query={query}
          data={data}
          covered={covered}
          pending={pending}
          onNavigate={go}
        />
      )}
    </div>
  )
}

function PaymentsTable({
  query,
  data,
  covered,
  pending,
  onNavigate,
}: {
  query: FinancePaymentsQuery
  data: Page<PaymentListRow>
  covered: Record<string, readonly CoveredInvoice[]>
  pending: boolean
  onNavigate: (query: FinancePaymentsQuery) => void
}) {
  const router = useRouter()
  const waiting = query.tab === "initiated"
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [settling, setSettling] = useState<PaymentListRow | null>(null)
  const [failing, setFailing] = useState<PaymentListRow | null>(null)
  const [bulk, setBulk] = useState(false)

  const chosen = data.rows.filter((row) => selected.has(row.id))
  const chosenCents = chosen.reduce((total, row) => total + row.totalCents, 0)
  const allSelected = data.rows.length > 0 && chosen.length === data.rows.length

  function toggle(id: string, checked: boolean) {
    const next = new Set(selected)
    if (checked) next.add(id)
    else next.delete(id)
    setSelected(next)
  }

  const columns = waiting ? 8 : 7
  const refresh = () => {
    setSelected(new Set())
    router.refresh()
  }

  return (
    <>
      <section
        aria-label="Payments"
        aria-busy={pending}
        className="relative overflow-hidden rounded-lg border border-border"
        data-testid="payments-table"
      >
        {pending ? (
          <div aria-hidden className="absolute inset-x-0 top-0 z-10 h-0.5 animate-pulse bg-primary" />
        ) : null}
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {waiting ? (
                <TableHead className="w-10 pl-4">
                  <Checkbox
                    aria-label="Select all payments on this page"
                    checked={allSelected}
                    indeterminate={chosen.length > 0 && !allSelected}
                    onCheckedChange={(checked) => setSelected(checked ? new Set(data.rows.map((row) => row.id)) : new Set())}
                    data-testid="select-all"
                  />
                </TableHead>
              ) : null}
              <TableHead className={TH}>Payment</TableHead>
              <TableHead className={TH}>Client</TableHead>
              <TableHead className={TH}>Invoices</TableHead>
              <TableHead className={TH}>Method</TableHead>
              <TableHead className={TH}>Initiated</TableHead>
              <TableHead className={`${TH} text-right`}>Amount</TableHead>
              <TableHead className={`${TH} ${waiting ? "text-right" : ""}`}>{waiting ? "Actions" : "Outcome"}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className={pending ? "opacity-60 transition-opacity" : "transition-opacity"}>
            {data.rows.map((row) => (
              <TableRow
                key={row.id}
                data-testid="payment-row"
                data-payment-id={row.id}
                data-status={row.status}
                data-state={selected.has(row.id) ? "selected" : undefined}
              >
                {waiting ? (
                  <TableCell className="w-10 pl-4">
                    <Checkbox
                      aria-label={`Select payment ${row.id}`}
                      checked={selected.has(row.id)}
                      onCheckedChange={(checked) => toggle(row.id, checked)}
                      data-testid="payment-select"
                    />
                  </TableCell>
                ) : null}
                <TableCell>
                  <Link
                    href={`/finance/payments/${encodeURIComponent(row.id)}`}
                    className="rounded-sm font-mono text-xs font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                    data-testid="payment-open"
                  >
                    {row.id}
                  </Link>
                </TableCell>
                <TableCell>{row.companyName}</TableCell>
                <TableCell className="whitespace-normal">
                  <CoveredInvoices
                    items={coveredItems(row, covered[row.id])}
                    payment={{ amountCents: row.totalCents, initiatedAt: row.initiatedAt, status: row.status === "succeeded" ? "settled" : row.status }}
                    context={row.companyName}
                  />
                </TableCell>
                <TableCell className="text-muted-foreground">{row.methodLabel}</TableCell>
                <TableCell className="text-muted-foreground tabular-nums">{formatIsoDay(row.initiatedAt)}</TableCell>
                <TableCell>
                  <MoneyCell cents={row.totalCents} className="font-medium" />
                </TableCell>
                <TableCell className={waiting ? "text-right" : "whitespace-normal"}>
                  {waiting ? (
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => setSettling(row)} data-testid="settle-row">
                        Settle
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setFailing(row)}
                        aria-label={`Mark payment ${row.id} as failed`}
                        data-testid="fail-row"
                      >
                        Mark failed
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-start gap-0.5">
                      <PaymentStatusBadge status={row.status === "succeeded" ? "settled" : row.status} />
                      {outcomeAt(row) ? (
                        <span className="text-xs text-muted-foreground tabular-nums">{formatIsoDay(outcomeAt(row) as string)}</span>
                      ) : null}
                      {row.status === "failed" && row.failureReason ? (
                        <span className="text-xs text-muted-foreground">{row.failureReason}</span>
                      ) : null}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {data.rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns} className="py-10 text-center text-muted-foreground">
                  No payments on this page.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
        {showPagination(data.total) ? (
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            pageSize={data.pageSize}
            onPageChange={(page) => onNavigate({ ...query, page })}
            onPageSizeChange={(size) => onNavigate({ ...query, page: 1, size: size as FinancePaymentsQuery["size"] })}
          />
        ) : null}
      </section>

      {waiting && chosen.length > 0 ? (
        <div
          className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3"
          data-testid="settle-bar"
        >
          <span className="text-sm" aria-live="polite">
            <span className="font-medium">{plural(chosen.length, "payment")} selected</span>
            <span className="text-muted-foreground"> · </span>
            <span className="tabular-nums" data-testid="selected-total">
              {formatCents(chosenCents)}
            </span>
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
            <Button onClick={() => setBulk(true)} data-testid="settle-selected">
              Settle selected ({chosen.length})
            </Button>
          </div>
        </div>
      ) : null}

      <SettlePaymentDialog payment={settling} onOpenChange={(open) => !open && setSettling(null)} onDone={refresh} />
      <FailPaymentDialog payment={failing} onOpenChange={(open) => !open && setFailing(null)} onDone={refresh} />
      <BulkSettleDialog payments={chosen} open={bulk} onOpenChange={setBulk} onDone={refresh} />
    </>
  )
}
