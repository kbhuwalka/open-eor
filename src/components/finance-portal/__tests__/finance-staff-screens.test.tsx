import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const nav = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn(), search: new URLSearchParams(), pathname: "/finance/payments" }))
const actions = vi.hoisted(() => ({
  settlePaymentAction: vi.fn(),
  settlePaymentsAction: vi.fn(),
  failPaymentAction: vi.fn(),
  markDepositReceivedAction: vi.fn(),
  voidInvoiceAction: vi.fn(),
  loadFinancePaymentAction: vi.fn(),
  loadFinanceInvoiceAction: vi.fn(),
  loadFinanceInvoiceDetailAction: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, refresh: nav.refresh, push: nav.push }),
  usePathname: () => nav.pathname,
  useSearchParams: () => nav.search,
}))
vi.mock("@/app/finance/actions", () => actions)

import { buildFinanceFixtures } from "@/app/dev/finance/fixtures"
import { InvoiceStatusBadge } from "@/components/finance/invoice-status-badge"
import { DEFAULT_INVOICES_QUERY, DEFAULT_PAYMENTS_QUERY, type FinanceInvoicesQuery, type FinancePaymentsQuery } from "@/lib/finance-portal-query"
import type { StaffInvoiceRow, StaffPaymentRow } from "@/lib/finance-staff-view"
import type { InvoiceRow } from "@/lib/finance-view"
import type { FinanceInvoicesPage, FinancePaymentRecord, FinancePaymentsPage } from "@/server/finance-lists"

import { InvoicesScreen } from "../invoices-screen"
import { PaymentsScreen } from "../payments-screen"

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  nav.search = new URLSearchParams()
  actions.loadFinanceInvoiceDetailAction.mockResolvedValue(null)
  actions.loadFinancePaymentAction.mockResolvedValue(null)
  actions.loadFinanceInvoiceAction.mockResolvedValue(null)
})

const TODAY = "2026-10-24"
const companies = [
  { id: "client_1", name: "Acme Robotics" },
  { id: "client_2", name: "Globex" },
]

const payment = (n: number, patch: Partial<StaffPaymentRow> = {}): StaffPaymentRow => ({
  id: `pay_${n}`,
  status: "initiated",
  amountCents: 100_000 * n,
  methodLabel: "ACH ••4821",
  initiatedAt: `2026-10-${String(15 + n).padStart(2, "0")}T15:00:00.000Z`,
  settledAt: null,
  failedAt: null,
  failureReason: null,
  invoices: [{ id: `payroll:h${n}:1`, number: `INV-2026-000${n}` }],
  companyId: "client_1",
  companyName: "Acme Robotics",
  deposit: null,
  ...patch,
})

const invoice = (patch: Partial<StaffInvoiceRow> = {}): StaffInvoiceRow => ({
  id: "payroll:h1:1",
  number: "INV-2026-0001",
  personName: "Wren Mensah",
  caseId: "case_1",
  kind: "payroll",
  periodStart: "2026-10-05",
  periodEnd: "2026-10-18",
  payDate: "2026-10-23",
  issueDate: "2026-10-16",
  dueDate: "2026-10-21",
  totalCents: 533_847,
  displayStatus: "overdue",
  companyId: "client_1",
  companyName: "Acme Robotics",
  hireId: "h1",
  canMarkPaid: false,
  ...patch,
})

const depositPayment = payment(9, {
  amountCents: 678_284,
  initiatedAt: "2026-10-23T15:00:00.000Z",
  invoices: [{ id: "deposit:case_d", number: "INV-2026-0099" }],
  deposit: { caseId: "case_d", personName: "Dev Petrova", startDate: "2026-11-02", reopensOnFail: true, orderCancelled: false },
})

function paymentsPage(rows: StaffPaymentRow[], query: Partial<FinancePaymentsQuery> = {}, counts = { to_settle: rows.length, settled: 4, failed: 1 }): FinancePaymentsPage {
  return {
    rows,
    ids: rows.map((row) => row.id),
    total: rows.length,
    page: 1,
    pageSize: 10,
    totalPages: 1,
    tab: query.tab ?? "to_settle",
    counts,
    invoices: [],
    today: TODAY,
  }
}

