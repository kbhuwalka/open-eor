// @vitest-environment node
import { PDFDocument } from "pdf-lib"
import { describe, expect, it } from "vitest"

import { formatCents } from "@/lib/format"

import { DocumentInputError } from "../errors"
import { generatePayslipPdf, payslipFromWithholding, type PayslipInput, type PayslipLine } from "../payslip-pdf"
import { NOW, payslipInput, withholding } from "./invoice-payslip-fixtures"
import { allText, extractPages } from "./pdf-text"

const render = async (input: PayslipInput) => extractPages(await generatePayslipPdf(input, { now: NOW }))

/** The `[label, current, ytd]` triple printed for a line. */
function printed(page: string[], label: string): string[] {
  const at = label === "NET PAY" ? page.lastIndexOf(label) : page.indexOf(label)
  expect(at, label).toBeGreaterThanOrEqual(0)
  return page.slice(at, at + 3)
}

describe("generatePayslipPdf", () => {
  it("prints the employee, employer, period and pay date", async () => {
    const text = allText(await render(payslipInput()))
    for (const expected of [
      "PAY STATEMENT",
      "Maria Santos-Rivera",
      "Northwind EOR, Inc.",
      "10/12/2026 - 10/25/2026",
      "10/30/2026",
      "EMP-0042",
      "Direct deposit ••1234",
    ]) {
      expect(text).toContain(expected)
    }
  })

  it("prints gross, every deduction, every tax and net as current and year-to-date cents", async () => {
    const stub = withholding()
    const input = payslipInput(stub)
    const [page] = await render(input)
    const money = (cents: number) => formatCents(cents)

    expect(printed(page, "Gross pay").slice(1)).toEqual([money(stub.grossCents), money(stub.ytd.grossCents)])
    for (const d of [...stub.preTaxDeductions, ...stub.postTaxDeductions]) {
      expect(printed(page, d.label).slice(1), d.label).toEqual([money(d.amountCents), money(d.ytdCents)])
    }
    for (const t of stub.taxes) {
      expect(printed(page, t.label).slice(1), t.label).toEqual([money(t.amountCents), money(t.ytdCents)])
    }
    expect(printed(page, "Taxable wages (federal income tax)").slice(1)).toEqual([
      money(stub.wageBases.federalIncomeTaxableCents),
      money(stub.ytd.federalTaxableWagesCents),
    ])
    expect(printed(page, "NET PAY").slice(1)).toEqual([money(stub.totals.netPayCents), money(stub.ytd.netPayCents)])
    expect(printed(page, "Total taxes").slice(1)[0]).toBe(`-${money(stub.totals.taxesCents)}`)
  })

  it("itemises federal, FICA, state income and state insurance taxes and leaves out zero lines", async () => {
    const [page] = await render(payslipInput(withholding()))
    for (const label of ["Federal income tax", "Social Security", "Medicare", "California income tax", "CA State Disability Insurance"]) {
      expect(page).toContain(label)
    }
    expect(page).not.toContain("Additional Medicare")

    const texas = await render(payslipInput(withholding({ workState: "TX", ytd: undefined, preTaxDeductions: undefined, postTaxDeductions: undefined })))
    const text = allText(texas)
    expect(text).not.toContain("Pre-tax deductions")
    expect(text).not.toContain("Post-tax deductions")
    expect(text.split("\n").filter((t) => /income tax$/i.test(t))).toEqual(["Federal income tax"])
  })

  it("prints Additional Medicare once wages cross the threshold", async () => {
    const stub = withholding({
      grossCents: 2_000_000,
      ytd: { grossCents: 22_000_000, ficaWagesCents: 22_000_000, federalTaxableWagesCents: 22_000_000, stateTaxableWagesCents: 22_000_000 },
    })
    const additional = stub.taxes.find((t) => t.code === "FED_ADDITIONAL_MEDICARE")
    expect(additional?.amountCents).toBeGreaterThan(0)
    const [page] = await render(payslipInput(stub))
    expect(printed(page, additional!.label).slice(1)).toEqual([formatCents(additional!.amountCents), formatCents(additional!.ytdCents)])
  })

  describe("SSN masking", () => {
    it.each([
      ["a formatted SSN", "123-45-6789"],
      ["plain digits", "123456789"],
      ["an already masked SSN", "***-**-6789"],
      ["only the last four digits", "6789"],
    ])("prints only the last four digits from %s", async (_name, ssn) => {
      const pdf = await generatePayslipPdf(payslipInput(withholding(), ssn), { now: NOW })
      const text = allText(await extractPages(pdf))
      expect(text).toContain("***-**-6789")
      expect(text).not.toMatch(/123-?45/)
      expect(text).not.toContain("12345")
      expect(text).not.toContain("45-6789")
      expect(Buffer.from(pdf).includes("123456789")).toBe(false)
    })

    it("says so when no SSN is on file", async () => {
      const input = payslipInput()
      expect(allText(await render({ ...input, employee: { ...input.employee, ssn: undefined } }))).toContain("Not on file")
    })
  })

  it("continues over multiple pages with headers, page numbers and the net pay at the end", async () => {
    const base = payslipInput()
    const extra: PayslipLine[] = Array.from({ length: 70 }, (_, i) => ({
      label: `Garnishment ${String(i + 1).padStart(2, "0")}`,
      currentCents: 100 + i,
      ytdCents: 2_600 + i * 3,
    }))
    const added = extra.reduce((sum, l) => sum + l.currentCents, 0)
    const input: PayslipInput = {
      ...base,
      postTaxDeductions: [...base.postTaxDeductions, ...extra],
      net: { currentCents: base.net.currentCents - added, ytdCents: base.net.ytdCents },
    }
    const pages = await render(input)
    expect(pages.length).toBeGreaterThan(1)
    pages.slice(1).forEach((page) => {
      expect(page.some((t) => t.includes("(continued)"))).toBe(true)
      expect(page).toContain("THIS PERIOD")
    })
    pages.forEach((page, i) => expect(page).toContain(`Page ${i + 1} of ${pages.length}`))
    const text = allText(pages).split("\n")
    for (const line of extra) expect(text.filter((t) => t === line.label)).toHaveLength(1)
    expect(pages.at(-1)).toContain("NET PAY")
    expect(pages.at(-1)).toContain(formatCents(input.net.currentCents))
  })

  it("rejects amounts that do not reconcile or are not whole cents", async () => {
    const input = payslipInput()
    await expect(generatePayslipPdf({ ...input, net: { ...input.net, currentCents: input.net.currentCents + 1 } })).rejects.toMatchObject({
      name: "DocumentInputError",
      errors: { net: "must equal gross less deductions and taxes" },
    })
    await expect(generatePayslipPdf({ ...input, gross: { ...input.gross, currentCents: 100.5 } })).rejects.toBeInstanceOf(DocumentInputError)
    await expect(
      generatePayslipPdf({ ...input, earnings: [{ label: "Regular wages", currentCents: input.gross.currentCents - 1, ytdCents: 0 }] }),
    ).rejects.toMatchObject({ errors: { earnings: "must sum to gross pay" } })
  })

  it("is deterministic and titled with the pay date", async () => {
    const input = payslipInput()
    const a = await generatePayslipPdf(input, { now: NOW })
    const b = await generatePayslipPdf(input, { now: NOW })
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
    expect((await PDFDocument.load(a)).getTitle()).toContain("10/30/2026")
  })
})

describe("payslipFromWithholding", () => {
  it("maps computeWithholding output without changing a cent", () => {
    const stub = withholding()
    const input = payslipFromWithholding(stub, { employee: { name: "A" }, period: { start: "2026-10-12", end: "2026-10-25", payDate: "2026-10-30" } })
    expect(input.gross).toEqual({ currentCents: stub.grossCents, ytdCents: stub.ytd.grossCents })
    expect(input.net).toEqual({ currentCents: stub.totals.netPayCents, ytdCents: stub.ytd.netPayCents })
    expect(input.taxes.reduce((s, l) => s + l.currentCents, 0)).toBe(stub.totals.taxesCents)
    expect(input.preTaxDeductions.reduce((s, l) => s + l.currentCents, 0)).toBe(stub.totals.preTaxDeductionsCents)
    expect(input.postTaxDeductions.reduce((s, l) => s + l.currentCents, 0)).toBe(stub.totals.postTaxDeductionsCents)
    expect(input.taxes.map((t) => t.code)).toContain("CA_SDI")
  })
})
