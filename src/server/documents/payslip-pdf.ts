/**
 * Employee pay slip (pay statement) PDF. Pure: plain data in, bytes out. Every amount is integer
 * cents and is printed as given, so the slip always matches the payroll run it was built from.
 *
 * `PayslipInput` is the contract between the PDF and whatever stores payroll runs. The payroll
 * domain's `computeWithholding` output (`PayStubTaxes`) maps onto it with `payslipFromWithholding`;
 * a persistence layer that stores the run's lines can build a `PayslipInput` directly.
 * See docs/invoice-and-payslip-pdfs.md.
 */

import { rgb } from "pdf-lib"

import { maskSsn } from "@/domain/forms"
import type { PayStubTaxes } from "@/domain/payroll/withholding"
import { formatCents } from "@/lib/format"

import { NORTHWIND_ENTITY } from "./agreement-template"
import { DocumentInputError } from "./errors"
import { DEFAULT_TIME_ZONE } from "./esign"
import {
  BAND,
  BRAND,
  CONTENT_WIDTH,
  Flow,
  GRAY,
  INK,
  LETTER,
  MARGIN,
  RIGHT,
  RULE,
  caption,
  drawFooters,
  drawRight,
  drawText,
  embedFonts,
  fitText,
  hRule,
  type Fonts,
} from "./pdf-layout"
import { createPdf, formatInZone, saveDeterministic, usDate } from "./pdf-utils"

/** One line of the slip: this period and the calendar year to date, including this period. */
export type PayslipLine = {
  /** Stable code from the payroll domain, e.g. `FED_INCOME`, `CA_SDI`, `TRADITIONAL_401K`. Not printed. */
  code?: string
  /** What the employee reads: "Federal income tax", "Medicare", "401(k) (traditional)". */
  label: string
  /** Whole US cents for this pay period. */
  currentCents: number
  /** Whole US cents for the tax year through this pay date. */
  ytdCents: number
}

/**
 * Everything a pay slip prints. All amounts are whole US cents, never negative.
 *
 * Invariants checked by `generatePayslipPdf` (it throws `DocumentInputError` otherwise):
 * - `earnings` current amounts sum to `gross.currentCents` (when `earnings` is given);
 * - `gross - preTaxDeductions - taxes - postTaxDeductions === net` for the current period.
 */
export type PayslipInput = {
  /** The legal employer printed on the slip; Northwind EOR, Inc. when omitted. */
  employer?: { name: string; address?: string }
  employee: {
    name: string
    /**
     * Any form of the SSN (`123-45-6789`, digits, or an already masked `***-**-6789`). Only the
     * last four digits are ever printed; the rest never reaches the PDF. Omit to print no SSN.
     */
    ssn?: string
    employeeId?: string
    roleTitle?: string
    /** Two-letter work state, printed with the employee details. */
    workState?: string
  }
  /** `YYYY-MM-DD` days; the period is inclusive of both ends. */
  period: { start: string; end: string; payDate: string }
  /** Hours paid, for hourly employees. */
  hoursWorked?: number | null
  /** e.g. "Direct deposit ••1234". */
  paymentMethod?: string
  /** Earnings lines. Defaults to one "Regular wages" line equal to gross pay. */
  earnings?: PayslipLine[]
  gross: { currentCents: number; ytdCents: number }
  /** Section 125 health premium, traditional 401(k). Reduce income tax wages. */
  preTaxDeductions: PayslipLine[]
  /** Federal income tax wages: gross less pre-tax deductions. */
  taxableWages: { currentCents: number; ytdCents: number }
  /** Federal income tax, Social Security, Medicare, Additional Medicare, state income tax, state insurance lines. */
  taxes: PayslipLine[]
  postTaxDeductions: PayslipLine[]
  net: { currentCents: number; ytdCents: number }
}

export type PayslipContext = Pick<PayslipInput, "employer" | "employee" | "period" | "hoursWorked" | "paymentMethod" | "earnings">

/**
 * Maps `computeWithholding` output onto a `PayslipInput`. Tax lines that are zero this period and
 * year to date (for example Additional Medicare below its threshold) are left off the slip.
 */
