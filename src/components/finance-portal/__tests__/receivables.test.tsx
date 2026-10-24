import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), search: new URLSearchParams() }))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, refresh: nav.refresh }),
  usePathname: () => "/finance/receivables",
  useSearchParams: () => nav.search,
}))

import type { StaffInvoiceRow } from "@/lib/finance-staff-view"
import {
  bucketRows,
  clearedReceivablesHref,
  receivablesChips,
  receivablesFigures,
  type ReceivablesQuery,
} from "@/lib/receivables-view"
import type { AgeingTotals, ClientAgeing, ClientAgeingRow } from "@/server/finance-insights"
import type { FinanceReceivablesPage } from "@/server/finance-lists"

import { BarList } from "../charts/bar-list"
import { InvoicesTable } from "../invoices-table"
import { ReceivablesDashboard } from "../receivables/receivables-dashboard"
import { NothingOwed, ReceivablesFigures } from "../receivables/receivables-figures"

afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

const TODAY = "2026-10-24"

function totals(current: number, late: number, inFlight = 0): AgeingTotals {
  return {
    buckets: {
      current: { count: current > 0 ? 1 : 0, cents: current },
      days1to30: { count: late > 0 ? 2 : 0, cents: late },
      days31to60: { count: 0, cents: 0 },
      days60plus: { count: 0, cents: 0 },
    },
    inFlight: { count: inFlight > 0 ? 1 : 0, cents: inFlight },
    outstandingCents: current + late,
    invoiceCount: (current > 0 ? 1 : 0) + (late > 0 ? 2 : 0),
    overdueCents: late,
    overdueCount: late > 0 ? 2 : 0,
    oldestOverdueDays: late > 0 ? 17 : null,
    oldestDueDate: null,
  }
}

const client = (id: string, name: string, current: number, late: number): ClientAgeingRow => ({ companyId: id, companyName: name, ...totals(current, late) })

function ageingOf(clients: ClientAgeingRow[], inFlight = 0): ClientAgeing {
  const sum = (pick: (row: ClientAgeingRow) => number) => clients.reduce((total, row) => total + pick(row), 0)
  const book = totals(
    sum((row) => row.buckets.current.cents),
    sum((row) => row.buckets.days1to30.cents),
    inFlight,
  )
  return {
    asOf: TODAY,
    clients,
    bookAgeing: {
      ...book,
      buckets: {
        ...book.buckets,
        current: { count: sum((row) => row.buckets.current.count), cents: book.buckets.current.cents },
        days1to30: { count: sum((row) => row.buckets.days1to30.count), cents: book.buckets.days1to30.cents },
      },
      invoiceCount: sum((row) => row.invoiceCount),
    },
  }
}

const ageing = ageingOf([client("acme", "Acme Robotics", 100_000, 21_702_145), client("bw", "Brightwave Labs", 50_000, 0)], 9_556_646)
const none: Pick<ReceivablesQuery, "bucket" | "client"> = { bucket: null, client: null }

