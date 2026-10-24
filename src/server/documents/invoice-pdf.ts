/**
 * Northwind EOR invoice PDF. Pure: plain data in, bytes out, no database or clock reads beyond the
 * optional `now`. Every amount is printed from integer cents; the PDF never recomputes billing.
 *
 * It is `InvoiceDocument` on paper: the same sections in the same order, the same wording (lines,
 * groups, proration and the amount due come from `src/lib/invoice-lines.ts`, shared with the
 * invoice drawer), set in Geist with tabular figures and the neutral palette of the design tokens
 * (`src/app/globals.css`). See docs/invoice-and-payslip-pdfs.md.
 */

import { rgb, type PDFPage, type RGB } from "pdf-lib"

import { invoiceDisplayStatus } from "@/domain/billing/payments"
import { businessDayOf } from "@/domain/business-time"
import type { Invoice, InvoiceDisplayStatus, Payment, SavedPaymentMethod } from "@/domain/billing/types"
import { formatIsoDay, formatIsoRange } from "@/lib/finance-format"
import { INVOICE_STATUS_LABEL, PAYMENT_STATUS_LABEL } from "@/lib/finance-view"
import { formatCents } from "@/lib/format"
import {
  DEPOSIT_NOTE,
  groupInvoiceLines,
  invoiceAmountSummary,
  invoiceVoidReasonLabel,
  prorationNote,
} from "@/lib/invoice-lines"

import { NORTHWIND_ENTITY } from "./agreement-template"
import { DocumentInputError } from "./errors"
import { DEFAULT_TIME_ZONE } from "./esign"
import { embedGeist, type GeistFonts } from "./geist"
import { Flow, LETTER, drawRight, drawText, fitText, hRule, wrapText } from "./pdf-layout"
import { createPdf, formatInZone, saveDeterministic } from "./pdf-utils"

export type InvoicePdfInput = {
  invoice: Invoice
  /** The company being billed. `addressLines` are printed as given, one per line. */
  client: { name: string; addressLines?: string[] }
  /**
   * Who the invoice is for (a payroll invoice and a deposit alike). Everything but `name` is
   * optional and printed only when given.
   */
  person?: {
    name: string
    roleTitle?: string
    /** "California". */
    workState?: string
    /** Last day of employment (`YYYY-MM-DD`) and why it is known. */
    endDate?: string
    endKind?: "terminated" | "fixed_term"
  }
  /**
   * Payments touching this invoice (any status). Only each payment's allocation to
   * `invoice.id` is printed, so a payment that covered several invoices lists its share here.
   */
  payments?: readonly Payment[]
  /** Overrides the status derived from `invoice`, `payments` and `today`. */
  status?: InvoiceDisplayStatus
  /** The stored void reason (`order_cancelled`, a Finance note, …); printed when the invoice is void. */
  voidReason?: string | null
  /** `YYYY-MM-DD` used to derive `overdue`. Defaults to `now` in Northwind's time zone. */
  today?: string
  /** Document creation time; also the timestamp in the footer. Defaults to the current time. */
  now?: Date
}

/** `oklch` tokens of globals.css (light theme) as sRGB, so the PDF uses the page's palette. */
const token = (r: number, g: number, b: number): RGB => rgb(r / 255, g / 255, b / 255)
const FOREGROUND = token(10, 10, 10)
const MUTED_FOREGROUND = token(115, 115, 115)
const BORDER = token(229, 229, 229)
const BORDER_SOFT = token(239, 239, 239)
const MUTED_40 = token(251, 251, 251)
const MUTED_60 = token(249, 249, 249)
const MUTED_30 = token(252, 252, 252)

type Tone = { background: RGB; foreground: RGB }
const NEUTRAL: Tone = { background: token(245, 245, 245), foreground: token(82, 82, 82) }
const INFO: Tone = { background: token(224, 241, 255), foreground: token(14, 87, 148) }
const SUCCESS: Tone = { background: token(224, 250, 228), foreground: token(9, 103, 46) }
const DANGER: Tone = { background: token(255, 235, 232), foreground: token(179, 35, 34) }