export function payslipFromWithholding(stub: PayStubTaxes, context: PayslipContext): PayslipInput {
  const line = (l: { code: string; label: string; amountCents: number; ytdCents: number }): PayslipLine => ({
    code: l.code,
    label: l.label,
    currentCents: l.amountCents,
    ytdCents: l.ytdCents,
  })
  return {
    ...context,
    gross: { currentCents: stub.grossCents, ytdCents: stub.ytd.grossCents },
    preTaxDeductions: stub.preTaxDeductions.filter((d) => d.amountCents > 0 || d.ytdCents > 0).map(line),
    taxableWages: { currentCents: stub.wageBases.federalIncomeTaxableCents, ytdCents: stub.ytd.federalTaxableWagesCents },
    taxes: stub.taxes.filter((t) => t.amountCents > 0 || t.ytdCents > 0).map(line),
    postTaxDeductions: stub.postTaxDeductions.filter((d) => d.amountCents > 0 || d.ytdCents > 0).map(line),
    net: { currentCents: stub.totals.netPayCents, ytdCents: stub.ytd.netPayCents },
  }
}

const FOOTER_TOP = 64
const ROW = 16
const CURRENT_RIGHT = RIGHT - 118
const YTD_RIGHT = RIGHT - 8
const sum = (lines: readonly { currentCents: number }[]) => lines.reduce((total, l) => total + l.currentCents, 0)

function validate(input: PayslipInput): void {
  const errors: Record<string, string> = {}
  const cents = (value: number, key: string) => {
    if (!Number.isSafeInteger(value) || value < 0) errors[key] = "must be a non-negative integer number of cents"
  }
  const lines = (list: readonly PayslipLine[], key: string) =>
    list.forEach((l, i) => {
      cents(l.currentCents, `${key}.${i}.currentCents`)
      cents(l.ytdCents, `${key}.${i}.ytdCents`)
    })
  for (const key of ["gross", "taxableWages", "net"] as const) {
    cents(input[key].currentCents, `${key}.currentCents`)
    cents(input[key].ytdCents, `${key}.ytdCents`)
  }
  lines(input.earnings ?? [], "earnings")
  lines(input.preTaxDeductions, "preTaxDeductions")
  lines(input.taxes, "taxes")
  lines(input.postTaxDeductions, "postTaxDeductions")
  if (Object.keys(errors).length === 0) {
    if (input.earnings && sum(input.earnings) !== input.gross.currentCents) errors.earnings = "must sum to gross pay"
    const expected =
      input.gross.currentCents - sum(input.preTaxDeductions) - sum(input.taxes) - sum(input.postTaxDeductions)
    if (expected !== input.net.currentCents) errors.net = "must equal gross less deductions and taxes"
  }
  if (Object.keys(errors).length > 0) throw new DocumentInputError("Pay slip", errors)
}

function detail(page: Flow["page"], fonts: Fonts, label: string, value: string, x: number, y: number, width: number): void {
  caption(page, fonts, label, x, y)
  drawText(page, fitText(fonts.bold, value, 9.5, width), x, y - 12, { size: 9.5, font: fonts.bold })
}

/**
 * One pay slip as a Letter-size PDF: employee and employer details, a gross/taxes/deductions/net
 * summary, then earnings, pre-tax deductions, taxable wages, itemised taxes, post-tax deductions
 * and net pay, each with current and year-to-date columns. Continues on further pages if the
 * lines overflow. Throws `DocumentInputError` when amounts are not integer cents or do not add up.
 */
