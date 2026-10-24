"use client"

import { useState } from "react"

import { FinanceSummaryTiles, FinanceSummarySkeleton } from "@/components/finance/finance-summary-tiles"
import { InvoiceDrawer } from "@/components/finance/invoice-drawer"
import { InvoicesPanel } from "@/components/finance/invoices-panel"
import { PayDialog } from "@/components/finance/pay-dialog"
import { PaymentsTable } from "@/components/finance/payments-table"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
  /** Link to the full invoice page, shown in the drawer. Omitted on pages without one (`/dev/finance`). */
  invoiceHref?: (invoiceId: string) => string
}

/**
 * The Finance page body: summary, the Invoices and Payments tabs, the invoice drawer and the
 * Pay dialog. Data and the two server round trips come in as props, so the real page and the
 * `/dev/finance` review page render the same component.
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
}: FinanceDashboardProps) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [openRow, setOpenRow] = useState<InvoiceRow | null>(null)
  const [payIds, setPayIds] = useState<string[] | null>(null)
  const [tab, setTab] = useState("invoices")
  const [status, setStatus] = useState<InvoiceStatusFilter>("all")

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

      <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
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
            onOpen={setOpenRow}
            onPay={setPayIds}
            canPay={canPay}
            payDisabledReason={payDisabledReason}
            status={status}
            onStatusChange={setStatus}
          />
        </TabsContent>
        <TabsContent value="payments" data-testid="tabpanel-payments">
          <PaymentsTable payments={payments} invoiceHref={invoiceHref} invoices={invoices} />
        </TabsContent>
      </Tabs>

      <InvoiceDrawer
        row={openRow}
        loadDetail={loadInvoiceDetail}
        pdfHref={pdfHref}
        invoiceHref={invoiceHref}
        canPay={canPay}
        onPay={(row) => {
          setOpenRow(null)
          setPayIds([row.id])
        }}
        onClose={() => setOpenRow(null)}
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
