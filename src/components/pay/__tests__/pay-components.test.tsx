import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { buildPayFixtures, SAMPLE_USER_ID } from "@/app/dev/pay/fixtures"
import { formatCents } from "@/lib/format"

import { WORKER_PAY_HREFS } from "../hrefs"
import { PayDashboardView } from "../pay-dashboard-view"
import { PayslipDetailView } from "../payslip-detail-view"

const replace = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/worker/pay",
  useSearchParams: () => new URLSearchParams("year=2026"),
}))

afterEach(() => {
  cleanup()
  replace.mockClear()
})

async function dashboard(options: Parameters<typeof buildPayFixtures>[0] = {}, year?: number) {
  const { source, now } = buildPayFixtures(options)
  const summary = await source.getPayDashboard(SAMPLE_USER_ID, { now })
  const selected = year ?? summary.availableYears[0] ?? summary.taxYear
  const payslips = await source.listPayslips(SAMPLE_USER_ID, { year: selected }, { now })
  render(<PayDashboardView summary={summary} payslips={payslips} selectedYear={selected} hrefs={WORKER_PAY_HREFS} />)
  return { summary, payslips }
}

describe("PayDashboardView", () => {
  it("shows the four tiles from the summary", async () => {
    const { summary } = await dashboard()
    expect(within(screen.getByTestId("tile-latest-net")).getByText(formatCents(summary.latestNetPayCents!))).toBeInTheDocument()
    expect(within(screen.getByTestId("tile-ytd-gross")).getByText(formatCents(summary.ytdGrossCents))).toBeInTheDocument()
    expect(within(screen.getByTestId("tile-ytd-taxes")).getByText(formatCents(summary.ytdTaxesCents))).toBeInTheDocument()
    expect(within(screen.getByTestId("tile-next-pay-date")).getByText("May 8, 2026")).toBeInTheDocument()
  })

  it("lists the selected year's slips with links to the slip and its PDF", async () => {
    const { payslips } = await dashboard()
    const rows = screen.getAllByTestId("payslip-row")
    expect(rows).toHaveLength(payslips.length)
    expect(rows).toHaveLength(9)
    const first = within(rows[0])
    expect(first.getByRole("link", { name: "Apr 6 – Apr 19, 2026" })).toHaveAttribute("href", `/worker/pay/${payslips[0].id}`)
    expect(first.getByRole("link", { name: "Download pay slip for Apr 6 – Apr 19, 2026" })).toHaveAttribute(
      "href",
      `/worker/pay/${payslips[0].id}/pdf`,
    )
    expect(first.getByText(formatCents(payslips[0].netCents))).toBeInTheDocument()
  })

  it("has exactly the columns Pay period, Gross pay and Net pay, then an icon-only download", async () => {
    const { payslips } = await dashboard()
    const table = within(screen.getByTestId("payslip-table"))
    const headers = table.getAllByRole("columnheader").map((header) => header.textContent?.trim())
    expect(headers).toEqual(["Pay period", "Gross pay", "Net pay", "Download"])
    const cells = within(screen.getAllByTestId("payslip-row")[0]).getAllByRole("cell")
    expect(cells).toHaveLength(4)
    expect(cells[1]).toHaveTextContent(formatCents(payslips[0].grossCents))
    expect(cells[2]).toHaveTextContent(formatCents(payslips[0].netCents))
    const download = within(cells[3]).getByRole("link")
    expect(download).toHaveTextContent("")
    expect(download).toHaveAttribute("aria-label", expect.stringMatching(/^Download pay slip for /))
    for (const dropped of ["Pay date", "Taxes", "Deductions", "Status", "Period"]) {
      expect(table.queryByRole("columnheader", { name: dropped })).not.toBeInTheDocument()
    }
  })

  it("shows only the other year's slips when that year is selected", async () => {
    await dashboard({}, 2025)
    const rows = screen.getAllByTestId("payslip-row")
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) expect(row).toHaveTextContent(/2025/)
    expect(screen.queryByText("Apr 6 – Apr 19, 2026")).not.toBeInTheDocument()
  })

  it("moves between years through the URL", async () => {
    await dashboard()
    const tabs = within(screen.getByTestId("pay-year-tabs"))
    expect(tabs.getByTestId("year-tab-2026")).toHaveAttribute("aria-selected", "true")
    await userEvent.click(tabs.getByTestId("year-tab-2025"))
    expect(replace).toHaveBeenCalledWith("/worker/pay?year=2025", { scroll: false })
  })

  it("names the first pay date when no slip exists yet", async () => {
    await dashboard({ scenario: "new-hire" })
    expect(screen.getByTestId("payslips-empty")).toHaveTextContent(
      "Your first pay slip appears on your first pay date — Fri, May 22, 2026.",
    )
    expect(screen.queryByTestId("payslip-table")).not.toBeInTheDocument()
    expect(screen.queryByTestId("pay-year-tabs")).not.toBeInTheDocument()
    expect(within(screen.getByTestId("tile-next-pay-date")).getByText("May 22, 2026")).toBeInTheDocument()
    expect(within(screen.getByTestId("tile-latest-net")).getByText("—")).toBeInTheDocument()
    expect(within(screen.getByTestId("tile-ytd-gross")).getByText("$0.00")).toBeInTheDocument()
  })

  it("falls back to a generic empty state without a known pay date", async () => {
    await dashboard({ scenario: "no-schedule" })
    expect(screen.getByTestId("payslips-empty")).toHaveTextContent("Your pay slips appear here once you have been paid.")
    expect(screen.queryByText(/first pay date/)).not.toBeInTheDocument()
    expect(within(screen.getByTestId("tile-next-pay-date")).getByText("—")).toBeInTheDocument()
    expect(within(screen.getByTestId("direct-deposit-card")).getByText("No account on file")).toBeInTheDocument()
  })

  it("shows the direct-deposit account label read-only", async () => {
    await dashboard()
    const card = screen.getByTestId("direct-deposit-card")
    expect(within(card).getByTestId("direct-deposit-label")).toHaveTextContent("Checking ••1234")
    expect(within(card).queryByRole("button")).not.toBeInTheDocument()
    expect(within(card).queryByRole("textbox")).not.toBeInTheDocument()
  })
})