describe("BarList", () => {
  it("makes each row with money a toggle button named by its figures, and a $0 row a disabled one", () => {
    render(<BarList title="By age" rows={bucketRows(ageing, none)} rowHeader="Days late" emptyMessage="Nothing is owed." />)
    const late = screen.getByRole("button", { name: "1 to 30 days late: $217,021.45, 2 invoices" })
    expect(late).toHaveAttribute("aria-pressed", "false")
    expect(late).toHaveAttribute("href", "/finance/receivables?bucket=1-30")
    const empty = screen.getByRole("button", { name: "31 to 60 days late: $0.00, 0 invoices" })
    expect(empty).toBeDisabled()
    expect(within(late).getByTestId("bar-list-amount")).toHaveTextContent("$217,021")
    expect(within(late).getByTestId("bar-list-amount")).toHaveAttribute("title", "$217,021.45")
    expect(within(empty).getByTestId("bar-list-amount")).toHaveClass("text-muted-foreground")
  })

  it("marks the selected row pressed, with a check and a bolder label, and leaves the others at full contrast", () => {
    const rows = bucketRows(ageing, { bucket: "days1to30", client: null }, "bucket=1-30")
    render(<BarList title="By age" rows={rows} rowHeader="Days late" emptyMessage="Nothing is owed." />)
    const selected = screen.getByRole("button", { name: /^1 to 30 days late: .*, selected$/ })
    expect(selected).toHaveAttribute("aria-pressed", "true")
    expect(selected).toHaveAttribute("href", "/finance/receivables")
    expect(within(selected).getByTestId("bar-list-check")).toBeInTheDocument()
    expect(within(selected).getByTestId("bar-list-label")).toHaveClass("font-medium")
    const current = screen.getByRole("button", { name: /^Current, not yet due/ })
    expect(current).toHaveAttribute("aria-pressed", "false")
    expect(current.className).not.toMatch(/opacity/)
    expect(within(current).queryByTestId("bar-list-check")).toBeNull()
    expect(within(current).getByTestId("bar-list-label")).not.toHaveClass("text-muted-foreground")
  })

  it("navigates softly on a plain click or Space, and leaves a modified click to the browser", async () => {
    const onNavigate = vi.fn()
    render(<BarList title="By age" rows={bucketRows(ageing, none)} rowHeader="Days late" emptyMessage="Nothing is owed." onNavigate={onNavigate} />)
    const current = screen.getByRole("button", { name: /^Current/ })
    await userEvent.click(current)
    expect(onNavigate).toHaveBeenLastCalledWith("/finance/receivables?bucket=current")
    current.focus()
    await userEvent.keyboard(" ")
    expect(onNavigate).toHaveBeenCalledTimes(2)
    // jsdom cannot follow the link the browser would open in a new tab.
    window.addEventListener("click", (event) => event.preventDefault(), { once: true })
    fireEvent.click(current, { metaKey: true })
    expect(onNavigate).toHaveBeenCalledTimes(2)
  })

  it("draws each row's bar in its status tone, scaled to the longest row", () => {
    render(<BarList title="By age" rows={bucketRows(ageing, none)} rowHeader="Days late" emptyMessage="Nothing is owed." />)
    const [current, late] = screen.getAllByTestId("bar-list-row")
    expect(current).toHaveAttribute("data-key", "current")
    expect([...current.querySelectorAll("[data-tone]")].map((rect) => rect.getAttribute("data-tone"))).toEqual(["neutral"])
    expect([...late.querySelectorAll("[data-tone]")].map((rect) => rect.getAttribute("data-tone"))).toEqual(["caution"])
    const clipOf = (row: HTMLElement) => row.querySelector("clipPath rect")!.getAttribute("width")
    expect(clipOf(late)).toBe("100.000%")
    expect(parseFloat(clipOf(current)!)).toBeLessThan(100)
  })

  it("as a section has the heading with its takeaway beside it and no card", () => {
    render(
      <BarList title="By age" variant="section" takeaway="99% overdue of $1M outstanding" rows={bucketRows(ageing, none)} rowHeader="Days late" emptyMessage="Nothing is owed." testId="by-age" />,
    )
    const heading = screen.getByRole("heading", { name: "By age" })
    expect(heading).toHaveClass("text-base", "font-semibold")
    expect(screen.getByText("99% overdue of $1M outstanding")).toHaveClass("text-muted-foreground")
    expect(screen.getByTestId("by-age")).not.toHaveClass("border")
    expect(screen.getAllByTestId("bar-list-row")).toHaveLength(4)
  })

  it("has a hidden table of its rows, and the empty state when nothing is drawn", () => {
    const { rerender } = render(<BarList title="By age" rows={bucketRows(ageing, none)} rowHeader="Days late" emptyMessage="Nothing is owed." />)
    const table = screen.getByRole("table", { name: "By age" })
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Days late", "Amount", "Invoices"])
    expect(within(table).getByRole("row", { name: /1–30 days late \$217,021\.45 2/ })).toBeInTheDocument()
    const empty = ageingOf([client("acme", "Acme Robotics", 0, 0)])
    rerender(<BarList title="By age" rows={bucketRows(empty, none)} rowHeader="Days late" emptyMessage="Nothing is owed." />)
    expect(screen.queryAllByTestId("bar-list-row")).toHaveLength(0)
    expect(screen.getByText("Nothing is owed.")).toBeInTheDocument()
  })
})

