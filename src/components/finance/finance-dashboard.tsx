"use client"

import { useState } from "react"

import { FinanceDrawer } from "@/components/finance/finance-drawer"
import { FinanceSummaryTiles, FinanceSummarySkeleton } from "@/components/finance/finance-summary-tiles"
import { InvoicesPanel } from "@/components/finance/invoices-panel"
import { PayDialog } from "@/components/finance/pay-dialog"
import { PaymentsList } from "@/components/finance/payments-list"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  invoiceView,
  linkedInvoiceView,
  paymentView,
  tabForInvoice,
  type FinanceDrawerView,
  type FinanceTab,
} from "@/lib/finance-drawer"
import type {
  FinanceSummary,
  InvoiceStatusFilter,
  InvoiceDetail,
  InvoiceRow,
  PayOutcome,
  PaymentRow,
  SavedPaymentMethodView,
} from "@/lib/finance-view"

export type FinanceDashboardProps = {
  summary: FinanceSummary
  invoices: readonly InvoiceRow[]
  payments: readonly PaymentRow[]
  method: SavedPaymentMethodView | null
  payInvoices: (invoiceIds: string[]) => Promise<PayOutcome>
  /** Must be referentially stable (a module-level function or a server action). */
  loadInvoiceDetail: (invoiceId: string) => Promise<InvoiceDetail | null>
  pdfHref: (invoiceId: string) => string
  /**
   * The URL that opens an invoice in this page's drawer (`invoiceDrawerHref`), so a covered invoice
   * in the payment drawer is a real link (cmd-click opens a new tab). Omitted on `/dev/finance`.
   */
  invoiceHref?: (invoiceId: string) => string
  /** `?open=` of a deep link: opens that invoice in the drawer when it is one of `invoices`. */
  linkedInvoiceId?: string | null
  /** Called when the drawer a deep link opened is closed, to drop `?open=` from the URL. */
  onLinkClosed?: () => void
}

/**
 * The Finance page body: summary, the Invoices and Payments tabs, the one drawer (an invoice or a
 * payment) and the Pay dialog. Data and the two server round trips come in as props, so the real
 * page and the `/dev/finance` review page render the same component.
 *
 * A deep link (`linkedInvoiceId`) opens any of the client's invoices on load, with the tab that
 * lists it behind the drawer; a new link while the page is open opens that one (the `seenLink`
 * check, as the specialist Home does with `?open=`).
 */
export function FinanceDashboard({
  summary,
  invoices,
  payments,
  method,
  payInvoices,
  loadInvoiceDetail,
  pdfHref,
  invoiceHref,
  linkedInvoiceId = null,
  onLinkClosed,
}: FinanceDashboardProps) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [view, setView] = useState<FinanceDrawerView | null>(() => linkedInvoiceView(linkedInvoiceId, invoices))
  const [payIds, setPayIds] = useState<string[] | null>(null)
  const [tab, setTab] = useState<FinanceTab>(() => (linkedInvoiceId ? tabForInvoice(linkedInvoiceId, invoices, payments) : "invoices"))
  const [status, setStatus] = useState<InvoiceStatusFilter>("all")
  const [seenLink, setSeenLink] = useState(linkedInvoiceId)
  if (linkedInvoiceId !== seenLink) {
    setSeenLink(linkedInvoiceId)
    const linked = linkedInvoiceView(linkedInvoiceId, invoices)
    if (linked) {
      setView(linked)
      setTab(tabForInvoice(linked.invoiceId, invoices, payments))
    }
  }

  function changeView(next: FinanceDrawerView | null) {
    setView(next)
    if (next === null && linkedInvoiceId) onLinkClosed?.()
  }

  const canPay = method !== null
  const payDisabledReason = "Online payment needs a payment method on file. Contact your Northwind account manager."
  const payRows = payIds ? invoices.filter((row) => payIds.includes(row.id)) : []

  function viewOverdue() {
    setSelected(new Set())
    setStatus("overdue")
    setTab("invoices")
  }

  return (
    <div className="flex flex-col gap-6">
      <FinanceSummaryTiles summary={summary} onViewOverdue={viewOverdue} />

      <Tabs value={tab} onValueChange={(value) => setTab(value === "payments" ? "payments" : "invoices")}>
        <TabsList aria-label="Finance sections">
          <TabsTrigger value="invoices" data-testid="tab-invoices">
            Invoices
          </TabsTrigger>
          <TabsTrigger value="payments" data-testid="tab-payments">
            Payments
          </TabsTrigger>
        </TabsList>
        <TabsContent value="invoices" data-testid="tabpanel-invoices">
          <InvoicesPanel
            invoices={invoices}
            selected={selected}
            onSelectedChange={setSelected}
            onOpen={(row, orderedIds) => changeView(invoiceView(row.id, orderedIds))}
            onPay={setPayIds}
            canPay={canPay}
            payDisabledReason={payDisabledReason}
            status={status}
            onStatusChange={setStatus}
          />
        </TabsContent>
        <TabsContent value="payments" data-testid="tabpanel-payments">
          <PaymentsList
            payments={payments}
            invoices={invoices}
            onOpen={(paymentId, orderedIds) => changeView(paymentView(paymentId, orderedIds))}
            keyboard={view === null && payIds === null}
          />
        </TabsContent>
      </Tabs>

      <FinanceDrawer
        view={view}
        onViewChange={changeView}
        invoices={invoices}
        payments={payments}
        loadInvoiceDetail={loadInvoiceDetail}
        pdfHref={pdfHref}
        invoiceHref={invoiceHref}
        canPay={canPay}
        onPay={(row) => {
          changeView(null)
          setPayIds([row.id])
        }}
      />

      <PayDialog
        open={payIds !== null}
        onOpenChange={(open) => !open && setPayIds(null)}
        invoices={payRows}
        method={method}
        onConfirm={payInvoices}
        onPaid={() => setSelected(new Set())}
      />
    </div>
  )
}

/** Same layout as the dashboard, for the Suspense fallback (L2a). */
export function FinanceDashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy data-testid="finance-skeleton">
      <FinanceSummarySkeleton />
      <div className="flex flex-col gap-6">
        <div className="flex gap-6 border-b border-border pb-3">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-16" />
        </div>
        <div className="flex gap-3">
          <Skeleton className="h-10 flex-1" />
          <Skeleton className="h-10 w-44" />
        </div>
        <div className="overflow-hidden rounded-lg border border-border">
          <Skeleton className="h-10 w-full rounded-none" />
          <div className="flex flex-col gap-4 p-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex gap-6">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-5 w-20" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
