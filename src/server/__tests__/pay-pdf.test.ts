import { describe, expect, it, vi } from "vitest"

import { buildPayFixtures } from "@/app/dev/pay/fixtures"

const generate = vi.hoisted(() => vi.fn(async () => new Uint8Array([37, 80, 68, 70])))
vi.mock("@/server/documents", () => ({ generatePayslipPdf: generate }))

import { payslipInputFromDetail, payslipPdfFilename, renderPayslipPdf } from "../pay-pdf"

const detail = buildPayFixtures().slips.find((s) => s.payDate === "2026-04-24")!
const sum = (lines: { currentCents: number }[]) => lines.reduce((total, l) => total + l.currentCents, 0)

describe("payslipInputFromDetail", () => {
  it("keeps the invariants the PDF generator enforces", () => {
    const input = payslipInputFromDetail(detail)
    expect(sum(input.earnings ?? [])).toBe(input.gross.currentCents)
    expect(input.net.currentCents).toBe(
      input.gross.currentCents - sum(input.preTaxDeductions) - sum(input.taxes) - sum(input.postTaxDeductions),
    )
    expect(input.period).toEqual({ start: "2026-04-06", end: "2026-04-19", payDate: "2026-04-24" })
    expect(input.employee).toMatchObject({ name: "Jordan Rivera", workState: "CA", ssn: "***-**-6789" })
  })

  it("carries codes, labels and both columns for every line", () => {
    const input = payslipInputFromDetail(detail)
    const fed = input.taxes.find((t) => t.code === "FED_INCOME")!
    expect(fed).toEqual({
      code: "FED_INCOME",
      label: "Federal income tax",
      currentCents: detail.taxes[0].currentCents,
      ytdCents: detail.taxes[0].ytdCents,
    })
  })

  it("names the file by pay date", () => {
    expect(payslipPdfFilename(detail)).toBe("payslip-2026-04-24.pdf")
  })
})

describe("renderPayslipPdf", () => {
  it("renders through generatePayslipPdf and names the file by pay date", async () => {
    const result = await renderPayslipPdf(detail)
    expect(result).toEqual({ bytes: new Uint8Array([37, 80, 68, 70]), filename: "payslip-2026-04-24.pdf" })
    expect(generate).toHaveBeenCalledWith(payslipInputFromDetail(detail), {})
  })
})
