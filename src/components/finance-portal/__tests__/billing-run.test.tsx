import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/app/finance/actions", () => ({ runBillingAction: vi.fn() }))

import type { BillingRunSummary } from "@/app/finance/actions"
import { previewByClient } from "@/lib/billing-run-view"
import type { ActionResult } from "@/server/action-result"
import type { BillingPreview, PreviewInvoice } from "@/server/billing-preview"

import { BillingByClient } from "../billing/billing-by-client"
import { BillingRunCard } from "../billing/billing-run-card"
import { RecentIssueDates } from "../billing/recent-issue-dates"

afterEach(cleanup)

const invoice = (n: number, patch: Partial<PreviewInvoice> = {}): PreviewInvoice => ({
  id: `payroll:h${n}:21`,
  number: `INV-2026-01${n}`,
  kind: "payroll",
  companyId: "client_1",
  companyName: "Acme Robotics",
  personName: `Person ${n}`,
  issueDate: "2026-10-24",
  dueDate: "2026-10-29",
  periodStart: "2026-10-19",
  periodEnd: "2026-11-01",
  payDate: "2026-11-06",
  totalCents: 500_000,
  ...patch,
})

function preview(invoices: PreviewInvoice[]): BillingPreview {
  const payroll = invoices.filter((i) => i.kind === "payroll").length
  return {
    today: "2026-10-24",
    wouldIssue: {
      count: invoices.length,
      payrollCount: payroll,
      depositCount: invoices.length - payroll,
      payslipCount: payroll,
      totalCents: invoices.reduce((total, i) => total + i.totalCents, 0),
      byCompany: [],
      invoices,
    },
    upcoming: [],
    recent: [],
  }
}

const due = preview([invoice(1), invoice(2), invoice(3, { kind: "deposit", id: "deposit:h3", companyId: "client_2", companyName: "Brightwave Labs", totalCents: 1_200_000 })])
const summary = (patch: Partial<BillingRunSummary> = {}): BillingRunSummary => ({
  today: "2026-10-24",
  invoices: 3,
  payrollInvoices: 2,
  depositInvoices: 1,
  payslips: 2,
  totalCents: 2_200_000,
  ...patch,
})