/** Mirrors `INVOICE_TONE` / `PAYMENT_TONE` of the status badge (ui-guidelines C24). */
const INVOICE_TONE: Record<InvoiceDisplayStatus, Tone> = {
  open: NEUTRAL,
  overdue: DANGER,
  processing: INFO,
  paid: SUCCESS,
  void: NEUTRAL,
}
const PAYMENT_TONE: Record<Payment["status"], Tone> = { initiated: INFO, succeeded: SUCCESS, failed: DANGER }
const PAYMENT_VIEW_STATUS = { initiated: "initiated", succeeded: "settled", failed: "failed" } as const

/** The sheet: a bordered frame with inner padding, like the page's card. */
const FRAME_LEFT = 40
const FRAME_RIGHT = LETTER.width - 40
const FRAME_TOP = LETTER.height - 40
const PAD = 24
const LEFT = FRAME_LEFT + PAD
const RIGHT = FRAME_RIGHT - PAD
const CONTENT = RIGHT - LEFT
const FLOW_BOTTOM = 68

const AMOUNT_RIGHT = RIGHT
const RATE_RIGHT = AMOUNT_RIGHT - 84
const QTY_RIGHT = RATE_RIGHT - 92
const DESC_WIDTH_MULTI = QTY_RIGHT - 64 - LEFT
const DESC_WIDTH_SINGLE = AMOUNT_RIGHT - 110 - LEFT

/** "ACH ••1234", "Visa ••4242". */
export function paymentMethodLabel(method: SavedPaymentMethod | null): string {
  if (!method) return "Not recorded"
  const mask = `••${method.last4}`
  return method.type === "us_bank_account" ? `ACH ${mask}` : `${method.label} ${mask}`
}

const dayOfTimestamp = (iso: string) => formatIsoDay(iso)

function validate(input: InvoicePdfInput): void {
  const { invoice } = input
  const errors: Record<string, string> = {}
  if (!Number.isSafeInteger(invoice.totalCents)) errors.totalCents = "must be an integer number of cents"
  invoice.lines.forEach((line, i) => {
    if (!Number.isSafeInteger(line.amountCents)) errors[`lines.${i}.amountCents`] = "must be an integer number of cents"
  })
  if (Object.keys(errors).length === 0) {
    const sum = invoice.lines.reduce((total, line) => total + line.amountCents, 0)
    if (sum !== invoice.totalCents) errors.totalCents = "must equal the sum of the lines"
  }
  if (Object.keys(errors).length > 0) throw new DocumentInputError("Invoice", errors)
}

function allocationTo(payment: Payment, invoiceId: string): number {
  return payment.allocations.filter((a) => a.invoiceId === invoiceId).reduce((sum, a) => sum + a.amountCents, 0)
}

function roundedRect(page: PDFPage, x: number, top: number, width: number, height: number, radius: number, color: RGB): void {
  const r = Math.min(radius, width / 2, height / 2)
  const path =
    `M ${r} 0 H ${width - r} A ${r} ${r} 0 0 1 ${width} ${r} V ${height - r} A ${r} ${r} 0 0 1 ${width - r} ${height} ` +
    `H ${r} A ${r} ${r} 0 0 1 0 ${height - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`
  page.drawSvgPath(path, { x, y: top, color, borderWidth: 0 })
}

/** The status badge: tinted rounded pill with a dot and the label, its right edge at `right`. */
function drawBadge(page: PDFPage, fonts: GeistFonts, label: string, tone: Tone, right: number, top: number): void {
  const size = 8
  const textWidth = fonts.medium.widthOfTextAtSize(label, size)
  const width = textWidth + 8 + 4.5 + 5 + 4
  const height = 15
  const x = right - width
  roundedRect(page, x, top, width, height, 4, tone.background)
  page.drawCircle({ x: x + 8 + 2.25, y: top - height / 2, size: 2.25, color: tone.foreground })
  drawText(page, label, x + 8 + 4.5 + 5, top - height / 2 - 2.8, { size, font: fonts.medium, color: tone.foreground })
}

