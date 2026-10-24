import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { AgeingInput, BilledCollectedPoint, CadencePoint } from "@/lib/finance-chart-view"
import { bucketSegmentHrefs } from "@/lib/receivables-view"

import { AgeingBar, DIMMED_SEGMENT_OPACITY } from "../ageing-bar"
import { BilledVsCollectedChart } from "../billed-vs-collected-chart"
import { UpcomingBillingChart } from "../upcoming-billing-chart"

afterEach(cleanup)

const billedPeriod = (periodIndex: number, billedCents: number, collectedCents: number, inFlightCents = 0): BilledCollectedPoint => ({
  periodIndex,
  start: "2026-10-05",
  end: "2026-10-18",
  billedCents,
  collectedCents,
  inFlightCents,
})

const bodyRows = (table: HTMLElement) => within(table).getAllByRole("row").slice(1)
const legendLabels = (figure: HTMLElement) =>
  within(within(figure).getByRole("list"))
    .getAllByRole("listitem")
    .map((item) => item.textContent)

describe("BilledVsCollectedChart", () => {
  const periods = [billedPeriod(18, 10_000_000, 10_000_000), billedPeriod(19, 12_000_000, 9_000_000, 1_000_000)]

  it("titles the chart with its takeaway and lists every period's exact figures in the table", () => {
    render(<BilledVsCollectedChart periods={periods} />)
    const figure = screen.getByRole("figure", { name: "Billed vs collected" })
    expect(figure).toHaveTextContent("86% collected of $220K billed")
    const table = screen.getByRole("table", { name: "Billed vs collected by pay period" })
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["Pay period", "Billed", "Collected", "In flight", "Not yet collected"])
    const [, second] = bodyRows(table)
    expect(within(second).getAllByRole("cell").map((td) => td.textContent)).toEqual(["$120,000.00", "$90,000.00", "$10,000.00", "$30,000.00"])
    expect(legendLabels(figure)).toEqual(["Collected", "Not yet collected"])
    expect(within(figure).getByRole("application")).toHaveAccessibleName(
      "Billed vs collected. 86% collected of $220K billed. Use the arrow keys to read each pay period.",
    )
  })

  it("draws only the last maxPeriods periods", () => {
    const many = Array.from({ length: 10 }, (_, i) => billedPeriod(i, 100_000 * (i + 1), 0))
    render(<BilledVsCollectedChart periods={many} maxPeriods={8} />)
    const rows = bodyRows(screen.getByRole("table"))
    expect(rows).toHaveLength(8)
    expect(rows[0]).toHaveTextContent("$3,000.00")
  })

  it("shows the empty state, and no table, when nothing was billed", () => {
    render(<BilledVsCollectedChart periods={[billedPeriod(1, 0, 0)]} />)
    expect(screen.getByRole("figure")).toHaveTextContent("Nothing billed yet.")
    expect(screen.getByText("Nothing billed in these pay periods yet.")).toBeInTheDocument()
    expect(screen.queryByRole("table")).toBeNull()
  })

  it("takes an explicit takeaway", () => {
    render(<BilledVsCollectedChart periods={periods} takeaway="Collections are on track" />)
    expect(screen.getByRole("figure")).toHaveTextContent("Collections are on track")
  })
})

const ageing: AgeingInput = {
  buckets: { current: { cents: 100_000 }, days1to30: { cents: 300_000 }, days31to60: { cents: 0 }, days60plus: { cents: 100_000 } },
  inFlight: { cents: 500_000 },
}