export async function generatePayslipPdf(input: PayslipInput, options: { now?: Date } = {}): Promise<Uint8Array> {
  validate(input)
  const now = options.now ?? new Date()
  const employerName = input.employer?.name ?? NORTHWIND_ENTITY.legalName
  const employerAddress = input.employer ? input.employer.address : NORTHWIND_ENTITY.address
  const { employee, period } = input
  const earnings = input.earnings ?? [
    { label: "Regular wages", currentCents: input.gross.currentCents, ytdCents: input.gross.ytdCents },
  ]
  const totalTaxes = { currentCents: sum(input.taxes), ytdCents: input.taxes.reduce((t, l) => t + l.ytdCents, 0) }
  const totalDeductions = {
    currentCents: sum(input.preTaxDeductions) + sum(input.postTaxDeductions),
    ytdCents: [...input.preTaxDeductions, ...input.postTaxDeductions].reduce((t, l) => t + l.ytdCents, 0),
  }

  const doc = await createPdf(`Pay slip: ${employee.name}, pay date ${usDate(period.payDate)}`, now)
  doc.setSubject(`Pay statement for ${employee.name}`)
  doc.setAuthor(employerName)
  const fonts = await embedFonts(doc)

  const flow = new Flow(
    doc,
    {
      bottom: FOOTER_TOP,
      top: LETTER.height - MARGIN - 38,
      onNewPage: (page) => {
        drawText(page, "Northwind", MARGIN, LETTER.height - MARGIN - 8, { size: 11, font: fonts.bold, color: BRAND })
        drawRight(page, `Pay statement, ${employee.name} (continued)`, RIGHT, LETTER.height - MARGIN - 8, { size: 9, font: fonts.sans, color: GRAY })
        hRule(page, LETTER.height - MARGIN - 16)
        return LETTER.height - MARGIN - 38
      },
    },
    0,
  )
  const first = flow.page
  const top = LETTER.height - MARGIN
  first.drawRectangle({ x: MARGIN, y: top - 14, width: 14, height: 14, color: BRAND })
  drawText(first, "Northwind", MARGIN + 22, top - 12, { size: 17, font: fonts.bold, color: BRAND })
  drawText(first, employerName, MARGIN, top - 30, { size: 8.5, font: fonts.sans, color: GRAY })
  if (employerAddress) drawText(first, employerAddress, MARGIN, top - 41, { size: 8.5, font: fonts.sans, color: GRAY })
  drawRight(first, "PAY STATEMENT", RIGHT, top - 8, { size: 20, font: fonts.bold })
  drawRight(first, `Pay date ${usDate(period.payDate)}`, RIGHT, top - 26, { size: 10, font: fonts.bold, color: GRAY })
  hRule(first, top - 62)

  let y = top - 84
  detail(first, fonts, "Employee", employee.name, MARGIN, y, 160)
  detail(first, fonts, "Social Security number", employee.ssn ? maskSsn(employee.ssn) : "Not on file", MARGIN + 180, y, 150)
  detail(first, fonts, "Pay period", `${usDate(period.start)} - ${usDate(period.end)}`, MARGIN + 348, y, 156)
  y -= 34
  detail(first, fonts, "Employer", employerName, MARGIN, y, 160)
  detail(first, fonts, "Role", employee.roleTitle ?? "-", MARGIN + 180, y, 150)
  detail(first, fonts, "Pay date", usDate(period.payDate), MARGIN + 348, y, 156)
  y -= 34
  const extra: [string, string][] = []
  if (employee.employeeId) extra.push(["Employee ID", employee.employeeId])
  if (employee.workState) extra.push(["Work state", employee.workState])
  if (input.hoursWorked != null) extra.push(["Hours paid", String(input.hoursWorked)])
  if (input.paymentMethod) extra.push(["Paid by", input.paymentMethod])
  const columns = [
    { x: MARGIN, width: 160 },
    { x: MARGIN + 180, width: 150 },
    { x: MARGIN + 348, width: 156 },
  ]
  for (let i = 0; i < extra.length; i += 3) {
    extra.slice(i, i + 3).forEach(([label, value], j) => detail(first, fonts, label, value, columns[j].x, y, columns[j].width))
    y -= 34
  }

  const boxes: [string, string][] = [
    ["Gross pay", formatCents(input.gross.currentCents)],
    ["Taxes", formatCents(totalTaxes.currentCents)],
    ["Deductions", formatCents(totalDeductions.currentCents)],
    ["Net pay", formatCents(input.net.currentCents)],
  ]
  const boxWidth = (CONTENT_WIDTH - 3 * 8) / 4
  boxes.forEach(([label, value], i) => {
    const x = MARGIN + i * (boxWidth + 8)
    const strong = i === 3
    first.drawRectangle({ x, y: y - 40, width: boxWidth, height: 44, color: strong ? BRAND : BAND })
    drawText(first, label.toUpperCase(), x + 10, y - 12, { size: 7, font: fonts.bold, color: strong ? rgb(0.85, 0.89, 0.96) : GRAY })
    drawText(first, value, x + 10, y - 31, { size: 13, font: fonts.bold, color: strong ? rgb(1, 1, 1) : INK })
  })
  flow.y = y - 62

  const drawColumns = () => {
    const { page } = flow
    page.drawRectangle({ x: MARGIN, y: flow.y - 5, width: CONTENT_WIDTH, height: 19, color: BAND })
    caption(page, fonts, "Description", MARGIN + 8, flow.y + 1)
    drawRight(page, "THIS PERIOD", CURRENT_RIGHT, flow.y + 1, { size: 7, font: fonts.bold, color: GRAY })
    drawRight(page, "YEAR TO DATE", YTD_RIGHT, flow.y + 1, { size: 7, font: fonts.bold, color: GRAY })
    flow.y -= 22
  }
  const sectionHead = (label: string) => {
    flow.ensure(ROW * 2, drawColumns)
    drawText(flow.page, label, MARGIN + 8, flow.y - 2, { size: 8.5, font: fonts.bold, color: BRAND })
    flow.y -= ROW
  }
  const lineRow = (l: PayslipLine) => {
    flow.ensure(ROW, drawColumns)
    drawText(flow.page, fitText(fonts.sans, l.label, 9.5, 270), MARGIN + 18, flow.y, { size: 9.5, font: fonts.sans })
    drawRight(flow.page, formatCents(l.currentCents), CURRENT_RIGHT, flow.y, { size: 9.5, font: fonts.sans })
    drawRight(flow.page, formatCents(l.ytdCents), YTD_RIGHT, flow.y, { size: 9.5, font: fonts.sans })
    flow.y -= ROW
    hRule(flow.page, flow.y + 11, MARGIN + 8, RIGHT, BAND, 0.5)
  }
  const totalRow = (label: string, amounts: { currentCents: number; ytdCents: number }, negative = false) => {
    flow.ensure(ROW + 4, drawColumns)
    const signed = (cents: number) => `${negative && cents > 0 ? "-" : ""}${formatCents(cents)}`
    drawText(flow.page, label, MARGIN + 18, flow.y, { size: 9.5, font: fonts.bold })
    drawRight(flow.page, signed(amounts.currentCents), CURRENT_RIGHT, flow.y, { size: 9.5, font: fonts.bold })
    drawRight(flow.page, signed(amounts.ytdCents), YTD_RIGHT, flow.y, { size: 9.5, font: fonts.bold })
    flow.y -= ROW + 4
  }

  drawColumns()
  sectionHead("Earnings")
  earnings.forEach(lineRow)
  totalRow("Gross pay", input.gross)

  if (input.preTaxDeductions.length > 0) {
    sectionHead("Pre-tax deductions")
    input.preTaxDeductions.forEach(lineRow)
    totalRow("Total pre-tax deductions", {
      currentCents: sum(input.preTaxDeductions),
      ytdCents: input.preTaxDeductions.reduce((t, l) => t + l.ytdCents, 0),
    }, true)
  }
  totalRow("Taxable wages (federal income tax)", input.taxableWages)

  sectionHead("Taxes withheld")
  if (input.taxes.length === 0) {
    flow.ensure(ROW)
    drawText(flow.page, "No taxes withheld this period", MARGIN + 18, flow.y, { size: 9.5, font: fonts.sans, color: GRAY })
    flow.y -= ROW
  }
  input.taxes.forEach(lineRow)
  totalRow("Total taxes", totalTaxes, true)

  if (input.postTaxDeductions.length > 0) {
    sectionHead("Post-tax deductions")
    input.postTaxDeductions.forEach(lineRow)
    totalRow("Total post-tax deductions", {
      currentCents: sum(input.postTaxDeductions),
      ytdCents: input.postTaxDeductions.reduce((t, l) => t + l.ytdCents, 0),
    }, true)
  }

  flow.ensure(46)
  const netTop = flow.y + 8
  flow.page.drawRectangle({ x: MARGIN, y: netTop - 30, width: CONTENT_WIDTH, height: 30, color: BAND, borderColor: RULE, borderWidth: 0.8 })
  drawText(flow.page, "NET PAY", MARGIN + 18, netTop - 19, { size: 11, font: fonts.bold })
  drawRight(flow.page, formatCents(input.net.currentCents), CURRENT_RIGHT, netTop - 19, { size: 11, font: fonts.bold })
  drawRight(flow.page, formatCents(input.net.ytdCents), YTD_RIGHT, netTop - 19, { size: 11, font: fonts.bold })
  flow.y = netTop - 46

  flow.ensure(12)
  drawText(flow.page, "Year-to-date figures cover the tax year of the pay date and include this pay period. All amounts are in US dollars.", MARGIN, flow.y, {
    size: 8,
    font: fonts.sans,
    color: GRAY,
  })

  drawFooters(
    doc,
    fonts,
    `${employerName}  |  Pay statement for ${employee.name}  |  Pay date ${usDate(period.payDate)}  |  Generated ${formatInZone(now, DEFAULT_TIME_ZONE).date}`,
  )
  return saveDeterministic(doc, now)
}
