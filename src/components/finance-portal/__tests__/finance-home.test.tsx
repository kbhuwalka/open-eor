import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { refresh, push, settlePaymentAction } = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), settlePaymentAction: vi.fn() }))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push, replace: vi.fn() }),
  usePathname: () => "/finance",
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("@/app/finance/actions", () => ({ settlePaymentAction, settlePaymentsAction: vi.fn(), failPaymentAction: vi.fn() }))

import type { OldestWaitingPayments, WaitingPayment } from "@/server/finance-insights"
import type { FinanceOverview } from "@/server/finance-portal-queries"

import { FinanceTodo } from "../home/finance-todo"
import { ClientFilter } from "../client-filter"
import { HomeFigures } from "../home/home-figures"

afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

const TODAY = "2026-10-24"

const overview = (patch: Partial<FinanceOverview> = {}): FinanceOverview => ({
  today: TODAY,
  toSettle: { count: 5, cents: 9_556_646, oldestInitiatedAt: "2026-10-21T15:00:00.000Z" },
  overdue: { count: 12, cents: 21_781_991, oldestDays: 17 },
  readyToBill: { count: 0, cents: 0, nextIssueDate: "2026-10-30" },
  ...patch,
})

describe("HomeFigures", () => {
  it("shows what is to settle, overdue and next to bill as links to their pages, in whole dollars", () => {
    render(<HomeFigures overview={overview()} />)
    const settle = screen.getByTestId("figure-to-settle-link")
    expect(settle).toHaveAttribute("href", "/finance/payments")
    expect(settle).toHaveTextContent(/^\$95,566\$95,566\.46 to settle$/)
    expect(screen.getByTestId("figure-to-settle-amount")).toHaveAttribute("data-cents", "9556646")
    expect(screen.getByTestId("figure-to-settle-amount")).toHaveAttribute("title", "$95,566.46")
    expect(settle).not.toHaveClass("text-status-danger-foreground")

    const overdue = screen.getByTestId("figure-overdue-link")
    expect(overdue).toHaveAttribute("href", "/finance/receivables")
    expect(overdue).toHaveTextContent(/^\$217,820\$217,819\.91 overdue$/)
    expect(overdue).toHaveClass("text-status-danger-foreground")

    const bill = screen.getByTestId("figure-ready-to-bill-link")
    expect(bill).toHaveAttribute("href", "/finance/billing")
    expect(bill).toHaveTextContent("Next billing Fri Oct 30")
    expect(screen.queryByTestId("figure-ready-to-bill-amount")).toBeNull()
  })

  it("states the money ready to bill when invoices are due", () => {
    render(<HomeFigures overview={overview({ readyToBill: { count: 3, cents: 1_234_500, nextIssueDate: "2026-11-13" } })} />)
    expect(screen.getByTestId("figure-ready-to-bill-link")).toHaveTextContent(/^\$12,345\$12,345\.00 ready to bill$/)
  })

  it("reads as plain sentences, with nothing in the danger tone, when nothing waits and nothing is overdue", () => {
    render(
      <HomeFigures
        overview={overview({ toSettle: { count: 0, cents: 0, oldestInitiatedAt: null }, overdue: { count: 0, cents: 0, oldestDays: null } })}
      />,
    )
    expect(screen.getByTestId("figure-to-settle-link")).toHaveTextContent("Nothing to settle")
    expect(screen.getByTestId("figure-overdue-link")).toHaveTextContent("Nothing overdue")
    expect(screen.getByTestId("figure-overdue-link")).not.toHaveClass("text-status-danger-foreground")
    expect(screen.queryByTestId("figure-overdue-amount")).toBeNull()
  })
})

const waiting = (n: number, patch: Partial<WaitingPayment> = {}): WaitingPayment => ({
  paymentId: `pay_${n}`,
  companyId: "acme",
  companyName: `Client ${n}`,
  amountCents: 100_000 * n + 84,
  initiatedAt: "2026-10-21T15:00:00.000Z",
  initiatedDay: "2026-10-21",
  businessDaysWaited: 3,
  invoiceCount: 1,
  firstInvoice: { id: `payroll:h${n}:1`, number: `INV-2026-00${60 + n}`, personName: "Noah Carter" },
  deposit: null,
  ...patch,
})