describe("AgeingBar", () => {
  it("renders a takeaway, a legend with exact amounts and an accessible table", () => {
    render(<AgeingBar {...ageing} />)
    const figure = screen.getByRole("figure", { name: "Who owes us" })
    expect(figure).toHaveTextContent("$4K overdue of $5K outstanding · $5K in flight")
    const legend = within(figure).getByRole("list")
    expect(within(legend).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Current$1,000.00",
      "1–30 days$3,000.00",
      "31–60 days$0.00",
      "60+ days$1,000.00",
      "In flight$5,000.00",
    ])
    const table = screen.getByRole("table", { name: "Who owes us: outstanding by days overdue" })
    expect(bodyRows(table).map((row) => row.textContent)).toEqual([
      "Current$1,000.0010%",
      "1 to 30 days overdue$3,000.0030%",
      "31 to 60 days overdue$0.000%",
      "More than 60 days overdue$1,000.0010%",
      "In flight$5,000.0050%",
    ])
  })

  it("draws a focusable, named segment per non-zero bucket", () => {
    render(<AgeingBar {...ageing} />)
    const segments = screen.getAllByRole("img").filter((el) => el.hasAttribute("data-segment"))
    expect(segments.map((el) => el.getAttribute("data-segment"))).toEqual(["current", "days1to30", "days60plus", "inFlight"])
    expect(segments.every((el) => el.getAttribute("tabindex") === "0")).toBe(true)
    expect(screen.getByRole("img", { name: "1 to 30 days overdue: $3,000.00, 30% of the bar" })).toBeInTheDocument()
  })

  it("calls onSegmentClick with the bucket on click, Enter and Space, and marks the selected one pressed", async () => {
    const user = userEvent.setup()
    const onSegmentClick = vi.fn()
    render(<AgeingBar {...ageing} onSegmentClick={onSegmentClick} selected="days60plus" />)
    await user.click(screen.getByRole("button", { name: /^1 to 30 days overdue/ }))
    expect(onSegmentClick).toHaveBeenLastCalledWith("days1to30")
    screen.getByRole("button", { name: /^Current/ }).focus()
    await user.keyboard("{Enter}")
    expect(onSegmentClick).toHaveBeenLastCalledWith("current")
    screen.getByRole("button", { name: /^In flight/ }).focus()
    await user.keyboard(" ")
    expect(onSegmentClick).toHaveBeenLastCalledWith("inFlight")
    expect(onSegmentClick).toHaveBeenCalledTimes(3)
    expect(screen.getByRole("button", { name: /^More than 60 days/ })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: /^Current/ })).toHaveAttribute("aria-pressed", "false")
  })

  it("makes segments links with segmentHrefs", () => {
    render(<AgeingBar {...ageing} segmentHrefs={{ days1to30: "/finance/receivables?bucket=days1to30" }} selected="days1to30" />)
    const link = screen.getByRole("link", { name: /^1 to 30 days overdue/ })
    expect(link).toHaveAttribute("href", "/finance/receivables?bucket=days1to30")
    expect(link).toHaveAttribute("aria-current", "true")
  })

  it("marks the selected segment with a ring and keeps the others legible: faded no further than the minimum, labels in the foreground", () => {
    const { container } = render(<AgeingBar {...ageing} segmentHrefs={bucketSegmentHrefs()} selected="days1to30" />)
    expect(DIMMED_SEGMENT_OPACITY).toBeGreaterThanOrEqual(0.5)
    const shapes = [...container.querySelectorAll("[data-segment] > svg")]
    expect(shapes).toHaveLength(4)
    for (const shape of shapes) {
      const key = shape.parentElement!.getAttribute("data-segment")
      const fill = shape.querySelector("rect")!
      const label = shape.querySelector("text")
      if (key === "days1to30") {
        expect(fill.getAttribute("opacity")).toBeNull()
        expect(shape.querySelector("[data-selected-ring]")).not.toBeNull()
        continue
      }
      expect(shape).toHaveAttribute("data-dimmed", "true")
      expect(Number(fill.getAttribute("opacity"))).toBeGreaterThanOrEqual(0.5)
      expect(shape.querySelector("[data-selected-ring]")).toBeNull()
      if (label) {
        expect(label.getAttribute("opacity")).toBeNull()
        expect(label.getAttribute("class")).not.toMatch(/opacity-/)
        expect(label.getAttribute("class")).toContain("fill-foreground")
      }
    }
  })

  it("dims nothing without a selection", () => {
    const { container } = render(<AgeingBar {...ageing} segmentHrefs={bucketSegmentHrefs()} />)
    expect(container.querySelectorAll("[data-dimmed]")).toHaveLength(0)
    expect(container.querySelectorAll("[data-selected-ring]")).toHaveLength(0)
    expect(screen.getByRole("link", { name: /^1 to 30 days overdue/ })).toHaveAttribute("href", "/finance/receivables?bucket=1-30")
    expect(screen.getByRole("link", { name: /^More than 60 days overdue/ })).toHaveAttribute("href", "/finance/receivables?bucket=60-plus")
    expect(screen.getByRole("link", { name: /^In flight/ })).toHaveAttribute("href", "/finance/payments")
  })

  it("mini is one image whose name states the split", () => {
    render(<AgeingBar {...ageing} size="mini" label="Acme Robotics" />)
    expect(
      screen.getByRole("img", {
        name: "Acme Robotics: Current $1,000.00 (10%), 1 to 30 days overdue $3,000.00 (30%), More than 60 days overdue $1,000.00 (10%), In flight $5,000.00 (50%)",
      }),
    ).toBeInTheDocument()
    expect(screen.queryByRole("figure")).toBeNull()
    expect(screen.queryByRole("table")).toBeNull()
  })

  it("shows the empty state when nothing is outstanding or in flight", () => {
    const empty = { buckets: { current: { cents: 0 }, days1to30: { cents: 0 }, days31to60: { cents: 0 }, days60plus: { cents: 0 } }, inFlight: { cents: 0 } }
    render(<AgeingBar {...empty} />)
    expect(screen.getByText("Nothing outstanding.", { selector: "div" })).toBeInTheDocument()
    expect(screen.queryByRole("table")).toBeNull()
    render(<AgeingBar {...empty} size="mini" label="Harbor" />)
    expect(screen.getByRole("img", { name: "Harbor: Nothing outstanding" })).toBeInTheDocument()
  })
})