describe("ReceivablesFigures", () => {
  it("states outstanding, overdue in danger and in flight linking to Payments, exact in the title and for screen readers", () => {
    render(<ReceivablesFigures figures={receivablesFigures(ageing, none)} />)
    const line = screen.getByTestId("receivables-figures")
    expect(line).toHaveTextContent("$218,521$218,521.45 outstanding")
    expect(screen.getByTestId("receivables-outstanding")).toHaveAttribute("title", "$218,521.45")
    expect(screen.getByTestId("receivables-overdue-line")).toHaveClass("text-status-danger-foreground")
    expect(screen.getByTestId("receivables-overdue")).toHaveAttribute("data-cents", "21702145")
    expect(screen.getByTestId("receivables-inflight-link")).toHaveAttribute("href", "/finance/payments")
    expect(screen.getByTestId("receivables-inflight")).toHaveAttribute("title", "$95,566.46")
  })

  it("follows the filters and hides in flight while one is on", () => {
    render(<ReceivablesFigures figures={receivablesFigures(ageing, { bucket: "current", client: null })} />)
    expect(screen.getByTestId("receivables-outstanding")).toHaveAttribute("data-cents", "150000")
    expect(screen.getByTestId("receivables-overdue")).toHaveAttribute("data-cents", "0")
    expect(screen.getByTestId("receivables-overdue-line")).toHaveClass("text-muted-foreground")
    expect(screen.queryByTestId("receivables-inflight-link")).toBeNull()
  })

  it("says nothing is owed, with money in flight beside it when there is some", () => {
    const { rerender } = render(<NothingOwed inFlightCents={9_556_646} />)
    expect(screen.getByTestId("nothing-owed")).toHaveTextContent(/^Nothing is owed\./)
    expect(screen.getByTestId("receivables-inflight-link")).toHaveAttribute("href", "/finance/payments")
    rerender(<NothingOwed inFlightCents={0} />)
    expect(screen.getByTestId("nothing-owed")).toHaveTextContent(/^Nothing is owed\.$/)
  })
})

const invoice = (id: string, dueDate: string, patch: Partial<StaffInvoiceRow> = {}): StaffInvoiceRow => ({
  id,
  number: `INV-${id}`,
  personName: "Wren Mensah",
  caseId: "case_1",
  kind: "payroll",
  periodStart: "2026-10-05",
  periodEnd: "2026-10-18",
  payDate: "2026-10-23",
  issueDate: "2026-10-01",
  dueDate,
  totalCents: 533_847,
  displayStatus: dueDate < TODAY ? "overdue" : "open",
  companyId: "acme",
  companyName: "Acme Robotics",
  hireId: "h1",
  canMarkPaid: false,
  ...patch,
})

function tableOf(rows: StaffInvoiceRow[]): FinanceReceivablesPage {
  return {
    rows,
    ids: rows.map((row) => row.id),
    total: rows.length,
    page: 1,
    pageSize: 10,
    totalPages: rows.length > 0 ? 1 : 0,
    today: TODAY,
    summary: { count: rows.length, outstandingCents: rows.reduce((total, row) => total + row.totalCents, 0), overdueCents: 0 },
  }
}