function renderPayments(rows: StaffPaymentRow[], query: Partial<FinancePaymentsQuery> = {}, linked: FinancePaymentRecord | null = null) {
  const q = { ...DEFAULT_PAYMENTS_QUERY, ...query }
  return render(<PaymentsScreen data={paymentsPage(rows, q)} query={q} companies={companies} linked={linked} />)
}

describe("PaymentsScreen: To settle", () => {
  it("lists deposits first with their start date, then the oldest, and counts the tab", () => {
    renderPayments([depositPayment, payment(1), payment(7)])
    const rows = screen.getAllByTestId("payment-row")
    expect(rows.map((row) => row.dataset.paymentId)).toEqual(["pay_9", "pay_1", "pay_7"])
    expect(rows[0]).toHaveAttribute("data-deposit", "true")
    expect(within(rows[0]).getByTestId("payment-detail")).toHaveTextContent("Deposit · starts Nov 2")
    expect(screen.getByTestId("tab-count-to_settle")).toHaveTextContent("(3)")
    expect(screen.getByTestId("tab-to_settle")).toHaveTextContent("To settle")
    expect(screen.getByTestId("tab-settled")).toHaveTextContent(/^Settled$/)
  })

  it("colours the wait as late only after three business days", () => {
    renderPayments([payment(1), payment(7)])
    const [old, recent] = screen.getAllByTestId("payment-wait")
    expect(old).toHaveTextContent("Oct 16 · 8 days")
    expect(old).toHaveAttribute("data-late", "true")
    expect(recent).toHaveTextContent("Oct 22 · 2 days")
    expect(recent).not.toHaveAttribute("data-late")
  })

  it("settles one row after a dialog naming the amount and the client", async () => {
    actions.settlePaymentAction.mockResolvedValue({ ok: true, data: { paymentId: "pay_1" } })
    renderPayments([payment(1)])
    await userEvent.click(screen.getByTestId("settle-row"))
    const dialog = await screen.findByTestId("settle-dialog")
    expect(within(dialog).getByRole("heading")).toHaveTextContent("Settle $1,000.00 from Acme Robotics?")
    await userEvent.click(within(dialog).getByRole("button", { name: "Settle $1,000.00" }))
    await waitFor(() => expect(actions.settlePaymentAction).toHaveBeenCalledWith("pay_1"))
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled())
  })

  it("selecting rows shows the sticky bar; bulk Settle states the cents and reports what settled", async () => {
    actions.settlePaymentsAction.mockResolvedValue({
      ok: true,
      data: { settled: ["pay_1"], failed: [{ paymentId: "pay_2", message: "That payment is no longer waiting on Finance." }] },
    })
    renderPayments([payment(1), payment(2, { amountCents: 4_120_050 })])
    expect(screen.queryByTestId("settle-bar")).toBeNull()
    for (const box of screen.getAllByTestId("payment-select")) await userEvent.click(box)
    const bar = screen.getByTestId("settle-bar")
    expect(bar).toHaveTextContent("2 payments selected")
    expect(within(bar).getByTestId("settle-selected")).toHaveTextContent("Settle 2 · $42,201")
    await userEvent.click(within(bar).getByTestId("settle-selected"))
    const dialog = await screen.findByTestId("bulk-settle-dialog")
    expect(within(dialog).getByRole("heading")).toHaveTextContent("Settle 2 payments?")
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(2)
    await userEvent.click(within(dialog).getByRole("button", { name: "Settle $42,200.50" }))
    await waitFor(() => expect(actions.settlePaymentsAction).toHaveBeenCalledWith(["pay_1", "pay_2"]))
    expect(await screen.findByTestId("bulk-outcome")).toHaveTextContent("Settled 1 payment · $1,000.00")
    expect(screen.getByTestId("bulk-not-settled")).toHaveTextContent("1 payment not settled: That payment is no longer waiting on Finance.")
    await userEvent.click(screen.getByTestId("bulk-done"))
    expect(screen.queryByTestId("settle-bar")).toBeNull()
  })

  it("Clear in the bar drops the selection", async () => {
    renderPayments([payment(1)])
    await userEvent.click(screen.getByTestId("payment-select"))
    await userEvent.click(screen.getByTestId("clear-selection"))
    expect(screen.queryByTestId("settle-bar")).toBeNull()
  })

  it("Mark failed in the row menu opens the drawer with the reason field showing", async () => {
    renderPayments([payment(1)])
    await userEvent.click(screen.getByTestId("payment-row-menu"))
    await userEvent.click(await screen.findByTestId("row-mark-failed"))
    const drawer = await screen.findByTestId("payment-drawer")
    expect(within(drawer).getByTestId("fail-form")).toBeInTheDocument()
    expect(within(drawer).queryByTestId("drawer-mark-failed")).toBeNull()
  })

  it("shows the tab's empty state, and Clear only for a filtered empty list", () => {
    const { unmount } = renderPayments([])
    expect(screen.getByTestId("no-payments")).toHaveTextContent("Nothing to settle.")
    expect(screen.queryByTestId("clear-filters")).toBeNull()
    unmount()
    renderPayments([], { q: "nobody" })
    expect(screen.getByTestId("no-payments")).toHaveTextContent("No payments match these filters.")
    expect(screen.getByTestId("clear-filters")).toHaveTextContent("Clear")
  })
})