const cadencePoint = (kind: CadencePoint["kind"], periodIndex: number, issueDate: string, totalCents: number): CadencePoint => ({
  periodIndex,
  kind,
  issueDate,
  start: "2026-10-05",
  end: "2026-10-18",
  invoiceCount: totalCents > 0 ? 3 : 0,
  totalCents,
})

describe("UpcomingBillingChart", () => {
  const periods = [cadencePoint("issued", 21, "2026-10-16", 17_039_814), cadencePoint("estimate", 22, "2026-10-30", 17_184_222)]

  it("titles the chart with the next and last billing and tables issued and estimated periods", () => {
    render(<UpcomingBillingChart periods={periods} />)
    const figure = screen.getByRole("figure", { name: "Billing by pay period" })
    expect(figure).toHaveTextContent("Next billing Oct 30: about $172K · last $170K on Oct 16")
    const table = screen.getByRole("table", { name: "Billing by pay period: issued and estimated" })
    expect(bodyRows(table).map((row) => within(row).getAllByRole("cell").map((td) => td.textContent))).toEqual([
      ["Issued", "3 invoices", "$170,398.14", "Oct 5 – Oct 18, 2026"],
      ["Estimate", "3 invoices", "$171,842.22", "Oct 5 – Oct 18, 2026"],
    ])
    expect(legendLabels(figure)).toEqual(["Issued", "Estimate"])
  })

  it("shows the empty state when every period is zero", () => {
    render(<UpcomingBillingChart periods={[cadencePoint("estimate", 22, "2026-10-30", 0)]} />)
    expect(screen.getByText("No billing yet.", { selector: "div" })).toBeInTheDocument()
    expect(screen.getByRole("figure")).toHaveTextContent("Next billing Oct 30: nothing estimated yet")
    expect(screen.queryByRole("table")).toBeNull()
  })
})