const caption = (page: PDFPage, fonts: GeistFonts, text: string, x: number, y: number) =>
  drawText(page, text.toUpperCase(), x, y, { size: 7, font: fonts.medium, color: MUTED_FOREGROUND })

type NotesLayout = { paragraphs: { lines: string[]; size: number }[]; height: number }

/** The footer notes, worded like the page: what the status means, the deposit note, who to pay. */
function layoutNotes(fonts: GeistFonts, invoice: Invoice, status: InvoiceDisplayStatus, voidReason: string | null): NotesLayout {
  const texts: string[] = []
  if (status === "void") {
    texts.push(`This invoice was voided: ${invoiceVoidReasonLabel(voidReason)}. No payment is due and it should not be paid.`)
  } else if (status === "paid") {
    texts.push("Thank you. This invoice is paid in full and no further payment is due.")
  } else if (status === "processing") {
    texts.push("A payment for this invoice is processing. No further action is needed unless it fails.")
  }
  if (invoice.kind === "deposit") texts.push(DEPOSIT_NOTE)
  texts.push(`Payable to ${NORTHWIND_ENTITY.legalName}, ${NORTHWIND_ENTITY.address}. Amounts are in US dollars.`)
  const paragraphs = texts.map((text) => ({ lines: wrapText(fonts.regular, text, 8, CONTENT), size: 8 }))
  const height = 20 + paragraphs.reduce((total, p) => total + p.lines.length * 11 + 5, -5) + 18
  return { paragraphs, height }
}

/**
 * One invoice as a Letter-size PDF: issuer, title, number and status; the amount due; bill-to, "for"
 * and the invoice facts; the line items grouped with their basis and subtotals; totals; payments;
 * notes. Long line lists continue on further pages with the table header repeated. Throws
 * `DocumentInputError` when the lines do not add up to `invoice.totalCents` or an amount is not an
 * integer.
 */
