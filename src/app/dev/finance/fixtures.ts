/**
 * Review fixtures for `/dev/finance` and the finance component tests. Everything is built by the
 * real billing domain (`billingRun`, `initiatePayment`, `settlePayment`, `failPayment`) and then
 * mapped through the same view-model mappers production persistence uses, so a populated screen
 * here shows exactly what real data will. Never imported by a production read path.
 */

import {
  billingRun,
  failPayment,
  initiatePayment,
  settlePayment,
  type BenefitElectionState,
  type BillingHire,
  type Invoice,
  type Payment,
  type SavedPaymentMethod,
} from "@/domain/billing"
import { addDaysIso } from "@/domain/employment-term"
import {
  toFinanceSummary,
  toInvoiceDetail,
  toInvoiceRow,
  toPaymentRow,
  toSavedPaymentMethodView,
  type FinanceSummary,
  type InvoiceDetail,
  type InvoiceRow,
  type PaymentRow,
  type SavedPaymentMethodView,
} from "@/lib/finance-view"

export const FIXTURE_COMPANY_ID = "client_demo"
export const FIXTURE_TODAY = "2026-04-06"

/** The one saved account: its last four digits appear in the Pay dialog, the summary and failure text. */
const ACH: SavedPaymentMethod = {
  id: "pm_demo",
  type: "us_bank_account",
  label: "Northwind demo bank",
  last4: "1234",
  expMonth: null,
  expYear: null,
}

const CLIENT = { name: "Demo Robotics, Inc.", addressLines: ["1200 Market Street, Floor 9", "San Francisco, CA 94102"] }
const ISSUER = { name: "Northwind EOR, Inc.", addressLines: ["500 Harbor Way, Suite 400, San Francisco, CA 94105"] }

const PEOPLE: Record<string, { name: string; title: string; workState: string; caseId: string }> = {
  hire_ava: { name: "Ava Chen", title: "Staff Software Engineer", workState: "California", caseId: "case_ava" },
  hire_marcus: { name: "Marcus Reed", title: "Field Technician", workState: "Texas", caseId: "case_marcus" },
  hire_priya: { name: "Priya Nair", title: "Product Designer", workState: "New York", caseId: "case_priya" },
  hire_tomas: { name: "Tomás Ortega", title: "Data Analyst", workState: "Washington", caseId: "case_tomas" },
  hire_jordan: { name: "Jordan Blake", title: "Support Specialist", workState: "Florida", caseId: "case_jordan" },
}

const HIRES: BillingHire[] = [
  {
    hireId: "hire_ava",
    companyId: FIXTURE_COMPANY_ID,
    hiredOn: "2025-12-29",
    wageCents: 14_400_000,
    wageUnit: "annual",
    stateCode: "CA",
    markupPct: 15,
    package: "premium",
    rateSetId: "us-2026",
    startDate: "2026-01-12",
    termEndDate: null,
    lastWorkingDay: null,
  },
  {
    hireId: "hire_marcus",
    companyId: FIXTURE_COMPANY_ID,
    hiredOn: "2026-01-19",
    wageCents: 4_200,
    wageUnit: "hourly",
    stateCode: "TX",
    markupPct: 15,
    package: "standard",
    rateSetId: "us-2026",
    startDate: "2026-02-02",
    termEndDate: null,
    lastWorkingDay: null,
  },
  {
    hireId: "hire_priya",
    companyId: FIXTURE_COMPANY_ID,
    hiredOn: "2026-02-16",
    wageCents: 9_600_000,
    wageUnit: "annual",
    stateCode: "NY",
    markupPct: 12,
    package: "standard",
    rateSetId: "us-2026",
    startDate: "2026-02-23",
    termEndDate: null,
    lastWorkingDay: null,
  },
  {
    hireId: "hire_tomas",
    companyId: FIXTURE_COMPANY_ID,
    hiredOn: "2026-03-24",
    wageCents: 11_000_000,
    wageUnit: "annual",
    stateCode: "WA",
    markupPct: 15,
    package: "standard",
    rateSetId: "us-2026",
    startDate: "2026-04-13",
    termEndDate: null,
    lastWorkingDay: null,
  },
  {
    hireId: "hire_jordan",
    companyId: FIXTURE_COMPANY_ID,
    hiredOn: "2026-04-03",
    wageCents: 8_800_000,
    wageUnit: "annual",
    stateCode: "FL",
    markupPct: 15,
    package: "standard",
    rateSetId: "us-2026",
    startDate: "2026-04-20",
    termEndDate: null,
    lastWorkingDay: null,
  },
]

const ELECTIONS: Record<string, BenefitElectionState> = {
  hire_ava: { enrolled: true, healthTier: "employee", retirementDeferralPct: 6 },
  hire_marcus: { enrolled: true, healthTier: "employee_spouse", retirementDeferralPct: 4 },
}