describe("PaymentsScreen: Settled and Failed", () => {
  it("groups settled payments by the month they settled, without selection or Settle", () => {
    renderPayments(
      [
        payment(1, { status: "settled", settledAt: "2026-10-20T15:00:00.000Z" }),
        payment(2, { status: "settled", settledAt: "2026-09-20T15:00:00.000Z" }),
      ],
      { tab: "settled" },
    )
    expect(screen.getByText("October 2026")).toBeInTheDocument()
    expect(screen.getByText("September 2026")).toBeInTheDocument()
    expect(screen.queryByTestId("payment-select")).toBeNull()
    expect(screen.queryByTestId("settle-row")).toBeNull()
    expect(screen.getAllByTestId("payment-when")[0]).toHaveTextContent("Oct 20")
  })

  it("shows a failed payment's reason as its second line", () => {
    renderPayments([payment(1, { status: "failed", failedAt: "2026-10-21T15:00:00.000Z", failureReason: "ACH return R01" })], { tab: "failed" })
    expect(screen.getByTestId("payment-detail")).toHaveTextContent("ACH return R01")
    expect(screen.getByTestId("payment-when")).toHaveTextContent("Oct 21")
  })
})

describe("Staff payment drawer", () => {
  async function openDrawer(row: StaffPaymentRow) {
    renderPayments([row])
    await userEvent.click(screen.getByTestId("payment-open"))
    return screen.findByTestId("payment-drawer")
  }

  it("shows the client, the reference and Finance's actions while the payment waits", async () => {
    const drawer = await openDrawer(payment(1))
    expect(within(drawer).getByTestId("payment-client")).toHaveTextContent("Acme Robotics")
    expect(within(drawer).getByTestId("payment-reference")).toHaveTextContent("pay_1")
    expect(within(drawer).getByTestId("drawer-settle")).toHaveTextContent("Settle")
    expect(within(drawer).getByTestId("drawer-mark-failed")).toHaveTextContent("Mark failed")
  })

  it("Mark failed needs a reason, says what failing does, then fails the payment", async () => {
    actions.failPaymentAction.mockResolvedValue({ ok: true, data: { paymentId: "pay_1" } })
    const drawer = await openDrawer(payment(1, { invoices: [{ id: "a", number: "INV-2026-0001" }, { id: "b", number: "INV-2026-0002" }] }))
    await userEvent.click(within(drawer).getByTestId("drawer-mark-failed"))
    expect(within(drawer).getByTestId("fail-consequence")).toHaveTextContent("INV-2026-0001 and 1 other invoice become payable again. The client sees the reason.")
    await userEvent.click(within(drawer).getByTestId("fail-confirm"))
    expect(within(drawer).getByTestId("fail-reason-error")).toHaveTextContent("Say why the payment failed.")
    expect(actions.failPaymentAction).not.toHaveBeenCalled()
    await userEvent.type(within(drawer).getByLabelText("Why did it fail? *"), "  ACH return R01 ")
    await userEvent.click(within(drawer).getByTestId("fail-confirm"))
    await waitFor(() => expect(actions.failPaymentAction).toHaveBeenCalledWith("pay_1", "ACH return R01"))
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled())
  })

  it("keeps a refusal in the form and changes nothing", async () => {
    actions.failPaymentAction.mockResolvedValue({
      ok: false,
      code: "ILLEGAL_TRANSITION",
      message: "That payment is no longer waiting on Finance: it was already settled or marked failed. Refresh the page.",
    })
    const drawer = await openDrawer(payment(1))
    await userEvent.click(within(drawer).getByTestId("drawer-mark-failed"))
    await userEvent.type(within(drawer).getByTestId("fail-reason"), "Returned")
    await userEvent.click(within(drawer).getByTestId("fail-confirm"))
    expect(await within(drawer).findByTestId("fail-error")).toHaveTextContent("Nothing was changed")
    expect(within(drawer).getByTestId("fail-error")).toHaveTextContent("already settled or marked failed")
    expect(nav.refresh).not.toHaveBeenCalled()
  })

  it("a deposit says failing reopens the client's Pay deposit step, and notes whose deposit it is", async () => {
    const drawer = await openDrawer(depositPayment)
    expect(within(drawer).getByTestId("payment-note")).toHaveTextContent("Deposit for Dev Petrova, who starts Nov 2.")
    await userEvent.click(within(drawer).getByTestId("drawer-mark-failed"))
    expect(within(drawer).getByTestId("fail-consequence")).toHaveTextContent("INV-2026-0099 becomes payable again, and the client's Pay deposit step reopens.")
  })

  it("a settled payment has no actions", async () => {
    const drawer = await openDrawer(payment(1, { status: "settled", settledAt: "2026-10-20T15:00:00.000Z" }))
    expect(within(drawer).queryByTestId("drawer-settle")).toBeNull()
    expect(within(drawer).queryByTestId("drawer-mark-failed")).toBeNull()
  })

  it("opens a linked payment, and closing drops ?open= but keeps its tab", async () => {
    nav.search = new URLSearchParams("open=pay_1")
    const settled = payment(1, { status: "settled", settledAt: "2026-10-20T15:00:00.000Z" })
    renderPayments([settled], { tab: "settled" }, { payment: settled, invoices: [] })
    const drawer = await screen.findByTestId("payment-drawer")
    await userEvent.click(within(drawer).getByRole("button", { name: /close/i }))
    expect(nav.replace).toHaveBeenCalledWith("/finance/payments?tab=settled", { scroll: false })
  })
})