export async function generateInvoicePdf(input: InvoicePdfInput): Promise<Uint8Array> {
  validate(input)
  const { invoice, client, person } = input
  const now = input.now ?? new Date()
  const today = input.today ?? formatInZone(now, DEFAULT_TIME_ZONE).date.replace(/(\d+)\/(\d+)\/(\d+)/, "$3-$1-$2")
  const payments = (input.payments ?? []).filter((p) => allocationTo(p, invoice.id) > 0)
  const status = input.status ?? invoiceDisplayStatus(invoice, payments, today)

  const settled = payments.filter((p) => p.status === "succeeded")
  const settledCents = settled.reduce((sum, p) => sum + allocationTo(p, invoice.id), 0)
  const inProgressCents = payments
    .filter((p) => p.status === "initiated")
    .reduce((sum, p) => sum + allocationTo(p, invoice.id), 0)
  const amountDueCents = status === "void" ? 0 : Math.max(0, invoice.totalCents - settledCents)
  const paidDate = settled
    .flatMap((p) => (p.settledAt ? [businessDayOf(p.settledAt)] : []))
    .reduce<string | null>((latest, day) => (latest === null || day > latest ? day : latest), null)
  const summary = invoiceAmountSummary({
    status,
    totalCents: invoice.totalCents,
    paidCents: settledCents,
    inProgressCents,
    dueDate: invoice.dueDate,
    paidDate,
    voidReason: input.voidReason ?? null,
  })
  const groups = groupInvoiceLines(invoice.lines)
  const multiColumn = groups.some((group) => group.lines.some((line) => line.quantity || line.rate))

  const doc = await createPdf(`Invoice ${invoice.number}`, now)
  doc.setSubject(`Invoice ${invoice.number} for ${client.name}`)
  doc.setAuthor(NORTHWIND_ENTITY.legalName)
  const fonts = await embedGeist(doc)

  /** Where the content of each finished page ended, so the frame can be closed around it. */
  const pageEnds: number[] = []
  const flow: Flow = new Flow(
    doc,
    {
      bottom: FLOW_BOTTOM,
      top: FRAME_TOP - 50,
      onNewPage: (page) => {
        pageEnds.push(flow.y)
        drawText(page, NORTHWIND_ENTITY.legalName, LEFT, FRAME_TOP - 26, { size: 10, font: fonts.semibold })
        drawRight(page, `Invoice ${invoice.number} (continued)`, RIGHT, FRAME_TOP - 26, {
          size: 8.5,
          font: fonts.regularNum,
          color: MUTED_FOREGROUND,
        })
        hRule(page, FRAME_TOP - 38, FRAME_LEFT, FRAME_RIGHT, BORDER)
        return FRAME_TOP - 38
      },
    },
    FRAME_TOP,
  )
  const first = flow.page

  // Header: issuer on the left; title, number and status on the right.
  drawText(first, NORTHWIND_ENTITY.legalName, LEFT, FRAME_TOP - PAD - 10, { size: 11, font: fonts.semibold })
  drawText(first, NORTHWIND_ENTITY.address, LEFT, FRAME_TOP - PAD - 24, { size: 8, font: fonts.regular, color: MUTED_FOREGROUND })
  drawRight(first, "Invoice", RIGHT, FRAME_TOP - PAD - 15, { size: 20, font: fonts.semibold })
  drawRight(first, invoice.number, RIGHT, FRAME_TOP - PAD - 32, { size: 8.5, font: fonts.regularNum, color: MUTED_FOREGROUND })
  drawBadge(first, fonts, INVOICE_STATUS_LABEL[status], INVOICE_TONE[status], RIGHT, FRAME_TOP - PAD - 42)
  const headerBottom = FRAME_TOP - PAD - 42 - 15 - PAD

  // The amount band.
  const bandHeight = 58
  first.drawRectangle({ x: FRAME_LEFT, y: headerBottom - bandHeight, width: FRAME_RIGHT - FRAME_LEFT, height: bandHeight, color: MUTED_40 })
  hRule(first, headerBottom, FRAME_LEFT, FRAME_RIGHT, BORDER)
  hRule(first, headerBottom - bandHeight, FRAME_LEFT, FRAME_RIGHT, BORDER)
  caption(first, fonts, summary.label, LEFT, headerBottom - 21)
  drawText(first, formatCents(summary.amountCents), LEFT, headerBottom - 45, { size: 20, font: fonts.semiboldNum })
  drawRight(first, fitText(fonts.medium, summary.note, 9, CONTENT - 170), RIGHT, headerBottom - 44, {
    size: 9,
    font: fonts.medium,
    color: status === "overdue" ? DANGER.foreground : FOREGROUND,
  })

  // Bill to, For, and the invoice facts in three columns.
  const columnsTop = headerBottom - bandHeight - PAD
  const columns = [
    { x: LEFT, width: 120 },
    { x: LEFT + 140, width: 150 },
    { x: LEFT + 310, width: RIGHT - (LEFT + 310) },
  ]
  let billY = columnsTop - 9
  caption(first, fonts, "Bill to", columns[0].x, billY)
  billY -= 15
  wrapText(fonts.medium, client.name, 9.5, columns[0].width).forEach((text, i) => {
    if (i > 0) billY -= 12
    drawText(first, text, columns[0].x, billY, { size: 9.5, font: fonts.medium })
  })
  for (const line of client.addressLines ?? []) {
    for (const text of wrapText(fonts.regular, line, 9, columns[0].width)) {
      billY -= 12
      drawText(first, text, columns[0].x, billY, { size: 9, font: fonts.regular, color: MUTED_FOREGROUND })
    }
  }

  let forY = columnsTop - 9
  caption(first, fonts, "For", columns[1].x, forY)
  forY -= 15
  drawText(first, fitText(fonts.medium, person ? person.name : "Deposit", 9.5, columns[1].width), columns[1].x, forY, {
    size: 9.5,
    font: fonts.medium,
  })
  const forLines: string[] = []
  if (person?.roleTitle) forLines.push(person.roleTitle)
  if (person?.workState) forLines.push(`Work location: ${person.workState}`)
  if (person?.endDate) {
    forLines.push(`${person.endKind === "terminated" ? "Last day worked" : "Fixed term ends"}: ${formatIsoDay(person.endDate)}`)
  }
  const proration = prorationNote(invoice.period)
  if (proration) forLines.push(proration)
  for (const line of forLines) {
    forY -= 12
    const emphasised = line === proration
    const font = emphasised ? fonts.medium : fonts.regular
    drawText(first, fitText(font, line, 9, columns[1].width), columns[1].x, forY, {
      size: 9,
      font,
      color: emphasised ? FOREGROUND : MUTED_FOREGROUND,
    })
  }

  const facts: [string, string][] = [
    ["Issue date", formatIsoDay(invoice.issueDate)],
    ["Due date", formatIsoDay(invoice.dueDate)],
  ]
  if (invoice.period) {
    facts.push(["Service period", formatIsoRange(invoice.period.start, invoice.period.end)])
    facts.push(["Pay date", formatIsoDay(invoice.period.payDate)])
    facts.push(["Tax year", String(invoice.period.taxYear)])
  } else {
    facts.push(["Service period", "None (security deposit)"])
  }
  let factY = columnsTop - 9
  for (const [label, value] of facts) {
    drawText(first, label, columns[2].x, factY, { size: 8.5, font: fonts.regular, color: MUTED_FOREGROUND })
    drawRight(first, fitText(fonts.mediumNum, value, 8.5, columns[2].width - 62), RIGHT, factY, { size: 8.5, font: fonts.mediumNum })
    factY -= 15
  }
  flow.y = Math.min(billY, forY, factY + 15) - PAD + 8
  hRule(first, flow.y, FRAME_LEFT, FRAME_RIGHT, BORDER)

  // Line items.
  const descWidth = multiColumn ? DESC_WIDTH_MULTI : DESC_WIDTH_SINGLE
  const drawTableHeader = () => {
    const { page } = flow
    const height = 26
    page.drawRectangle({ x: FRAME_LEFT, y: flow.y - height, width: FRAME_RIGHT - FRAME_LEFT, height, color: MUTED_60 })
    caption(page, fonts, "Description", LEFT, flow.y - 16)
    if (multiColumn) {
      drawRight(page, "QUANTITY", QTY_RIGHT, flow.y - 16, { size: 7, font: fonts.medium, color: MUTED_FOREGROUND })
      drawRight(page, "RATE", RATE_RIGHT, flow.y - 16, { size: 7, font: fonts.medium, color: MUTED_FOREGROUND })
    }
    drawRight(page, "AMOUNT", AMOUNT_RIGHT, flow.y - 16, { size: 7, font: fonts.medium, color: MUTED_FOREGROUND })
    hRule(page, flow.y - height, FRAME_LEFT, FRAME_RIGHT, BORDER)
    flow.y -= height
  }
  drawTableHeader()
  for (const group of groups) {
    flow.ensure(34 + 40, drawTableHeader)
    drawText(flow.page, group.label, LEFT, flow.y - 24, { size: 9.5, font: fonts.medium })
    hRule(flow.page, flow.y - 32, FRAME_LEFT, FRAME_RIGHT, BORDER)
    flow.y -= 32
    for (const line of group.lines) {
      const title = wrapText(fonts.regular, line.title, 9.5, descWidth)
      const basis = line.basis ? wrapText(fonts.regular, line.basis, 8, descWidth) : []
      const height = 9 + 7.5 + (title.length - 1) * 12.5 + (basis.length > 0 ? 11.5 + (basis.length - 1) * 10.5 : 0) + 2.5 + 9
      flow.ensure(height, drawTableHeader)
      const { page } = flow
      const first = flow.y - 16.5
      title.forEach((text, i) => drawText(page, text, LEFT, first - i * 12.5, { size: 9.5, font: fonts.regular }))
      const lastTitle = first - (title.length - 1) * 12.5
      basis.forEach((text, i) =>
        drawText(page, text, LEFT, lastTitle - 11.5 - i * 10.5, { size: 8, font: fonts.regular, color: MUTED_FOREGROUND }),
      )
      if (multiColumn && line.quantity) {
        drawRight(page, fitText(fonts.regularNum, line.quantity, 8.5, 86), QTY_RIGHT, first, { size: 8.5, font: fonts.regularNum, color: MUTED_FOREGROUND })
      }
      if (multiColumn && line.rate) {
        drawRight(page, fitText(fonts.regularNum, line.rate, 8.5, 80), RATE_RIGHT, first, { size: 8.5, font: fonts.regularNum, color: MUTED_FOREGROUND })
      }
      drawRight(page, formatCents(line.amountCents), AMOUNT_RIGHT, first, { size: 9.5, font: fonts.regularNum })
      flow.y -= height
      hRule(page, flow.y, FRAME_LEFT, FRAME_RIGHT, BORDER_SOFT, 0.5)
    }
    if (group.lines.length > 1) {
      flow.ensure(24)
      const labelRight = multiColumn ? RATE_RIGHT : AMOUNT_RIGHT - 90
      drawRight(flow.page, `${group.label} subtotal`, labelRight, flow.y - 16, { size: 8.5, font: fonts.regular, color: MUTED_FOREGROUND })
      drawRight(flow.page, formatCents(group.subtotalCents), AMOUNT_RIGHT, flow.y - 16, { size: 9, font: fonts.mediumNum })
      flow.y -= 24
      hRule(flow.page, flow.y, FRAME_LEFT, FRAME_RIGHT, BORDER)
    }
  }
  if (invoice.lines.length === 0) {
    drawText(flow.page, "No line items", LEFT, flow.y - 20, { size: 9.5, font: fonts.regular, color: MUTED_FOREGROUND })
    flow.y -= 28
  }

  // Totals.
  const totals: { label: string; value: string; strong?: boolean; rule?: boolean }[] = [
    { label: "Total", value: formatCents(invoice.totalCents), strong: true },
  ]
  if (settledCents > 0) totals.push({ label: "Payments received", value: `-${formatCents(settledCents)}` })
  totals.push({ label: status === "void" ? "Amount due (void)" : "Amount due", value: formatCents(amountDueCents), strong: true, rule: true })
  const totalsLeft = RIGHT - 230
  flow.ensure(16 + totals.length * 22 + 16)
  flow.y -= 16
  for (const row of totals) {
    if (row.rule) {
      hRule(flow.page, flow.y - 2, totalsLeft, RIGHT, BORDER)
      flow.y -= 10
    }
    drawText(flow.page, row.label, totalsLeft, flow.y - 10, {
      size: row.strong ? 10 : 9,
      font: row.strong ? fonts.medium : fonts.regular,
      color: row.strong ? FOREGROUND : MUTED_FOREGROUND,
    })
    drawRight(flow.page, row.value, RIGHT, flow.y - 10, {
      size: row.strong ? 10 : 9,
      font: row.strong ? fonts.mediumNum : fonts.regularNum,
      color: row.strong ? FOREGROUND : MUTED_FOREGROUND,
    })
    flow.y -= 22
  }
  flow.y -= 8
  hRule(flow.page, flow.y, FRAME_LEFT, FRAME_RIGHT, BORDER)

  // Payments.
  const notes = layoutNotes(fonts, invoice, status, input.voidReason ?? null)
  flow.ensure(PAD + 16 + 40)
  drawText(flow.page, "Payments", LEFT, flow.y - PAD - 8, { size: 10.5, font: fonts.medium })
  flow.y -= PAD + 8 + 12
  if (payments.length === 0) {
    const text = status === "void" ? "This invoice is void, so no payment is expected." : "No payments yet."
    drawText(flow.page, text, LEFT, flow.y - 8, { size: 9, font: fonts.regular, color: MUTED_FOREGROUND })
    flow.y -= 20
  } else {
    const ordered = [...payments].sort((a, b) => a.initiatedAt.localeCompare(b.initiatedAt))
    for (const payment of ordered) {
      const reason = payment.failureReason ? `Reason: ${payment.failureReason}` : null
      const height = 10 + 15 + 6 + 9 + (reason ? 12 : 0) + 10
      flow.ensure(height)
      const { page } = flow
      const top = flow.y
      page.drawRectangle({ x: LEFT, y: top - height, width: CONTENT, height, borderColor: BORDER, borderWidth: 0.6 })
      const view = PAYMENT_VIEW_STATUS[payment.status]
      drawBadge(page, fonts, PAYMENT_STATUS_LABEL[view], PAYMENT_TONE[payment.status], LEFT + 12 + badgeWidth(fonts, PAYMENT_STATUS_LABEL[view]), top - 10)
      const settledText = payment.settledAt && payment.status === "succeeded" ? ` · settled ${dayOfTimestamp(payment.settledAt)}` : ""
      drawText(page, `${paymentMethodLabel(payment.method)} · started ${dayOfTimestamp(payment.initiatedAt)}${settledText}`, LEFT + 12, top - 10 - 15 - 6 - 6, {
        size: 8,
        font: fonts.regularNum,
        color: MUTED_FOREGROUND,
      })
      if (reason) {
        drawText(page, fitText(fonts.regular, reason, 8, CONTENT - 150), LEFT + 12, top - 10 - 15 - 6 - 6 - 12, {
          size: 8,
          font: fonts.regular,
          color: DANGER.foreground,
        })
      }
      drawRight(page, formatCents(allocationTo(payment, invoice.id)), RIGHT - 12, top - 10 - 11, {
        size: 9.5,
        font: fonts.regularNum,
        color: payment.status === "failed" ? MUTED_FOREGROUND : FOREGROUND,
      })
      flow.y -= height
    }
    flow.y -= 8
  }
  flow.y -= PAD - 12

  // Notes.
  flow.ensure(notes.height)
  const notesTop = flow.y
  flow.page.drawRectangle({ x: FRAME_LEFT, y: notesTop - notes.height, width: FRAME_RIGHT - FRAME_LEFT, height: notes.height, color: MUTED_30 })
  hRule(flow.page, notesTop, FRAME_LEFT, FRAME_RIGHT, BORDER)
  let cursor = notesTop - 20 - 6
  for (const paragraph of notes.paragraphs) {
    paragraph.lines.forEach((text, i) => drawText(flow.page, text, LEFT, cursor - i * 11, { size: paragraph.size, font: fonts.regular, color: MUTED_FOREGROUND }))
    cursor -= paragraph.lines.length * 11 + 5
  }
  flow.y = notesTop - notes.height
  pageEnds.push(flow.y)

  doc.getPages().forEach((page, i, pages) => {
    const bottom = Math.max(pageEnds[i], 52)
    page.drawRectangle({ x: FRAME_LEFT, y: bottom, width: FRAME_RIGHT - FRAME_LEFT, height: FRAME_TOP - bottom, borderColor: BORDER, borderWidth: 0.8 })
    const left = `${NORTHWIND_ENTITY.legalName}  |  Invoice ${invoice.number}  |  Generated ${formatInZone(now, DEFAULT_TIME_ZONE).date}`
    drawText(page, fitText(fonts.regular, left, 7.5, CONTENT - 80), LEFT, 34, { size: 7.5, font: fonts.regular, color: MUTED_FOREGROUND })
    drawRight(page, `Page ${i + 1} of ${pages.length}`, RIGHT, 34, { size: 7.5, font: fonts.regularNum, color: MUTED_FOREGROUND })
  })
  return saveDeterministic(doc, now)
}

function badgeWidth(fonts: GeistFonts, label: string): number {
  return fonts.medium.widthOfTextAtSize(label, 8) + 8 + 4.5 + 5 + 4
}
