import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { replace, refresh, push, settlePaymentsAction, settlePaymentAction, failPaymentAction, markDepositReceivedAction, markDepositNotReceivedAction } =
  vi.hoisted(() => ({
    replace: vi.fn(),
    refresh: vi.fn(),
    push: vi.fn(),
    settlePaymentsAction: vi.fn(),
    settlePaymentAction: vi.fn(),
    failPaymentAction: vi.fn(),
    markDepositReceivedAction: vi.fn(),
    markDepositNotReceivedAction: vi.fn(),
  }))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh, push }),
  usePathname: () => "/finance/payments",
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("@/app/finance/actions", () => ({
  settlePaymentsAction,
  settlePaymentAction,
  failPaymentAction,
  markDepositReceivedAction,
  markDepositNotReceivedAction,
  voidInvoiceAction: vi.fn(),
  runBillingAction: vi.fn(),
}))

import type { CoveredInvoice } from "@/lib/covered-invoices"
import type { InvoiceListRow, PaymentListRow, Receivables } from "@/server/billing-queries"
import type { BillingPreview } from "@/server/billing-preview"
import type { FinanceOverview, PendingDeposit } from "@/server/finance-portal-queries"
import type { ActionResult } from "@/server/action-result"

import { ActionDialog } from "../action-dialog"
import { BillingRunPanel, describeRun } from "../billing-run-panel"
import { DepositsList, depositBadgeStatus } from "../deposits-list"
import { InvoiceHistory } from "../invoice-history"
import { FinanceOverviewTilesView } from "../overview-tiles"
import { PaymentsQueue } from "../payments-queue"
import { ClientOpenInvoices, overdueOf, ReceivablesReport } from "../receivables-report"

afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

const payment = (n: number, patch: Partial<PaymentListRow> = {}): PaymentListRow => ({
  id: `pay_${n}`,
  companyId: "client_1",
  companyName: "Acme Robotics",
  status: "initiated",
  totalCents: 100_000 * n,
  methodLabel: "ACH ••4821",
  initiatedAt: "2026-10-2" + n + "T10:00:00.000Z",
  settledAt: null,
  failedAt: null,
  failureReason: null,
  invoices: [{ id: `payroll:h:${n}`, number: `INV-2026-000${n}` }],
  ...patch,
})

const coveredOf = (rows: PaymentListRow[]): Record<string, CoveredInvoice[]> =>
  Object.fromEntries(
    rows.map((row) => [
      row.id,
      row.invoices.map((invoice, index) => ({
        id: invoice.id,
        number: invoice.number,
        personName: `Person ${index + 1}`,
        personTitle: "Engineer",
        kind: "payroll" as const,
        periodStart: "2026-10-01",
        periodEnd: "2026-10-31",
        daysEmployed: null,
        periodDays: null,
        amountCents: Math.round(row.totalCents / row.invoices.length),
      })),
    ]),
  )

const page = <T,>(rows: T[]) => ({ rows, total: rows.length, page: 1, pageSize: 10, totalPages: 1 })
const queue = { initiated: 3, settled: 1, failed: 0 }