describe("BillingRunCard", () => {
  it("idle: shows payroll, deposit and total with the pay slips, and the one primary button names the count", () => {
    render(<BillingRunCard preview={due} run={vi.fn()} />)
    expect(screen.getByTestId("figure-payroll")).toHaveTextContent("Payroll invoices$10,000.002 invoices")
    expect(screen.getByTestId("figure-deposit")).toHaveTextContent("Deposit invoices$12,000.001 invoice")
    expect(screen.getByTestId("figure-total")).toHaveTextContent("Total$22,000.003 invoices")
    expect(screen.getByTestId("figure-payslips")).toHaveTextContent("Creates 2 pay slips, one behind each payroll invoice.")
    const button = screen.getByTestId("run-billing")
    expect(button).toHaveTextContent("Run billing · 3 invoices")
    expect(button).toBeEnabled()
    expect(screen.getByText("As of Oct 24, 2026")).toBeInTheDocument()
  })

  it("nothing to issue: says everything due is billed and disables the button", () => {
    render(<BillingRunCard preview={preview([])} run={vi.fn()} />)
    expect(screen.getByTestId("would-issue-summary")).toHaveTextContent("Nothing to issue. Everything due as of Oct 24, 2026 is already billed.")
    expect(screen.getByTestId("run-billing")).toHaveTextContent("Run billing")
    expect(screen.getByTestId("run-billing")).toBeDisabled()
  })

  it("pending: the button says Running… and is disabled while the run is in flight", async () => {
    let finish: (value: ActionResult<BillingRunSummary>) => void = () => {}
    const run = vi.fn(() => new Promise<ActionResult<BillingRunSummary>>((resolve) => (finish = resolve)))
    render(<BillingRunCard preview={due} run={run} />)
    await userEvent.click(screen.getByTestId("run-billing"))
    expect(screen.getByTestId("run-billing")).toHaveTextContent("Running…")
    expect(screen.getByTestId("run-billing")).toBeDisabled()
    expect(screen.getByTestId("run-card")).toHaveAttribute("aria-busy", "true")
    finish({ ok: true, data: summary() })
    expect(await screen.findByTestId("run-result")).toBeInTheDocument()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it("result: replaces the figures with what was issued, as a status", async () => {
    render(<BillingRunCard preview={due} run={vi.fn().mockResolvedValue({ ok: true, data: summary({ invoices: 14, payrollInvoices: 12, depositInvoices: 2, payslips: 12, totalCents: 21_230_000 }) })} />)
    await userEvent.click(screen.getByTestId("run-billing"))
    const result = await screen.findByRole("status")
    expect(within(result).getByTestId("run-result-text")).toHaveTextContent("Issued 14 invoices totalling $212,300.00")
    expect(result).toHaveTextContent("12 payroll invoices and 2 deposit invoices · 12 pay slips created")
    expect(screen.queryByTestId("figure-total")).toBeNull()
  })

  it("a press on a stale page that finds nothing left says nothing to issue", async () => {
    render(<BillingRunCard preview={due} run={vi.fn().mockResolvedValue({ ok: true, data: summary({ invoices: 0, payrollInvoices: 0, depositInvoices: 0, payslips: 0, totalCents: 0 }) })} />)
    await userEvent.click(screen.getByTestId("run-billing"))
    expect(await screen.findByTestId("run-result-text")).toHaveTextContent("Nothing to issue. Everything due as of Oct 24, 2026 is already billed.")
    expect(screen.getByTestId("run-result")).toHaveAttribute("data-issued", "false")
  })

  it("error: keeps the figures, says why and runs again on Try again", async () => {
    const run = vi
      .fn<() => Promise<ActionResult<BillingRunSummary>>>()
      .mockResolvedValueOnce({ ok: false, code: "forbidden", message: "Your role cannot perform this action." })
      .mockResolvedValueOnce({ ok: true, data: summary() })
    render(<BillingRunCard preview={due} run={run} />)
    await userEvent.click(screen.getByTestId("run-billing"))
    const error = await screen.findByTestId("run-error")
    expect(error).toHaveTextContent("Billing run failed")
    expect(error).toHaveTextContent("Your role cannot perform this action.")
    expect(screen.getByTestId("figure-total")).toBeInTheDocument()
    await userEvent.click(within(error).getByRole("button", { name: "Try again" }))
    expect(await screen.findByTestId("run-result-text")).toHaveTextContent("Issued 3 invoices totalling $22,000.00")
    expect(screen.queryByTestId("run-error")).toBeNull()
    expect(run).toHaveBeenCalledTimes(2)
  })

  it("error: a run that throws is reported, not swallowed", async () => {
    render(<BillingRunCard preview={due} run={vi.fn().mockRejectedValue(new Error("network"))} />)
    await userEvent.click(screen.getByTestId("run-billing"))
    expect(await screen.findByTestId("run-error")).toHaveTextContent("The billing run did not answer.")
  })
})

describe("BillingByClient", () => {
  it("lists one row per client and expands a client to its invoices", async () => {
    render(<BillingByClient groups={previewByClient(due.wouldIssue)} />)
    const rows = screen.getAllByTestId("by-client-row")
    expect(rows.map((row) => row.dataset.companyId)).toEqual(["client_2", "client_1"])
    expect(rows[1]).toHaveTextContent("Acme Robotics2 invoices$10,000.00")
    const toggle = within(rows[1]).getByTestId("by-client-toggle")
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByTestId("by-client-invoice")).toBeNull()
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute("aria-expanded", "true")
    const invoices = within(rows[1]).getAllByTestId("by-client-invoice")
    expect(invoices.map((row) => row.textContent)).toEqual(["Person 1Payroll$5,000.00", "Person 2Payroll$5,000.00"])
    await userEvent.click(toggle)
    expect(screen.queryByTestId("by-client-invoice")).toBeNull()
  })

  it("says nothing is waiting when the run would issue nothing", () => {
    render(<BillingByClient groups={[]} />)
    expect(screen.getByTestId("by-client-empty")).toHaveTextContent("Nothing waiting to be issued.")
  })
})

describe("RecentIssueDates", () => {
  it("lists the date, invoices and total of each issue date", () => {
    render(
      <RecentIssueDates
        days={[
          { issueDate: "2026-10-24", payrollCount: 0, depositCount: 3, count: 3, totalCents: 2_689_362 },
          { issueDate: "2026-10-16", payrollCount: 1, depositCount: 0, count: 1, totalCents: 100 },
        ]}
      />,
    )
    expect(screen.getAllByTestId("recent-row").map((row) => row.textContent)).toEqual(["Oct 24, 20263 invoices$26,893.62", "Oct 16, 20261 invoice$1.00"])
  })

  it("says when nothing has been issued", () => {
    render(<RecentIssueDates days={[]} />)
    expect(screen.getByTestId("no-recent")).toHaveTextContent("No invoices have been issued yet.")
  })
})