describe("InvoicesScreen", () => {
  function invoicesPage(rows: StaffInvoiceRow[]): FinanceInvoicesPage {
    return {
      rows,
      ids: rows.map((row) => row.id),
      total: rows.length,
      page: 1,
      pageSize: 10,
      totalPages: 1,
      summary: { count: 279, totalCents: 203_144_210, outstandingCents: 25_889_933 },
      today: TODAY,
    }
  }
  function renderInvoices(rows: StaffInvoiceRow[], query: Partial<FinanceInvoicesQuery> = {}, linked: StaffInvoiceRow | null = null) {
    nav.pathname = "/finance/invoices"
    const q = { ...DEFAULT_INVOICES_QUERY, ...query }
    return render(<InvoicesScreen data={invoicesPage(rows)} query={q} companies={companies} linked={linked} />)
  }
  afterEach(() => {
    nav.pathname = "/finance/payments"
  })

  const unpaid = invoice({
    id: "deposit:c2",
    number: "INV-2026-0068",
    personName: "Maya Park",
    companyName: "Harbor Foods Co.",
    kind: "deposit",
    periodStart: null,
    periodEnd: null,
    dueDate: "2026-10-30",
    totalCents: 1_053_741,
    displayStatus: "open",
  })
  const paid = invoice({ id: "payroll:h3:1", number: "INV-2026-0064", displayStatus: "paid", paidDate: "2026-10-23", dueDate: "2026-10-29" })
  const nextYear = invoice({ id: "payroll:h4:1", number: "INV-2026-0090", displayStatus: "open", dueDate: "2027-01-04" })

  it("states the exact summary and has no sort control", () => {
    renderInvoices([invoice()])
    expect(screen.getByTestId("invoice-summary")).toHaveTextContent("279 invoices · $2,031,442.10 total · $258,899.33 outstanding")
    expect(screen.queryByTestId("invoice-sort")).toBeNull()
    expect(screen.queryByText("Sort")).toBeNull()
    expect(screen.queryByText("Newest")).toBeNull()
  })

  it("is a table with a hidden caption, column headers and no sortable header", () => {
    renderInvoices([unpaid, paid])
    const table = screen.getByRole("table", { name: "Invoices" })
    const headers = within(table).getAllByRole("columnheader")
    expect(headers.map((th) => th.textContent)).toEqual(["Invoice", "Person", "Client", "Due", "Status", "Amount"])
    for (const th of headers) {
      expect(th).toHaveAttribute("scope", "col")
      expect(th).not.toHaveAttribute("aria-sort")
      expect(within(th).queryByRole("button")).toBeNull()
    }
    expect(headers[5]).toHaveClass("text-right")
    expect(table.querySelector("caption")).toHaveClass("sr-only")
  })

  it("shows one line per invoice: number, person, client, the due day alone, the status word and the exact amount", () => {
    renderInvoices([unpaid, paid, invoice(), nextYear])
    const [first, second, overdue, later] = screen.getAllByTestId("invoice-row")
    expect(within(first).getByTestId("invoice-number")).toHaveTextContent("INV-2026-0068")
    expect(within(first).getByTestId("invoice-number")).toHaveClass("font-medium")
    expect(within(first).getByTestId("invoice-person")).toHaveTextContent("Maya Park")
    expect(within(first).getByTestId("invoice-client")).toHaveTextContent("Harbor Foods Co.")
    expect(within(first).getByTestId("invoice-client")).toHaveAttribute("title", "Harbor Foods Co.")
    expect(within(first).getByTestId("invoice-due")).toHaveTextContent(/^Oct 30$/)
    expect(within(first).getByTestId("invoice-due")).not.toHaveClass("text-muted-foreground")
    expect(within(first).getByTestId("invoice-status")).toHaveTextContent(/^Unpaid$/)
    expect(within(first).getByTestId("invoice-amount")).toHaveTextContent("$10,537.41")
    expect(within(first).getByTestId("invoice-amount")).toHaveClass("text-right")
    expect(within(first).getByTestId("invoice-amount").querySelector("[data-slot=money]")).toHaveClass("tabular-nums")

    expect(within(second).getByTestId("invoice-status")).toHaveTextContent(/^Paid$/)
    expect(within(second).getByTestId("invoice-due")).toHaveTextContent(/^Oct 29$/)
    expect(within(second).getByTestId("invoice-due")).toHaveClass("text-muted-foreground")
    expect(within(overdue).getByTestId("invoice-status")).toHaveTextContent(/^Overdue$/)
    expect(within(later).getByTestId("invoice-due")).toHaveTextContent(/^Jan 4, 2027$/)

    for (const row of [first, second, overdue, later]) {
      expect(row).not.toHaveTextContent(/Due |Deposit|Payroll|Oct 5|Oct 23/)
      expect(row.querySelectorAll("td")).toHaveLength(6)
    }
    expect(screen.queryByTestId("invoice-detail")).toBeNull()
  })

  it("says Processing and Void as words, and a muted dash for an invoice without a person", () => {
    renderInvoices([
      invoice({ id: "a", displayStatus: "processing" }),
      invoice({ id: "b", displayStatus: "void", personName: "" }),
    ])
    const [processing, voided] = screen.getAllByTestId("invoice-row")
    expect(within(processing).getByTestId("invoice-status")).toHaveTextContent("Processing")
    expect(within(voided).getByTestId("invoice-status")).toHaveTextContent("Void")
    expect(within(voided).getByTestId("invoice-due")).toHaveClass("text-muted-foreground")
    expect(within(voided).getByTestId("invoice-person")).toHaveTextContent("—")
  })

  it("makes the whole row a link to its ?open= URL, named after the invoice", async () => {
    renderInvoices([unpaid, paid], { status: "due" })
    const link = screen.getByRole("link", { name: "INV-2026-0068, Maya Park, Harbor Foods Co., $10,537.41, Unpaid" })
    expect(link).toHaveAttribute("href", "/finance/invoices?status=due&open=deposit%3Ac2")
    expect(link).toHaveClass("after:absolute", "after:inset-0")
    expect(screen.getAllByTestId("invoice-row")[0]).toHaveClass("relative", "hover:bg-muted/50")
    await userEvent.click(link)
    expect(await screen.findByTestId("invoice-drawer")).toBeInTheDocument()
  })

  it("walks the drawer through the list's order with Previous and Next", async () => {
    renderInvoices([unpaid, paid, invoice()])
    await userEvent.click(screen.getAllByTestId("invoice-open")[0])
    const drawer = await screen.findByTestId("invoice-drawer")
    expect(within(drawer).getByTestId("drawer-number")).toHaveTextContent("INV-2026-0068")
    await userEvent.click(within(drawer).getByRole("button", { name: "Next invoice" }))
    expect(within(drawer).getByTestId("drawer-number")).toHaveTextContent("INV-2026-0064")
    await userEvent.click(within(drawer).getByRole("button", { name: "Next invoice" }))
    expect(within(drawer).getByTestId("drawer-number")).toHaveTextContent("INV-2026-0001")
    await userEvent.click(within(drawer).getByRole("button", { name: "Previous invoice" }))
    expect(within(drawer).getByTestId("drawer-number")).toHaveTextContent("INV-2026-0064")
  })

  it("moves a cursor with j and k and opens the row with Enter", async () => {
    renderInvoices([unpaid, paid])
    await userEvent.keyboard("j")
    expect(screen.getAllByTestId("invoice-row")[0]).toHaveAttribute("data-cursor", "true")
    await userEvent.keyboard("j")
    expect(screen.getAllByTestId("invoice-row")[1]).toHaveAttribute("data-cursor", "true")
    await userEvent.keyboard("{Enter}")
    const drawer = await screen.findByTestId("invoice-drawer")
    expect(within(drawer).getByTestId("drawer-number")).toHaveTextContent("INV-2026-0064")
  })

  it("folds Client away first and then Person as the table narrows", () => {
    renderInvoices([unpaid])
    const [, person, client] = screen.getAllByRole("columnheader")
    const row = screen.getByTestId("invoice-row")
    expect(client).toHaveClass("hidden", "@2xl:table-cell")
    expect(within(row).getByTestId("invoice-client")).toHaveClass("hidden", "@2xl:table-cell")
    expect(person).toHaveClass("hidden", "@xl:table-cell")
    expect(within(row).getByTestId("invoice-person")).toHaveClass("hidden", "@xl:table-cell")
    expect(screen.getByTestId("invoices-table").closest(".\\@container")).not.toBeNull()
  })

  it("offers Unpaid, not Due, in the Status filter", async () => {
    renderInvoices([unpaid])
    await userEvent.click(screen.getByTestId("status-filter"))
    const options = (await screen.findAllByRole("option")).map((option) => option.textContent)
    expect(options).toEqual(["All statuses", "Unpaid", "Overdue", "Processing", "Paid", "Void"])
  })

  it("shows no chips or Clear without a filter", () => {
    renderInvoices([invoice()])
    expect(screen.queryByTestId("filter-chips")).toBeNull()
    expect(screen.queryByTestId("clear-filters")).toBeNull()
  })

  it("shows the empty state without filters", () => {
    renderInvoices([])
    expect(screen.getByTestId("no-invoices")).toHaveTextContent("No invoices yet. Run billing to issue the first ones.")
    expect(screen.queryByRole("table")).toBeNull()
    expect(screen.queryByTestId("invoice-summary")).toBeNull()
    expect(within(screen.getByTestId("no-invoices")).queryByRole("button")).toBeNull()
  })

  it("shows a removable chip per filter, and Clear drops them all with the search", async () => {
    renderInvoices([invoice()], { status: "overdue", client: "client_2", kind: "deposit", from: "2026-10-01", to: "2026-10-31", q: "wren" })
    const chips = screen.getAllByTestId("filter-chip")
    expect(chips.map((chip) => chip.textContent)).toEqual(["Overdue", "Globex", "Deposit", "Issued Oct 1, 2026 to Oct 31, 2026"])
    expect(screen.getByTestId("more-filters")).toHaveTextContent("More(2)")
    await userEvent.click(within(chips[1]).getByTestId("filter-chip-remove"))
    const removed = nav.replace.mock.calls.at(-1)?.[0] as string
    expect(removed).not.toContain("client=")
    expect(removed).toContain("status=overdue")
    await userEvent.click(screen.getByTestId("clear-filters"))
    expect(nav.replace.mock.calls.at(-1)?.[0]).toBe("/finance/invoices")
  })

  it("shows the filtered empty state with Clear", async () => {
    renderInvoices([], { status: "void" })
    const empty = screen.getByTestId("no-invoices")
    expect(empty).toHaveTextContent("No invoices match these filters.")
    expect(screen.queryByRole("table")).toBeNull()
    await userEvent.click(within(empty).getByRole("button", { name: "Clear" }))
    expect(nav.replace.mock.calls.at(-1)?.[0]).toBe("/finance/invoices")
  })
})