describe("PayslipDetailView", () => {
  async function detail(state = "CA") {
    const { source, now } = buildPayFixtures({ state })
    const [row] = await source.listPayslips(SAMPLE_USER_ID, { year: 2026 }, { now })
    const slip = (await source.getPayslipDetail(SAMPLE_USER_ID, row.id, { now }))!
    render(<PayslipDetailView detail={slip} hrefs={WORKER_PAY_HREFS} />)
    return slip
  }

  it("prints current and YTD columns for every line", async () => {
    const slip = await detail()
    const earnings = within(screen.getByTestId("earnings"))
    expect(within(earnings.getByTestId("line-SALARY")).getByTestId("current")).toHaveTextContent(formatCents(slip.gross.currentCents))
    expect(within(earnings.getByTestId("line-SALARY")).getByTestId("ytd")).toHaveTextContent(formatCents(slip.gross.ytdCents))
    for (const tax of slip.taxes) {
      const row = within(screen.getByTestId("taxes")).getByTestId(`line-${tax.code}`)
      expect(within(row).getByTestId("current")).toHaveTextContent(formatCents(tax.currentCents))
      expect(within(row).getByTestId("ytd")).toHaveTextContent(formatCents(tax.ytdCents))
    }
    const total = within(screen.getByTestId("taxes-total"))
    expect(total.getByTestId("current")).toHaveTextContent(formatCents(slip.totals.taxes.currentCents))
  })

  it("itemizes federal, FICA, Additional Medicare when due, state income tax and insurance", async () => {
    await detail("CA")
    const taxes = within(screen.getByTestId("taxes"))
    for (const label of ["Federal income tax", "Social Security", "Medicare", "California income tax", "CA State Disability Insurance"]) {
      expect(taxes.getByText(label)).toBeInTheDocument()
    }
  })

  it("shows the health tier under the premium and the 401(k) deferral", async () => {
    await detail()
    const pre = within(screen.getByTestId("pre-tax"))
    expect(pre.getByText("Employee + spouse")).toBeInTheDocument()
    expect(pre.getByText("401(k) traditional")).toBeInTheDocument()
    expect(pre.getByText("Taxable wages")).toBeInTheDocument()
    expect(within(screen.getByTestId("post-tax")).getByText("Legal plan")).toBeInTheDocument()
  })

  it("states net pay and where it was deposited", async () => {
    const slip = await detail()
    expect(screen.getByTestId("net-pay")).toHaveTextContent(formatCents(slip.net.currentCents))
    expect(screen.getByTestId("paid-to")).toHaveTextContent("Checking ••1234")
  })

  it("breaks gross into legend rows whose amounts add up to gross", async () => {
    const slip = await detail("NY")
    const legend = within(screen.getByTestId("breakdown-legend")).getAllByRole("listitem")
    const cents = legend.map((li) => {
      const amount = li.querySelector("span:last-child")!.textContent!
      return Math.round(Number(amount.replace(/[$,]/g, "")) * 100)
    })
    expect(cents.reduce((a, b) => a + b, 0)).toBe(slip.gross.currentCents)
    expect(screen.getByRole("img", { name: /Take-home pay \d/ })).toBeInTheDocument()
  })

  it("links back to the list and to the PDF", async () => {
    const slip = await detail()
    expect(screen.getByTestId("back-to-pay")).toHaveAttribute("href", "/worker/pay")
    expect(screen.getByTestId("download-pdf")).toHaveAttribute("href", `/worker/pay/${slip.id}/pdf`)
  })
})
