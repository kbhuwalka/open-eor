import { describe, expect, it } from "vitest"

import type { BillingPreview, PreviewInvoice } from "@/server/billing-preview"

import { describeRun, nothingToIssue, previewByClient, runButtonLabel, runFigures } from "../billing-run-view"

function invoice(n: number, patch: Partial<PreviewInvoice> = {}): PreviewInvoice {
  return {
    id: `payroll:h${n}:21`,
    number: `INV-2026-01${String(n).padStart(2, "0")}`,
    kind: "payroll",
    companyId: "client_1",
    companyName: "Acme Robotics",
    personName: `Person ${n}`,
    issueDate: "2026-10-24",
    dueDate: "2026-10-29",
    periodStart: "2026-10-19",
    periodEnd: "2026-11-01",
    payDate: "2026-11-06",
    totalCents: 100_000,
    ...patch,
  }
}

function would(invoices: PreviewInvoice[]): BillingPreview["wouldIssue"] {
  const payroll = invoices.filter((i) => i.kind === "payroll").length
  return {
    count: invoices.length,
    payrollCount: payroll,
    depositCount: invoices.length - payroll,
    payslipCount: payroll,
    totalCents: invoices.reduce((total, i) => total + i.totalCents, 0),
    byCompany: [],
    invoices,
  }
}

const mixed = would([
  invoice(1, { personName: "Zoe" }),
  invoice(2, { personName: "Adam", totalCents: 250_000 }),
  invoice(3, { kind: "deposit", id: "deposit:h3", companyId: "client_2", companyName: "Brightwave Labs", totalCents: 900_000 }),
  invoice(4, { companyId: "client_3", companyName: "Harbor Foods Co.", totalCents: 50_000 }),
])

describe("runFigures", () => {
  it("splits payroll and deposit, totals them and counts the pay slips", () => {
    expect(runFigures(mixed)).toEqual({
      payroll: { count: 3, cents: 400_000 },
      deposit: { count: 1, cents: 900_000 },
      total: { count: 4, cents: 1_300_000 },
      payslips: 3,
    })
  })
})

describe("previewByClient", () => {
  it("groups by client, largest total first, people in name order", () => {
    const groups = previewByClient(mixed)
    expect(groups.map((g) => [g.companyName, g.count, g.totalCents])).toEqual([
      ["Brightwave Labs", 1, 900_000],
      ["Acme Robotics", 2, 350_000],
      ["Harbor Foods Co.", 1, 50_000],
    ])
    expect(groups[1].invoices.map((i) => i.personName)).toEqual(["Adam", "Zoe"])
  })

  it("is empty when nothing would be issued", () => {
    expect(previewByClient(would([]))).toEqual([])
  })
})

describe("labels and outcomes", () => {
  it("names the button with what it issues", () => {
    expect(runButtonLabel(14)).toBe("Run billing · 14 invoices")
    expect(runButtonLabel(1)).toBe("Run billing · 1 invoice")
    expect(runButtonLabel(0)).toBe("Run billing")
  })

  it("says what a run issued", () => {
    expect(describeRun({ today: "2026-10-24", invoices: 14, payrollInvoices: 12, depositInvoices: 2, payslips: 12, totalCents: 21_230_000 })).toEqual({
      issued: true,
      headline: "Issued 14 invoices totalling $212,300.00",
      detail: "12 payroll invoices and 2 deposit invoices · 12 pay slips created",
    })
    expect(describeRun({ today: "2026-10-24", invoices: 1, payrollInvoices: 0, depositInvoices: 1, payslips: 0, totalCents: 500_000 }).detail).toBe(
      "1 deposit invoice · 0 pay slips created",
    )
  })

  it("says a repeated run issued nothing", () => {
    const outcome = describeRun({ today: "2026-10-24", invoices: 0, payrollInvoices: 0, depositInvoices: 0, payslips: 0, totalCents: 0 })
    expect(outcome).toEqual({ issued: false, headline: "Nothing to issue. Everything due as of Oct 24, 2026 is already billed.", detail: null })
    expect(nothingToIssue("2026-10-24")).toBe(outcome.headline)
  })
})