export type FinanceFixtures = {
  today: string
  invoices: Invoice[]
  payments: Payment[]
  rows: InvoiceRow[]
  detailById: Record<string, InvoiceDetail>
  paymentRows: PaymentRow[]
  summary: FinanceSummary
  method: SavedPaymentMethodView
  personInvoices: (caseId: string) => InvoiceRow[]
}

function stamp(day: string, hour = 15): Date {
  return new Date(`${day}T${String(hour).padStart(2, "0")}:00:00Z`)
}

/**
 * A fixed week in March 2026 with every status: settled history, a failed attempt, one payment in
 * flight, overdue invoices, invoices still open, and a voided invoice.
 */
export function buildFinanceFixtures(): FinanceFixtures {
  const planned = billingRun({
    companies: [{ id: FIXTURE_COMPANY_ID }],
    hires: HIRES,
    elections: ELECTIONS,
    existingInvoices: [],
    today: FIXTURE_TODAY,
  })
  const voidId = planned.find((i) => i.hireId === "hire_marcus" && i.kind === "payroll")?.id
  const invoices: Invoice[] = planned.map((i) => (i.id === voidId ? { ...i, status: "void" as const } : i))

  const payments: Payment[] = []
  let sequence = 0
  function pay(ids: string[], day: string, outcome: "settle" | "fail" | "pending", settleDay?: string) {
    sequence += 1
    const started = initiatePayment({
      id: `pay_${String(sequence).padStart(3, "0")}`,
      invoices,
      payments,
      selectedIds: ids,
      method: ACH,
      now: stamp(day),
    })
    if (!started.ok) throw new Error(`fixture payment rejected: ${started.code} ${started.invoiceIds.join(",")}`)
    let payment = started.payment
    if (outcome === "settle") payment = settlePayment(payment, stamp(settleDay ?? day, 18))
    if (outcome === "fail") payment = failPayment(payment, `Insufficient funds in the account ending ${ACH.last4}.`, stamp(settleDay ?? day, 18))
    payments.push(payment)
  }

  const live = invoices.filter((i) => i.status === "open")
  const ids = (test: (invoice: Invoice) => boolean) => live.filter(test).map((i) => i.id)

  const settledDueDays = [...new Set(live.filter((i) => i.dueDate < "2026-03-20").map((i) => i.dueDate))].sort()
  for (const dueDay of settledDueDays) {
    pay(ids((i) => i.dueDate === dueDay), addDaysIso(dueDay, -1), "settle", addDaysIso(dueDay, 2))
  }

  const lateRound = live.filter((i) => i.kind === "payroll" && i.dueDate >= "2026-03-20" && i.dueDate < FIXTURE_TODAY)
  const failed = lateRound.find((i) => i.hireId === "hire_ava")
  if (failed) pay([failed.id], "2026-03-30", "fail", "2026-03-31")
  const inFlight = lateRound.filter((i) => i.hireId === "hire_priya" || i.hireId === "hire_marcus").map((i) => i.id)
  if (inFlight.length > 0) pay(inFlight, "2026-04-03", "pending")

  const rowFor = (invoice: Invoice): InvoiceRow => {
    const person = PEOPLE[invoice.hireId]
    return toInvoiceRow({ invoice, payments, today: FIXTURE_TODAY, personName: person.name, personTitle: person.title, caseId: person.caseId })
  }
  const rows = [...invoices]
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number))
    .map(rowFor)

  const detailById: Record<string, InvoiceDetail> = {}
  for (const invoice of invoices) {
    const person = PEOPLE[invoice.hireId]
    detailById[invoice.id] = toInvoiceDetail({
      invoice,
      payments,
      today: FIXTURE_TODAY,
      personName: person.name,
      personTitle: person.title,
      caseId: person.caseId,
      context: {
        issuer: ISSUER,
        client: CLIENT,
        person: { workState: person.workState },
        voidReason: invoice.status === "void" ? "order_cancelled" : null,
      },
    })
  }

  const paymentRows = [...payments]
    .sort((a, b) => b.initiatedAt.localeCompare(a.initiatedAt))
    .map((payment) => toPaymentRow(payment, invoices))

  return {
    today: FIXTURE_TODAY,
    invoices,
    payments,
    rows,
    detailById,
    paymentRows,
    summary: toFinanceSummary(rows, paymentRows),
    method: toSavedPaymentMethodView(ACH),
    personInvoices: (caseId) =>
      rows
        .filter((row) => row.caseId === caseId)
        .sort((a, b) => (a.kind === b.kind ? a.issueDate.localeCompare(b.issueDate) : a.kind === "deposit" ? -1 : 1)),
  }
}

export const PERSON_CASE_IDS = Object.values(PEOPLE).map((p) => p.caseId)
