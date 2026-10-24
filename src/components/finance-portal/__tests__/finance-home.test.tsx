import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { refresh, settlePaymentAction } = vi.hoisted(() => ({ refresh: vi.fn(), settlePaymentAction: vi.fn() }))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/finance",
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("@/app/finance/actions", () => ({ settlePaymentAction, settlePaymentsAction: vi.fn(), failPaymentAction: vi.fn() }))

import type { AgeingTotals, ClientAgeing, ClientAgeingRow, OldestWaitingPayments, WaitingPayment } from "@/server/finance-insights"
import type { FinanceOverview } from "@/server/finance-portal-queries"

import { HomeWhoOwesCard } from "../home/home-charts"
import { HomeTiles } from "../home/home-tiles"
import { WaitingOnYou } from "../home/waiting-on-you"

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

describe("HomeTiles", () => {
  it("shows the three tiles as links to their pages, with the figures and their context", () => {
    render(<HomeTiles overview={overview()} />)
    const settle = screen.getByTestId("tile-to-settle-link")
    expect(settle).toHaveAttribute("href", "/finance/payments")
    expect(settle).toHaveAccessibleName("To settle: 5 payments · $95,566.46")
    expect(settle).toHaveAccessibleDescription("oldest 3 days")
    expect(screen.getByTestId("tile-to-settle-context")).not.toHaveAttribute("data-late")
    expect(screen.getByTestId("tile-to-settle-context")).toHaveClass("text-muted-foreground")

    const overdue = screen.getByTestId("tile-overdue-link")
    expect(overdue).toHaveAttribute("href", "/finance/receivables")
    expect(screen.getByTestId("tile-overdue-value")).toHaveTextContent("$217,819.91 across 12 invoices")
    expect(overdue).toHaveClass("text-status-danger-foreground")
    expect(screen.getByTestId("tile-overdue-context")).toHaveTextContent("oldest 17 days")

    expect(screen.getByTestId("tile-ready-to-bill-link")).toHaveAttribute("href", "/finance/billing")
    expect(screen.getByTestId("tile-ready-to-bill-value")).toHaveTextContent("None")
    expect(screen.getByTestId("tile-ready-to-bill-context")).toHaveTextContent("next billing Fri Oct 30")
    expect(screen.queryByTestId("tile-run-billing")).toBeNull()
  })

  it("turns To settle's oldest wait danger once it is over three business days", () => {
    render(<HomeTiles overview={overview({ today: "2026-10-27" })} />)
    const context = screen.getByTestId("tile-to-settle-context")
    expect(context).toHaveTextContent("oldest 6 days")
    expect(context).toHaveAttribute("data-late", "true")
    expect(context).toHaveClass("text-status-danger-foreground")
  })

  it("offers Run billing, a link to Billing run, while invoices are ready", () => {
    render(<HomeTiles overview={overview({ readyToBill: { count: 3, cents: 1_234_500, nextIssueDate: "2026-11-13" } })} />)
    expect(screen.getByTestId("tile-ready-to-bill-value")).toHaveTextContent("3 invoices · $12,345.00")
    const run = screen.getByTestId("tile-run-billing")
    expect(run).toHaveAttribute("href", "/finance/billing")
    expect(run).toHaveTextContent("Run billing")
  })

  it("says None and nothing late when nothing waits and nothing is overdue", () => {
    render(
      <HomeTiles
        overview={overview({ toSettle: { count: 0, cents: 0, oldestInitiatedAt: null }, overdue: { count: 0, cents: 0, oldestDays: null } })}
      />,
    )
    expect(screen.getByTestId("tile-to-settle-value")).toHaveTextContent("None")
    expect(screen.getByTestId("tile-to-settle-context")).toHaveTextContent("Nothing waiting on you")
    expect(screen.getByTestId("tile-overdue-link")).not.toHaveClass("text-status-danger-foreground")
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

describe("WaitingOnYou", () => {
  const rows = [
    waiting(1, {
      companyName: "Acme Robotics",
      amountCents: 678_284,
      deposit: { invoiceId: "deposit:h1", invoiceNumber: "INV-2026-0070", personName: "Dev Petrova", startDate: "2026-11-02" },
    }),
    waiting(2, { initiatedAt: "2026-10-15T15:00:00.000Z" }),
    waiting(3, { invoiceCount: 6 }),
  ]

  it("lists the rows with the client, what each covers, the wait and the amount, each opening the payment drawer", () => {
    render(<WaitingOnYou waiting={list(rows, 7)} today={TODAY} />)
    expect(screen.getByRole("heading", { name: "Waiting on you 7" })).toBeInTheDocument()
    expect(screen.getByTestId("waiting-view-all")).toHaveAttribute("href", "/finance/payments")
    const items = screen.getAllByTestId("waiting-row")
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveAttribute("data-deposit", "true")
    expect(within(items[0]).getByTestId("waiting-open")).toHaveAttribute("href", "/finance/payments?open=pay_1")
    expect(within(items[0]).getByTestId("waiting-detail")).toHaveTextContent("Deposit · starts Nov 2 · Dev Petrova")
    expect(within(items[0]).getByTestId("waiting-amount")).toHaveTextContent("Amount $6,782.84")
    expect(within(items[0]).getByTestId("waiting-age")).toHaveTextContent("Waiting 3 days")
    expect(within(items[0]).getByTestId("waiting-age")).not.toHaveAttribute("data-late")
    expect(within(items[1]).getByTestId("waiting-detail")).toHaveTextContent("INV-2026-0062 · Noah Carter")
    expect(within(items[1]).getByTestId("waiting-age")).toHaveAttribute("data-late", "true")
    expect(within(items[1]).getByTestId("waiting-age")).toHaveClass("text-status-danger-foreground")
    expect(within(items[2]).getByTestId("waiting-detail")).toHaveTextContent("6 invoices")
    expect(screen.queryByTestId("waiting-empty")).toBeNull()
  })

  it("says so quietly when nothing waits", () => {
    render(<WaitingOnYou waiting={list([])} today={TODAY} />)
    expect(screen.getByTestId("waiting-empty")).toHaveTextContent("Nothing waiting on you.")
    expect(screen.queryByTestId("waiting-row")).toBeNull()
    expect(screen.getByTestId("waiting-count")).toHaveTextContent("0")
  })

  it("Settle opens the same confirm as Payments, settles, refreshes and says what was settled", async () => {
    const user = userEvent.setup()
    settlePaymentAction.mockResolvedValue({ ok: true, data: { paymentId: "pay_1" } })
    render(<WaitingOnYou waiting={list(rows)} today={TODAY} />)
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
    render(<WaitingOnYou waiting={list(rows)} today={TODAY} />)
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
    render(<WaitingOnYou waiting={list([waiting(9, { companyName: "Harbor Foods Co.", amountCents: 3_847_831 })])} today={TODAY} />)
    await user.click(screen.getByTestId("waiting-settle"))
    await user.click(within(await screen.findByTestId("settle-dialog")).getByTestId("action-confirm"))
    await waitFor(() => expect(screen.getByTestId("waiting-settled")).toHaveTextContent(/^Settled \$38,478\.31 from Harbor Foods Co\.$/))
  })
})

const totals = (overdueCents: number, oldestOverdueDays: number | null): AgeingTotals => ({
  buckets: {
    current: { count: 1, cents: 50_000 },
    days1to30: { count: overdueCents > 0 ? 1 : 0, cents: overdueCents },
    days31to60: { count: 0, cents: 0 },
    days60plus: { count: 0, cents: 0 },
  },
  inFlight: { count: 0, cents: 0 },
  outstandingCents: 50_000 + overdueCents,
  invoiceCount: overdueCents > 0 ? 2 : 1,
  overdueCents,
  overdueCount: overdueCents > 0 ? 1 : 0,
  oldestOverdueDays,
  oldestDueDate: null,
})

const client = (id: string, overdueCents: number, days: number | null): ClientAgeingRow => ({
  companyId: id,
  companyName: `Client ${id}`,
  ...totals(overdueCents, days),
})

describe("HomeWhoOwesCard", () => {
  it("links the bar's segments to Receivables by bucket and lists the three clients owing the most overdue", () => {
    const clients = [client("a", 900_000, 40), client("b", 500_000, 17), client("c", 200_000, 3), client("d", 100_000, 2), client("e", 0, null)]
    const ageing: ClientAgeing = { asOf: TODAY, clients, bookAgeing: totals(1_700_000, 40) }
    render(<HomeWhoOwesCard ageing={ageing} />)
    expect(screen.getByRole("figure", { name: "Who owes us" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /^1 to 30 days overdue/ })).toHaveAttribute("href", "/finance/receivables?bucket=1-30")
    expect(screen.getByRole("link", { name: /^Current/ })).toHaveAttribute("href", "/finance/receivables?bucket=current")
    const rows = screen.getAllByTestId("home-top-client")
    expect(rows.map((row) => row.getAttribute("data-company-id"))).toEqual(["a", "b", "c"])
    expect(within(rows[0]).getByTestId("home-top-client-open")).toHaveAttribute("href", "/finance/receivables?client=a")
    expect(within(rows[0]).getByTestId("home-top-client-overdue")).toHaveTextContent("Overdue $9,000.00")
    expect(within(rows[1]).getByTestId("home-top-client-oldest")).toHaveTextContent("Oldest overdue 17 days")
  })

  it("says no client is overdue when none is", () => {
    const ageing: ClientAgeing = { asOf: TODAY, clients: [client("a", 0, null)], bookAgeing: totals(0, null) }
    render(<HomeWhoOwesCard ageing={ageing} />)
    expect(screen.getByTestId("home-no-overdue")).toHaveTextContent("No client is overdue.")
    expect(screen.queryByTestId("home-top-client")).toBeNull()
  })
})