describe("InvoicesTable, receivables variant", () => {
  it("puts Days late where Invoices has Status, in danger when late, and says it in the row's name", () => {
    const rows = [invoice("a", "2026-10-07"), invoice("b", "2026-10-23"), invoice("c", TODAY), invoice("d", "2026-10-30")]
    render(<InvoicesTable variant="receivables" rows={rows} today={TODAY} cursor={null} hrefOf={(id) => `/x/${id}`} onOpen={vi.fn()} />)
    const table = screen.getByTestId("receivables-table")
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Invoice", "Person", "Due", "Days late", "Amount"])
    expect(within(table).queryByTestId("invoice-status")).toBeNull()
    const cells = within(table).getAllByTestId("invoice-days-late")
    expect(cells.map((cell) => cell.textContent)).toEqual(["17 days late", "1 day late", "due today", "in 6 days"])
    expect(cells[0]).toHaveClass("text-status-danger-foreground")
    expect(cells[3]).toHaveClass("text-muted-foreground")
    expect(within(table).getAllByTestId("invoice-open")[0]).toHaveAccessibleName("INV-a, Wren Mensah, Acme Robotics, $5,338.47, 17 days late")
  })

  it("leaves the Invoices table as it was", () => {
    render(<InvoicesTable rows={[invoice("a", "2026-10-07")]} today={TODAY} cursor={null} hrefOf={(id) => `/x/${id}`} onOpen={vi.fn()} />)
    const table = screen.getByTestId("invoices-table")
    expect(within(table).getByRole("columnheader", { name: "Status" })).toBeInTheDocument()
    expect(within(table).queryByTestId("invoice-days-late")).toBeNull()
    expect(within(table).getByTestId("invoice-open")).toHaveAccessibleName("INV-a, Wren Mensah, Acme Robotics, $5,338.47, Overdue")
  })
})

describe("ReceivablesDashboard", () => {
  function renderDashboard(query: Pick<ReceivablesQuery, "bucket" | "client">, current: string, rows: StaffInvoiceRow[]) {
    render(
      <ReceivablesDashboard
        figures={receivablesFigures(ageing, query)}
        byAge={bucketRows(ageing, query, current)}
        chips={receivablesChips(query, current)}
        clearHref={clearedReceivablesHref(current)}
        table={tableOf(rows)}
      />,
    )
  }

  it("is the figures, the By age section and the Unpaid invoices table with its count, in that order", () => {
    renderDashboard(none, "", [invoice("a", "2026-10-07"), invoice("b", "2026-10-09")])
    const figures = screen.getByTestId("receivables-figures")
    const byAge = screen.getByTestId("by-age")
    const invoices = screen.getByTestId("receivables-invoices")
    expect(figures.compareDocumentPosition(byAge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(byAge.compareDocumentPosition(invoices) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole("heading", { name: "By age" })).toHaveClass("text-base", "font-semibold")
    expect(screen.getByText("99% overdue of $219K outstanding")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Unpaid invoices 2" })).toHaveClass("text-base", "font-semibold")
    expect(screen.getByTestId("receivables-count")).toHaveTextContent("2")
    expect(screen.queryByTestId("by-client")).toBeNull()
  })

  it("shows a chip for the selected age that removes only it, and Clear", async () => {
    renderDashboard({ bucket: "days1to30", client: "acme" }, "bucket=1-30&client=acme&size=25", [invoice("a", "2026-10-07")])
    const chips = screen.getAllByTestId("filter-chip")
    expect(chips.map((chip) => chip.textContent)).toEqual(["1–30 days late"])
    const removeBucket = screen.getByRole("link", { name: "Remove filter: 1–30 days late" })
    expect(removeBucket).toHaveAttribute("href", "/finance/receivables?client=acme&size=25")
    await userEvent.click(removeBucket)
    expect(nav.push).toHaveBeenLastCalledWith("/finance/receivables?client=acme&size=25", { scroll: false })
    expect(screen.getByTestId("clear-filters")).toHaveAttribute("href", "/finance/receivables?client=acme&size=25")
  })

  it("has no chips without a filter, and a row opens the invoice in the Invoices drawer", async () => {
    renderDashboard(none, "", [invoice("payroll:h1:1", "2026-10-07")])
    expect(screen.queryByTestId("filter-chips")).toBeNull()
    await userEvent.click(screen.getByTestId("invoice-open"))
    expect(nav.push).toHaveBeenLastCalledWith("/finance/invoices?open=payroll%3Ah1%3A1")
  })

  it("says when nothing matches the filters, with a Clear", () => {
    renderDashboard({ bucket: "days31to60", client: "bw" }, "bucket=31-60&client=bw", [])
    const empty = screen.getByTestId("no-receivable-invoices")
    expect(empty).toHaveTextContent("No unpaid invoices match these filters.")
    expect(within(empty).getByRole("link", { name: "Clear" })).toHaveAttribute("href", "/finance/receivables?client=bw")
    expect(screen.queryByTestId("receivables-table")).toBeNull()
  })
})