describe("Staff invoice drawer", () => {
  const fx = buildFinanceFixtures()
  const staffOf = (row: InvoiceRow, patch: Partial<StaffInvoiceRow> = {}): StaffInvoiceRow => ({
    ...row,
    companyId: "client_1",
    companyName: "Acme Robotics",
    hireId: "h1",
    canMarkPaid: false,
    ...patch,
  })

  function openInvoice(row: StaffInvoiceRow) {
    nav.pathname = "/finance/invoices"
    nav.search = new URLSearchParams(`open=${encodeURIComponent(row.id)}`)
    const data: FinanceInvoicesPage = {
      rows: [row],
      ids: [row.id],
      total: 1,
      page: 1,
      pageSize: 10,
      totalPages: 1,
      summary: { count: 1, totalCents: row.totalCents, outstandingCents: 0 },
      today: TODAY,
    }
    render(<InvoicesScreen data={data} query={DEFAULT_INVOICES_QUERY} companies={companies} linked={row} />)
    return screen.findByTestId("invoice-drawer")
  }
  afterEach(() => {
    nav.pathname = "/finance/payments"
  })

  it("keeps what the table dropped: kind, period, issued, due and paid, with an open invoice reading Unpaid", async () => {
    const drawer = await openInvoice(invoice({ displayStatus: "open" }))
    expect(within(drawer).getByTestId("drawer-header")).toHaveTextContent("Unpaid")
    expect(within(drawer).getByTestId("drawer-header")).toHaveTextContent("Payroll invoice")
    expect(within(drawer).getByTestId("drawer-period")).toHaveTextContent("Oct 5")
    expect(within(drawer).getByTestId("drawer-issued")).toHaveTextContent("Oct 16, 2026")
    expect(within(drawer).getByTestId("drawer-due-date")).toHaveTextContent("Oct 21, 2026")
    cleanup()
    const paidDrawer = await openInvoice(invoice({ displayStatus: "paid", paidDate: "2026-10-22" }))
    expect(within(paidDrawer).getByTestId("drawer-paid-date")).toHaveTextContent("Oct 22, 2026")
  })

  it("leaves the client's wording alone: an open invoice still reads Due outside Finance", () => {
    render(<InvoiceStatusBadge status="open" />)
    expect(screen.getByText("Due")).toBeInTheDocument()
    expect(screen.queryByText("Unpaid")).toBeNull()
  })

  it("offers Mark as paid on an unpaid deposit Finance can record, and records it", async () => {
    actions.markDepositReceivedAction.mockResolvedValue({ ok: true, data: { caseId: "case_d" } })
    const row = invoice({ id: "deposit:case_d", number: "INV-2026-0099", kind: "deposit", caseId: "case_d", periodStart: null, periodEnd: null, displayStatus: "open", canMarkPaid: true })
    const drawer = await openInvoice(row)
    expect(within(drawer).getByTestId("drawer-client")).toHaveTextContent("Acme Robotics")
    await userEvent.click(within(drawer).getByTestId("mark-paid"))
    const dialog = await screen.findByTestId("mark-paid-dialog")
    expect(dialog).toHaveTextContent("Use this when the client paid outside the product.")
    await userEvent.click(within(dialog).getByRole("button", { name: "Mark as paid" }))
    await waitFor(() => expect(actions.markDepositReceivedAction).toHaveBeenCalledWith("case_d"))
  })

  it("an overdue payroll invoice has no Mark as paid, and voids from the overflow menu with a reason", async () => {
    actions.voidInvoiceAction.mockResolvedValue({ ok: true, data: { invoiceId: "payroll:h1:1" } })
    const drawer = await openInvoice(invoice())
    expect(within(drawer).queryByTestId("mark-paid")).toBeNull()
    expect(within(drawer).getByTestId("drawer-pdf")).toHaveAttribute("aria-label", "Download PDF")
    await userEvent.click(within(drawer).getByTestId("invoice-more"))
    await userEvent.click(await screen.findByTestId("void-invoice"))
    const dialog = await screen.findByTestId("void-dialog")
    expect(within(dialog).getByRole("heading")).toHaveTextContent("Void INV-2026-0001?")
    await userEvent.click(within(dialog).getByRole("button", { name: "Void invoice" }))
    expect(actions.voidInvoiceAction).not.toHaveBeenCalled()
    await userEvent.type(within(dialog).getByTestId("reason-input"), "Billed in error")
    await userEvent.click(within(dialog).getByRole("button", { name: "Void invoice" }))
    await waitFor(() => expect(actions.voidInvoiceAction).toHaveBeenCalledWith("payroll:h1:1", "Billed in error"))
  })

  it("a paid invoice has neither action, and lists its payments and history", async () => {
    const paid = fx.rows.find((row) => row.displayStatus === "paid" && fx.detailById[row.id]?.payments.length)
    if (!paid) throw new Error("fixtures have no paid invoice with payments")
    actions.loadFinanceInvoiceDetailAction.mockResolvedValue(fx.detailById[paid.id])
    const drawer = await openInvoice(staffOf(paid))
    expect(within(drawer).queryByTestId("mark-paid")).toBeNull()
    expect(within(drawer).queryByTestId("invoice-more")).toBeNull()
    expect(await within(drawer).findByText("Payments on this invoice")).toBeInTheDocument()
    expect(within(drawer).getAllByTestId("drawer-payment-open").length).toBeGreaterThan(0)
    expect(within(drawer).getAllByTestId("drawer-history-entry").length).toBeGreaterThan(1)
  })

  it("a payment row swaps to the payment with Back to the invoice", async () => {
    const paid = fx.rows.find((row) => row.displayStatus === "paid" && fx.detailById[row.id]?.payments.length)
    if (!paid) throw new Error("fixtures have no paid invoice with payments")
    const detail = fx.detailById[paid.id]
    const entry = detail.payments[0]
    actions.loadFinanceInvoiceDetailAction.mockResolvedValue(detail)
    actions.loadFinancePaymentAction.mockResolvedValue({
      payment: payment(1, { id: entry.paymentId, status: "settled", settledAt: entry.settledAt, invoices: [{ id: paid.id, number: paid.number }] }),
      invoices: [],
    })
    const drawer = await openInvoice(staffOf(paid))
    const [open] = await within(drawer).findAllByTestId("drawer-payment-open")
    await userEvent.click(open)
    const swapped = await screen.findByTestId("payment-drawer")
    await waitFor(() => expect(within(swapped).getByTestId("payment-reference")).toHaveTextContent(entry.paymentId))
    await userEvent.click(within(swapped).getByRole("button", { name: new RegExp(paid.number) }))
    expect(await screen.findByTestId("invoice-drawer")).toBeInTheDocument()
  })
})