const list = (payments: WaitingPayment[], count = payments.length): OldestWaitingPayments => ({
  payments,
  total: { count, cents: payments.reduce((t, p) => t + p.amountCents, 0) },
})

describe("FinanceTodo", () => {
  const rows = [
    waiting(1, {
      companyName: "Acme Robotics",
      amountCents: 678_284,
      deposit: { invoiceId: "deposit:h1", invoiceNumber: "INV-2026-0070", personName: "Dev Petrova", startDate: "2026-11-02" },
    }),
    waiting(2, { initiatedAt: "2026-10-15T15:00:00.000Z" }),
    waiting(3, { invoiceCount: 6 }),
  ]

  it("is a table of the invoice with the client muted beneath, the due day and the amount, each row opening the payment drawer", () => {
    render(<FinanceTodo waiting={list(rows, 7)} today={TODAY} />)
    expect(screen.getByRole("heading", { name: "To do 7" })).toBeInTheDocument()
    expect(screen.getByTestId("waiting-view-all")).toHaveAttribute("href", "/finance/payments")
    expect(screen.getByTestId("waiting-view-all")).toHaveAccessibleName("View all payments")
    const headers = within(screen.getByTestId("waiting-list")).getAllByRole("columnheader")
    expect(headers.map((th) => th.textContent)).toEqual(["Invoice", "Due", "Amount", "Actions"])
    const items = screen.getAllByTestId("waiting-row")
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveAttribute("data-deposit", "true")
    expect(within(items[0]).getByTestId("waiting-open")).toHaveAttribute("href", "/finance/payments?open=pay_1")
    expect(within(items[0]).getByTestId("waiting-invoice")).toHaveTextContent(/^INV-2026-0061$/)
    expect(within(items[0]).getByTestId("waiting-client")).toHaveTextContent(/^Acme Robotics$/)
    expect(within(items[0]).getByTestId("waiting-client")).toHaveClass("text-muted-foreground")
    expect(within(items[0]).getByTestId("waiting-amount")).toHaveTextContent("Amount $6,782.84")
    expect(within(items[0]).getByTestId("waiting-due")).toHaveTextContent(/^Oct 26$/)
    expect(within(items[0]).getByTestId("waiting-due")).not.toHaveAttribute("data-late")
    expect(within(items[1]).getByTestId("waiting-invoice")).toHaveTextContent(/^INV-2026-0062$/)
    expect(within(items[1]).getByTestId("waiting-due")).toHaveTextContent(/^Oct 20$/)
    expect(within(items[1]).getByTestId("waiting-due")).toHaveAttribute("data-late", "true")
    expect(within(items[1]).getByTestId("waiting-due")).toHaveClass("text-status-danger-foreground")
    expect(within(items[2]).getByTestId("waiting-invoice")).toHaveTextContent(/^6 invoices$/)
    expect(screen.queryByTestId("waiting-empty")).toBeNull()
  })

  it("says so quietly when nothing waits", () => {
    render(<FinanceTodo waiting={list([])} today={TODAY} />)
    expect(screen.getByTestId("waiting-empty")).toHaveTextContent("You're all caught up.")
    expect(screen.queryByTestId("waiting-row")).toBeNull()
    expect(screen.getByTestId("waiting-count")).toHaveTextContent("0")
  })

  it("Settle opens the same confirm as Payments, settles, refreshes and says what was settled", async () => {
    const user = userEvent.setup()
    settlePaymentAction.mockResolvedValue({ ok: true, data: { paymentId: "pay_1" } })
    render(<FinanceTodo waiting={list(rows)} today={TODAY} />)
    expect(screen.getByTestId("waiting-settled")).toBeEmptyDOMElement()
    await user.click(screen.getByRole("button", { name: "Settle $6,782.84 from Acme Robotics" }))
    const dialog = await screen.findByTestId("settle-dialog")
    expect(within(dialog).getByRole("heading", { name: "Settle $6,782.84 from Acme Robotics?" })).toBeInTheDocument()
    expect(dialog).toHaveTextContent("It also confirms Dev Petrova's deposit")
    expect(within(dialog).getByTestId("action-cancel")).toHaveTextContent("Cancel")
    await user.click(within(dialog).getByTestId("action-confirm"))
    await waitFor(() => expect(settlePaymentAction).toHaveBeenCalledWith("pay_1"))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(screen.getByTestId("waiting-settled")).toHaveTextContent("Settled $6,782.84 from Acme Robotics.")
    await waitFor(() => expect(screen.queryByTestId("settle-dialog")).toBeNull())
  })

  it("keeps the dialog open with the refusal when the payment is no longer waiting", async () => {
    const user = userEvent.setup()
    settlePaymentAction.mockResolvedValue({ ok: false, code: "conflict", message: "That payment is no longer waiting on Finance." })
    render(<FinanceTodo waiting={list(rows)} today={TODAY} />)
    await user.click(screen.getAllByTestId("waiting-settle")[1])
    const dialog = await screen.findByTestId("settle-dialog")
    expect(dialog).toHaveTextContent("Its invoice becomes Paid.")
    await user.click(within(dialog).getByTestId("action-confirm"))
    expect(await within(dialog).findByTestId("action-error")).toHaveTextContent("That payment is no longer waiting on Finance.")
    expect(refresh).not.toHaveBeenCalled()
    expect(screen.getByTestId("waiting-settled")).toBeEmptyDOMElement()
  })

  it("does not double the full stop after a client name that ends in one", async () => {
    const user = userEvent.setup()
    settlePaymentAction.mockResolvedValue({ ok: true, data: { paymentId: "pay_9" } })
    render(<FinanceTodo waiting={list([waiting(9, { companyName: "Harbor Foods Co.", amountCents: 3_847_831 })])} today={TODAY} />)
    await user.click(screen.getByTestId("waiting-settle"))
    await user.click(within(await screen.findByTestId("settle-dialog")).getByTestId("action-confirm"))
    await waitFor(() => expect(screen.getByTestId("waiting-settled")).toHaveTextContent(/^Settled \$38,478\.31 from Harbor Foods Co\.$/))
  })
})

