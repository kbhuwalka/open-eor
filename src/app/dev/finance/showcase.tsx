"use client"

import { useMemo, useState } from "react"

import {
  FinanceDashboard,
  FinanceDashboardSkeleton,
} from "@/components/finance/finance-dashboard"
import { InvoiceStatusBadge, PaymentStatusBadge } from "@/components/finance/invoice-status-badge"
import { Separator } from "@/components/ui/separator"
import { OptionSelect } from "@/components/ui/option-select"
import {
  EMPTY_FINANCE_SUMMARY,
  isPayableRow,
  toFinanceSummary,
  type InvoiceDetail,
  type InvoiceDisplayStatus,
  type PayOutcome,
  type PaymentRow,
  type PaymentViewStatus,
} from "@/lib/finance-view"

import { PersonPaymentsTab } from "../../client/people/[caseId]/person-payments-tab"
import { buildFinanceFixtures } from "./fixtures"

const INVOICE_STATUSES: InvoiceDisplayStatus[] = ["open", "overdue", "processing", "paid", "void"]
const PAYMENT_STATUSES: PaymentViewStatus[] = ["initiated", "settled", "failed"]

const OUTCOMES = [
  { value: "succeed", label: "Payment succeeds" },
  { value: "unavailable", label: "Fails: not available" },
  { value: "processing", label: "Fails: already processing" },
]
const METHODS = [
  { value: "on-file", label: "ACH on file" },
  { value: "none", label: "No payment method" },
]

const fixtures = buildFinanceFixtures()

async function loadDetail(invoiceId: string): Promise<InvoiceDetail | null> {
  await new Promise((resolve) => setTimeout(resolve, 350))
  return fixtures.detailById[invoiceId] ?? null
}

const pdfHref = (invoiceId: string) => `/client/finance/invoices/${encodeURIComponent(invoiceId)}/pdf`

async function payNothing(): Promise<PayOutcome> {
  return { ok: false, message: "Paying is not available on this review page." }
}

function Section({ title, description, children, testId }: { title: string; description: string; children: React.ReactNode; testId: string }) {
  return (
    <section className="flex flex-col gap-4" data-testid={testId}>
      <div>
        <h3 className="text-lg font-medium">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  )
}

/** Populated, empty, loading and person-tab renderings of the finance components over domain-built fixtures. */
export function FinanceShowcase() {
  const [outcome, setOutcome] = useState("succeed")
  const [method, setMethod] = useState("on-file")
  const [rows, setRows] = useState(fixtures.rows)
  const [payments, setPayments] = useState<PaymentRow[]>(fixtures.paymentRows)

  const summary = useMemo(() => toFinanceSummary(rows, payments), [rows, payments])

  async function payInvoices(invoiceIds: string[]): Promise<PayOutcome> {
    await new Promise((resolve) => setTimeout(resolve, 400))
    if (outcome === "unavailable") {
      return { ok: false, code: "NOT_AVAILABLE", message: "Online payment is not available yet. Your invoices have not been changed." }
    }
    if (outcome === "processing") {
      return { ok: false, code: "ALREADY_PROCESSING", message: "One of those invoices already has a payment in progress." }
    }
    const paid = rows.filter((row) => invoiceIds.includes(row.id) && isPayableRow(row))
    const totalCents = paid.reduce((total, row) => total + row.totalCents, 0)
    const paymentId = `pay_dev_${payments.length + 1}`
    setRows((current) =>
      current.map((row) => (invoiceIds.includes(row.id) && isPayableRow(row) ? { ...row, displayStatus: "processing" } : row))
    )
    setPayments((current) => [
      {
        id: paymentId,
        initiatedAt: `${fixtures.today}T15:00:00.000Z`,
        settledAt: null,
        status: "initiated",
        amountCents: totalCents,
        methodLabel: fixtures.method.label,
        invoices: paid.map((row) => ({ id: row.id, number: row.number })),
        failureReason: null,
      },
      ...current,
    ])
    return { ok: true, paymentId, invoiceIds: paid.map((row) => row.id), totalCents }
  }

  const ava = fixtures.personInvoices("case_ava")
  const jordan = fixtures.personInvoices("case_jordan")

  return (
    <div className="flex flex-col gap-10">
      <Section
        testId="dev-populated"
        title="Populated"
        description="Real billing-domain invoices and payments for five people on 6 April 2026. Paying updates this copy only."
      >
        <div className="flex flex-wrap gap-3">
          <div className="w-52">
            <OptionSelect options={OUTCOMES} value={outcome} onValueChange={setOutcome} data-testid="dev-outcome" />
          </div>
          <div className="w-52">
            <OptionSelect options={METHODS} value={method} onValueChange={setMethod} data-testid="dev-method" />
          </div>
        </div>
        <FinanceDashboard
          summary={summary}
          invoices={rows}
          payments={payments}
          method={method === "on-file" ? fixtures.method : null}
          payInvoices={payInvoices}
          loadInvoiceDetail={loadDetail}
          pdfHref={pdfHref}
        />
      </Section>

      <Separator />

      <Section
        testId="dev-empty"
        title="Empty"
        description="Before the first invoice: a client whose people have not started yet."
      >
        <FinanceDashboard
          summary={EMPTY_FINANCE_SUMMARY}
          invoices={[]}
          payments={[]}
          method={null}
          payInvoices={async () => ({ ok: false, message: "Not available." })}
          loadInvoiceDetail={async () => null}
          pdfHref={pdfHref}
        />
      </Section>

      <Separator />

      <Section testId="dev-loading" title="Loading" description="The Suspense fallback while the server reads invoices.">
        <FinanceDashboardSkeleton />
      </Section>

      <Separator />

      <Section testId="dev-badges" title="Status badges" description="Invoice and payment statuses (ui-guidelines C24).">
        <div className="flex flex-wrap items-center gap-3">
          {INVOICE_STATUSES.map((status) => (
            <InvoiceStatusBadge key={status} status={status} />
          ))}
          <span aria-hidden className="mx-2 h-4 w-px bg-border" />
          {PAYMENT_STATUSES.map((status) => (
            <PaymentStatusBadge key={status} status={status} />
          ))}
        </div>
      </Section>

      <Separator />

      <Section
        testId="dev-person"
        title="Person Payments tab"
        description="The tab on a person profile: a started hire with history, a new hire with only a deposit, and no invoices."
      >
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
          {[ava, jordan, []].map((invoices, index) => (
            <PersonPaymentsTab
              key={index}
              invoices={invoices}
              loadDetail={loadDetail}
              pdfHref={pdfHref}
              method={fixtures.method}
              payInvoices={payNothing}
            />
          ))}
        </div>
      </Section>
    </div>
  )
}