describe("ActionDialog", () => {
  const renderDialog = (onConfirm: () => Promise<ActionResult<{ id: string }>>, onDone = vi.fn()) => {
    const onOpenChange = vi.fn()
    render(
      <ActionDialog
        open
        onOpenChange={onOpenChange}
        title="Void it?"
        description="Cannot be undone."
        confirmLabel="Void"
        pendingLabel="Voiding…"
        tone="danger"
        reason={{ label: "Reason", placeholder: "Why" }}
        onConfirm={onConfirm}
        onDone={onDone}
        testId="dlg"
      />,
    )
    return { onOpenChange, onDone }
  }

  it("will not confirm without a reason and does not call the action", async () => {
    const onConfirm = vi.fn()
    renderDialog(onConfirm)
    await userEvent.click(screen.getByTestId("action-confirm"))
    expect(screen.getByTestId("reason-error")).toHaveTextContent("A reason is required.")
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it("sends the trimmed reason, then reports done and closes", async () => {
    const onConfirm = vi.fn().mockResolvedValue({ ok: true, data: { id: "x" } })
    const { onDone, onOpenChange } = renderDialog(onConfirm)
    await userEvent.type(screen.getByTestId("reason-input"), "  Billed in error ")
    await userEvent.click(screen.getByTestId("action-confirm"))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ id: "x" }))
    expect(onConfirm).toHaveBeenCalledWith("Billed in error")
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("shows the server's refusal inside the dialog and stays open", async () => {
    const onConfirm = vi.fn().mockResolvedValue({ ok: false, code: "ILLEGAL_TRANSITION", message: "That invoice is already void." })
    const { onDone, onOpenChange } = renderDialog(onConfirm)
    await userEvent.type(screen.getByTestId("reason-input"), "again")
    await userEvent.click(screen.getByTestId("action-confirm"))
    expect(await screen.findByTestId("action-error")).toHaveTextContent("That invoice is already void.")
    expect(onDone).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})

describe("PaymentsQueue", () => {
  const rows = [payment(1), payment(2), payment(3)]

  it("lists the initiated payments with tab counts and row actions", () => {
    render(<PaymentsQueue query={{ tab: "initiated", page: 1, size: 10 }} data={page(rows)} covered={coveredOf(rows)} counts={queue} />)
    expect(screen.getAllByTestId("payment-row")).toHaveLength(3)
    expect(screen.getByTestId("tab-count-initiated")).toHaveTextContent("3")
    expect(screen.getAllByTestId("settle-row")).toHaveLength(3)
    expect(screen.getByRole("link", { name: "pay_1" })).toHaveAttribute("href", "/finance/payments/pay_1")
    expect(screen.getAllByTestId("payment-invoice")[0]).toHaveAttribute("href", "/finance/invoices/payroll%3Ah%3A1")
  })

  it("a payment covering several invoices shows one button that opens the shared dialog with each person and share", async () => {
    const multi = payment(1, {
      totalCents: 300_000,
      invoices: [
        { id: "payroll:h:1", number: "INV-2026-0001" },
        { id: "payroll:h:2", number: "INV-2026-0002" },
        { id: "payroll:h:3", number: "INV-2026-0003" },
      ],
    })
    render(<PaymentsQueue query={{ tab: "initiated", page: 1, size: 10 }} data={page([multi])} covered={coveredOf([multi])} counts={queue} />)
    expect(screen.getByTestId("payment-invoices-trigger")).toHaveTextContent("3 invoices")
    expect(screen.queryByTestId("payment-invoice")).toBeNull()
    await userEvent.click(screen.getByTestId("payment-invoices-trigger"))
    const dialog = await screen.findByRole("dialog")
    expect(dialog).toHaveTextContent("Acme Robotics. Covers 3 invoices.")
    const rows = within(dialog).getAllByTestId("payment-invoice")
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveAttribute("href", "/finance/invoices/payroll%3Ah%3A1")
    expect(rows[0]).toHaveAttribute("target", "_blank")
    expect(rows[2]).toHaveTextContent("Person 3")
  })

  it("selecting rows shows the total and settles them in one go", async () => {
    settlePaymentsAction.mockResolvedValue({ ok: true, data: { settled: ["pay_1", "pay_3"], failed: [] } })
    render(<PaymentsQueue query={{ tab: "initiated", page: 1, size: 10 }} data={page(rows)} covered={coveredOf(rows)} counts={queue} />)
    expect(screen.queryByTestId("settle-bar")).toBeNull()
    const [first, , third] = screen.getAllByTestId("payment-select")
    await userEvent.click(first)
    await userEvent.click(third)
    expect(screen.getByTestId("settle-bar")).toHaveTextContent("2 payments selected")
    expect(screen.getByTestId("selected-total")).toHaveTextContent("$4,000.00")
    await userEvent.click(screen.getByTestId("settle-selected"))
    await userEvent.click(await screen.findByTestId("action-confirm"))
    await waitFor(() => expect(settlePaymentsAction).toHaveBeenCalledWith(["pay_1", "pay_3"]))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it("select all picks every row on the page", async () => {
    render(<PaymentsQueue query={{ tab: "initiated", page: 1, size: 10 }} data={page(rows)} covered={coveredOf(rows)} counts={queue} />)
    await userEvent.click(screen.getByTestId("select-all"))
    expect(screen.getByTestId("settle-bar")).toHaveTextContent("3 payments selected")
  })

  it("Mark failed needs a reason before the action runs", async () => {
    failPaymentAction.mockResolvedValue({ ok: true, data: { paymentId: "pay_2" } })
    render(<PaymentsQueue query={{ tab: "initiated", page: 1, size: 10 }} data={page(rows)} covered={coveredOf(rows)} counts={queue} />)
    await userEvent.click(screen.getAllByTestId("fail-row")[1])
    await userEvent.click(await screen.findByTestId("action-confirm"))
    expect(failPaymentAction).not.toHaveBeenCalled()
    await userEvent.type(screen.getByTestId("reason-input"), "Bank returned the ACH")
    await userEvent.click(screen.getByTestId("action-confirm"))
    await waitFor(() => expect(failPaymentAction).toHaveBeenCalledWith("pay_2", "Bank returned the ACH"))
  })

  it("the settled tab has no selection or actions and shows the outcome", () => {
    render(
      <PaymentsQueue
        query={{ tab: "settled", page: 1, size: 10 }}
        data={page([payment(1, { status: "succeeded", settledAt: "2026-10-22T10:00:00.000Z" })])}
        covered={{}}
        counts={queue}
      />,
    )
    expect(screen.queryByTestId("select-all")).toBeNull()
    expect(screen.queryByTestId("settle-row")).toBeNull()
    expect(screen.getByText("Settled", { selector: "[data-slot=badge], span" })).toBeTruthy()
  })

  it("a failed payment shows its reason", () => {
    render(
      <PaymentsQueue
        query={{ tab: "failed", page: 1, size: 10 }}
        data={page([payment(1, { status: "failed", failureReason: "Bank returned the ACH", settledAt: "2026-10-22T10:00:00.000Z" })])}
        covered={{}}
        counts={queue}
      />,
    )
    expect(screen.getByText("Bank returned the ACH")).toBeInTheDocument()
  })

  it("an empty tab shows the empty state, and switching tabs goes through the URL", async () => {
    render(<PaymentsQueue query={{ tab: "initiated", page: 1, size: 10 }} data={page([])} covered={{}} counts={{ initiated: 0, settled: 1, failed: 0 }} />)
    expect(screen.getByTestId("no-payments")).toHaveTextContent("Nothing to reconcile")
    await userEvent.click(screen.getByTestId("tab-failed"))
    expect(replace).toHaveBeenCalledWith("/finance/payments?tab=failed", { scroll: false })
  })
})

describe("DepositsList", () => {
  const deposit = (patch: Partial<PendingDeposit> = {}): PendingDeposit => ({
    caseId: "case_1",
    hireId: "hire_1",
    personName: "Noah Carter",
    companyId: "client_1",
    companyName: "Acme Robotics",
    startDate: "2026-11-02",
    invoiceId: "deposit:hire_1",
    invoiceNumber: "INV-2026-0062",
    amountCents: 678_284,
    state: "processing",
    issueDate: "2026-10-21",
    dueDate: "2026-10-28",
    overdue: false,
    paymentId: "pay_1",
    paymentInvoiceCount: 1,
    taskId: "task_1",
    taskKey: "confirm_deposit",
    ...patch,
  })

  it("maps depositState to the badge", () => {
    expect(depositBadgeStatus({ state: "processing", overdue: false })).toBe("processing")
    expect(depositBadgeStatus({ state: "open", overdue: false })).toBe("open")
    expect(depositBadgeStatus({ state: "open", overdue: true })).toBe("overdue")
  })

  it("shows the empty state when nothing waits", () => {
    render(<DepositsList deposits={[]} today="2026-10-24" />)
    expect(screen.getByTestId("no-deposits")).toBeInTheDocument()
  })

  it("confirms a deposit after a dialog and refreshes", async () => {
    markDepositReceivedAction.mockResolvedValue({ ok: true, data: { caseId: "case_1" } })
    render(<DepositsList deposits={[deposit()]} today="2026-10-24" />)
    expect(screen.getByRole("link", { name: "Noah Carter" })).toHaveAttribute("href", "/finance/tasks/task_1")
    await userEvent.click(screen.getByTestId("confirm-deposit"))
    const dialog = await screen.findByTestId("confirm-deposit-dialog")
    await userEvent.click(within(dialog).getByTestId("action-confirm"))
    await waitFor(() => expect(markDepositReceivedAction).toHaveBeenCalledWith("case_1"))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it("offers Confirm received and Not received while the client's payment is in flight", () => {
    render(<DepositsList deposits={[deposit()]} today="2026-10-24" />)
    const row = screen.getByTestId("deposit-row")
    expect(within(row).getAllByRole("button").map((button) => button.textContent)).toEqual(["Confirm received", "Not received"])
    expect(within(row).getByText("Client paid; waiting for you to confirm")).toBeInTheDocument()
  })

  it("shows Awaiting payment with only Confirm received when the client has not paid: nothing to fail", () => {
    render(<DepositsList deposits={[deposit({ state: "open", paymentId: null, paymentInvoiceCount: 0, taskKey: "pay_deposit" })]} today="2026-10-24" />)
    const row = screen.getByTestId("deposit-row")
    expect(within(row).getByText("Awaiting payment")).toBeInTheDocument()
    expect(within(row).getAllByRole("button").map((button) => button.textContent)).toEqual(["Confirm received"])
    expect(screen.queryByTestId("not-received-deposit")).toBeNull()
  })

  it("Not received asks for an optional reason, then fails the payment and refreshes", async () => {
    markDepositNotReceivedAction.mockResolvedValue({ ok: true, data: { caseId: "case_1", paymentId: "pay_1" } })
    render(<DepositsList deposits={[deposit()]} today="2026-10-24" />)
    await userEvent.click(screen.getByTestId("not-received-deposit"))
    const dialog = await screen.findByTestId("not-received-dialog")
    expect(within(dialog).getByText("Reason (optional)")).toBeInTheDocument()
    await userEvent.click(within(dialog).getByTestId("action-confirm"))
    await waitFor(() => expect(markDepositNotReceivedAction).toHaveBeenCalledWith("case_1", ""))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(markDepositReceivedAction).not.toHaveBeenCalled()

    await userEvent.click(screen.getByTestId("not-received-deposit"))
    const again = await screen.findByTestId("not-received-dialog")
    await userEvent.type(within(again).getByTestId("reason-input"), "ACH debit returned")
    await userEvent.click(within(again).getByTestId("action-confirm"))
    await waitFor(() => expect(markDepositNotReceivedAction).toHaveBeenLastCalledWith("case_1", "ACH debit returned"))
  })

  it("shows the shared pagination bar only above ten deposits", () => {
    const paging = (total: number) => ({ page: 1, pageSize: 10, total, totalPages: Math.ceil(total / 10) })
    const { unmount } = render(<DepositsList deposits={[deposit()]} paging={paging(10)} today="2026-10-24" />)
    expect(screen.queryByTestId("page-range")).toBeNull()
    unmount()
    render(<DepositsList deposits={[deposit()]} paging={paging(11)} today="2026-10-24" />)
    expect(screen.getByTestId("page-range")).toBeInTheDocument()
  })

  it("Not received warns when the payment also covers other invoices, and shows a refusal in the dialog", async () => {
    markDepositNotReceivedAction.mockResolvedValue({ ok: false, code: "ILLEGAL_TRANSITION", message: "This order has no deposit payment in flight." })
    render(<DepositsList deposits={[deposit({ paymentInvoiceCount: 3 })]} today="2026-10-24" />)
    await userEvent.click(screen.getByTestId("not-received-deposit"))
    const dialog = await screen.findByTestId("not-received-dialog")
    expect(dialog).toHaveTextContent("also covers 2 other invoices")
    await userEvent.click(within(dialog).getByTestId("action-confirm"))
    expect(await within(dialog).findByTestId("action-error")).toHaveTextContent("This order has no deposit payment in flight.")
  })

  it("offers no action when no deposit step is ready", () => {
    render(<DepositsList deposits={[deposit({ taskId: null, taskKey: null, state: "open", paymentId: null, paymentInvoiceCount: 0 })]} today="2026-10-24" />)
    expect(screen.queryByTestId("confirm-deposit")).toBeNull()
    expect(screen.queryByTestId("not-received-deposit")).toBeNull()
    expect(screen.queryByTestId("deposit-task-link")).toBeNull()
    expect(screen.getByTestId("deposit-no-action")).toBeInTheDocument()
  })
})

describe("FinanceOverviewTilesView", () => {
  const overview = (patch: Partial<FinanceOverview> = {}): FinanceOverview => ({
    today: "2026-10-24",
    paymentsToReconcile: { count: 5, cents: 9_000_000 },
    depositsAwaiting: { count: 2, cents: 1_500_000 },
    overdueReceivables: { count: 36, cents: 21_781_991 },
    billing: { toIssueCount: 0, toIssueCents: 0, nextIssueDate: "2026-10-30" },
    ...patch,
  })

  it("shows the four figures, each linking to its page", () => {
    render(<FinanceOverviewTilesView overview={overview()} />)
    expect(screen.getByTestId("tile-reconcile")).toHaveAttribute("href", "/finance/payments")
    expect(screen.getByTestId("tile-reconcile-value")).toHaveTextContent("$90,000.00")
    expect(screen.getByTestId("finance-overview")).not.toHaveTextContent(/awaiting settlement|past due|to confirm/i)
    expect(screen.getByTestId("tile-deposits")).toHaveAttribute("href", "/finance/deposits")
    expect(screen.getByTestId("tile-overdue-value")).toHaveTextContent("$217,819.91")
    expect(screen.getByTestId("tile-billing")).toHaveAttribute("href", "/finance/billing")
    expect(screen.getByTestId("tile-billing-value")).toHaveTextContent("Oct 30, 2026")
  })

  it("shows zero amounts when there is nothing to do, and the amount a run would issue", () => {
    render(
      <FinanceOverviewTilesView
        overview={overview({
          paymentsToReconcile: { count: 0, cents: 0 },
          depositsAwaiting: { count: 0, cents: 0 },
          overdueReceivables: { count: 0, cents: 0 },
          billing: { toIssueCount: 4, toIssueCents: 2_500_000, nextIssueDate: "2026-10-30" },
        })}
      />,
    )
    expect(screen.getByTestId("tile-reconcile-value")).toHaveTextContent("$0.00")
    expect(screen.getByTestId("tile-deposits-value")).toHaveTextContent("$0.00")
    expect(screen.getByTestId("tile-overdue-value")).toHaveTextContent("$0.00")
    expect(screen.getByTestId("tile-billing")).toHaveTextContent("Ready to bill")
    expect(screen.getByTestId("tile-billing-value")).toHaveTextContent("$25,000.00")
  })
})

describe("BillingRunPanel", () => {
  const preview = (count: number): BillingPreview => ({
    today: "2026-10-24",
    wouldIssue: {
      count,
      payrollCount: count,
      depositCount: 0,
      payslipCount: count,
      totalCents: count * 500_000,
      byCompany: count ? [{ companyId: "client_1", companyName: "Acme Robotics", count, totalCents: count * 500_000 }] : [],
      invoices: Array.from({ length: count }, (_, i) => ({
        id: `payroll:h${i}:1`,
        number: `INV-2026-01${i}`,
        kind: "payroll" as const,
        companyId: "client_1",
        companyName: "Acme Robotics",
        personName: `Person ${i}`,
        issueDate: "2026-10-24",
        dueDate: "2026-10-31",
        periodStart: "2026-10-19",
        periodEnd: "2026-11-01",
        payDate: "2026-11-06",
        totalCents: 500_000,
      })),
    },
    upcoming: [],
    recent: [],
  })

  it("previews what would be issued and shows the result of a run", async () => {
    const run = vi.fn().mockResolvedValue({
      ok: true,
      data: { today: "2026-10-24", invoices: 2, payrollInvoices: 2, depositInvoices: 0, payslips: 2, totalCents: 1_000_000 },
    })
    render(<BillingRunPanel preview={preview(2)} run={run} />)
    expect(screen.getByTestId("would-issue-summary")).toHaveTextContent("would issue 2 invoices (2 payroll, 0 deposit) totalling $10,000.00")
    expect(screen.getAllByTestId("would-issue-row")).toHaveLength(2)
    await userEvent.click(screen.getByTestId("run-billing"))
    expect(await screen.findByTestId("run-result-text")).toHaveTextContent("Issued 2 invoices (2 payroll invoices) totalling $10,000.00, and created 2 pay slips.")
    expect(run).toHaveBeenCalledTimes(1)
  })

  it("says nothing would be issued and shows a failed run as an error", async () => {
    const run = vi.fn().mockResolvedValue({ ok: false, code: "forbidden", message: "Your role cannot perform this action." })
    render(<BillingRunPanel preview={preview(0)} run={run} />)
    expect(screen.getByTestId("would-issue-summary")).toHaveTextContent("Nothing to issue as of Oct 24, 2026.")
    expect(screen.queryByTestId("would-issue-table")).toBeNull()
    await userEvent.click(screen.getByTestId("run-billing"))
    expect(await screen.findByTestId("run-error")).toHaveTextContent("Your role cannot perform this action.")
  })

  it("describes an idempotent second run", () => {
    expect(describeRun({ today: "2026-10-24", invoices: 0, payrollInvoices: 0, depositInvoices: 0, payslips: 0, totalCents: 0 })).toBe(
      "Nothing to issue. Everything due as of Oct 24, 2026 is already billed.",
    )
  })

  it("paginates a long preview (C11)", () => {
    render(<BillingRunPanel preview={preview(14)} />)
    expect(screen.getAllByTestId("would-issue-row")).toHaveLength(10)
  })
})

describe("ReceivablesReport", () => {
  const zero = { count: 0, cents: 0 }
  const report = (): Receivables => ({
    asOf: "2026-10-24",
    buckets: { current: { count: 1, cents: 100 }, days1to30: { count: 2, cents: 200 }, days31to60: zero, days60plus: { count: 1, cents: 50 } },
    totalCents: 350,
    invoiceCount: 4,
    inFlight: zero,
    companies: [
      {
        companyId: "client_1",
        companyName: "Acme Robotics",
        buckets: { current: { count: 1, cents: 100 }, days1to30: { count: 2, cents: 200 }, days31to60: zero, days60plus: { count: 1, cents: 50 } },
        totalCents: 350,
        invoiceCount: 4,
        inFlight: zero,
        oldestDueDate: "2026-08-01",
        savedMethod: null,
      },
      {
        companyId: "client_2",
        companyName: "Idle Co",
        buckets: { current: zero, days1to30: zero, days31to60: zero, days60plus: zero },
        totalCents: 0,
        invoiceCount: 0,
        inFlight: zero,
        oldestDueDate: null,
        savedMethod: null,
      },
    ],
  })

  it("sums everything outside current as overdue", () => {
    expect(overdueOf(report())).toEqual({ count: 3, cents: 250 })
  })

  it("lists clients with a balance, links each to its drilldown, and leaves out those with nothing owed", () => {
    render(<ReceivablesReport report={report()} selectedCompanyId={null} />)
    expect(screen.getAllByTestId("receivable-row")).toHaveLength(1)
    expect(screen.getByTestId("receivable-open")).toHaveAttribute("href", expect.stringContaining("company=client_1"))
    expect(screen.queryByText("Idle Co")).toBeNull()
    expect(screen.getByTestId("receivables-total")).toHaveTextContent("$3.50")
  })

  it("pages the client rows through the shared bar only above ten clients", () => {
    const base = report()
    const many = (n: number): Receivables => ({
      ...base,
      companies: Array.from({ length: n }, (_, i) => ({ ...base.companies[0], companyId: `c${i}`, companyName: `Client ${i}` })),
    })
    const { unmount } = render(<ReceivablesReport report={many(10)} selectedCompanyId={null} />)
    expect(screen.getAllByTestId("receivable-row")).toHaveLength(10)
    expect(screen.queryByTestId("page-range")).toBeNull()
    unmount()
    render(<ReceivablesReport report={many(12)} selectedCompanyId={null} paging={{ page: 2, size: 10 }} />)
    expect(screen.getAllByTestId("receivable-row")).toHaveLength(2)
    expect(screen.getByTestId("page-range")).toBeInTheDocument()
    expect(screen.getByTestId("receivables-total")).toHaveTextContent("$3.50")
  })

  it("ClientOpenInvoices shows how late each invoice is", () => {
    const row: InvoiceListRow = {
      id: "payroll:h:1",
      number: "INV-2026-0001",
      kind: "payroll",
      companyId: "client_1",
      companyName: "Acme Robotics",
      hireId: "h",
      caseId: "c",
      personName: "Wren Mensah",
      periodStart: "2026-10-05",
      periodEnd: "2026-10-18",
      payDate: "2026-10-23",
      issueDate: "2026-10-16",
      dueDate: "2026-10-21",
      totalCents: 533_847,
      displayStatus: "overdue",
    }
    render(<ClientOpenInvoices rows={[row]} today="2026-10-24" companyName="Acme Robotics" companyId="client_1" />)
    expect(screen.getByTestId("receivables-drilldown")).toHaveTextContent("Acme Robotics")
    expect(screen.getByTestId("drilldown-row")).toHaveTextContent("3 days late")
  })
})

describe("InvoiceHistory", () => {
  it("lists each entry in order", () => {
    render(
      <InvoiceHistory
        entries={[
          { key: "issued", at: "2026-10-16", title: "Invoice issued", detail: null, paymentId: null, tone: "neutral" },
          { key: "void", at: null, title: "Invoice voided", detail: "Billed in error", paymentId: null, tone: "neutral" },
        ]}
      />,
    )
    const entries = screen.getAllByTestId("history-entry")
    expect(entries).toHaveLength(2)
    expect(entries[0]).toHaveTextContent("Invoice issued")
    expect(entries[1]).toHaveTextContent("Billed in error")
  })
})