describe("the client filter", () => {
  const COMPANIES = [
    { id: "acme", name: "Acme Robotics" },
    { id: "bright", name: "Brightwave Labs" },
  ]

  it("narrows the figures' links and To do's View all to the chosen client", () => {
    render(<HomeFigures overview={overview()} client="acme" />)
    expect(screen.getByTestId("figure-to-settle-link")).toHaveAttribute("href", "/finance/payments?client=acme")
    expect(screen.getByTestId("figure-overdue-link")).toHaveAttribute("href", "/finance/receivables?client=acme")
    expect(screen.getByTestId("figure-ready-to-bill-link")).toHaveAttribute("href", "/finance/billing")
    cleanup()
    render(<FinanceTodo waiting={list([waiting(1)])} today={TODAY} client="acme" />)
    expect(screen.getByTestId("waiting-view-all")).toHaveAttribute("href", "/finance/payments?client=acme")
  })

  it("shows All clients, or the chosen client, and writes ?client= when another is picked", async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ClientFilter companies={COMPANIES} value={null} path="/finance" testId="home-client-filter" />)
    expect(screen.getByTestId("home-client-filter")).toHaveTextContent("All clients")
    await user.click(screen.getByTestId("home-client-filter"))
    await user.click(await screen.findByRole("option", { name: "Brightwave Labs" }))
    await waitFor(() => expect(push).toHaveBeenCalledWith("/finance?client=bright", { scroll: false }))
    rerender(<ClientFilter companies={COMPANIES} value="bright" path="/finance" testId="home-client-filter" />)
    expect(screen.getByTestId("home-client-filter")).toHaveTextContent("Brightwave Labs")
    await user.click(screen.getByTestId("home-client-filter"))
    await user.click(await screen.findByRole("option", { name: "All clients" }))
    await waitFor(() => expect(push).toHaveBeenLastCalledWith("/finance", { scroll: false }))
  })
})
