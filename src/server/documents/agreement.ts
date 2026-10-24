/**
 * Auto-generated US employment agreement. Builds the PDF from `agreement-template.ts`, then applies
 * Northwind's countersignature automatically ("Northwind EOR", timestamped) so only the worker's
 * signature is outstanding. The commercial markup is never part of this document.
 */

import { StandardFonts, rgb, type PDFDocument, type PDFFont, type PDFPage } from "pdf-lib"

import { isIsoDate, isUsStateCode, type FieldErrors } from "@/domain/forms"
import { US_2026 } from "@/domain/cost-rates"
import { BENEFIT_PACKAGES, WAGE_UNITS } from "@/domain/types"

import {
  PAY_FREQUENCIES,
  agreementSections,
  longDate,
  mergeFields,
  NORTHWIND_ENTITY,
  type EmploymentAgreementInput,
} from "./agreement-template"
import { applyEsignature, type SignedDocument } from "./esign"
import { DocumentInputError } from "./errors"
import { describeSignatureFields, type GeneratedDocument } from "./signature-fields"
import { addPlaceholderField, createPdf, saveDeterministic, toWinAnsi } from "./pdf-utils"

export { PAY_FREQUENCIES, NORTHWIND_ENTITY, type EmploymentAgreementInput, type PayFrequency } from "./agreement-template"

/** Signature fields the agreement exposes to `applyEsignature`. */
export const AGREEMENT_SIGNATURE_KEYS = { worker: "sig_worker", employer: "sig_employer" } as const

export const PAGE = { width: 612, height: 792 }
export const MARGIN = { left: 72, right: 72, top: 78, bottom: 72 }
export const CONTENT_WIDTH = PAGE.width - MARGIN.left - MARGIN.right
export const INK = rgb(0.1, 0.1, 0.1)
export const GRAY = rgb(0.42, 0.42, 0.45)

export function validateAgreementInput(input: EmploymentAgreementInput): FieldErrors {
  const errors: FieldErrors = {}
  if (!input.client?.name?.trim()) errors["client.name"] = "Client name is required."
  if (!input.worker?.fullName?.trim()) errors["worker.fullName"] = "Worker name is required."
  if (!input.role?.title?.trim()) errors["role.title"] = "Role title is required."
  const comp = input.compensation
  if (!comp || !Number.isInteger(comp.wageCents) || comp.wageCents <= 0) errors["compensation.wageCents"] = "Pay must be greater than $0."
  if (!comp || !(WAGE_UNITS as readonly string[]).includes(comp.wageUnit)) errors["compensation.wageUnit"] = "Choose hourly, monthly or annual pay."
  if (!comp || !(PAY_FREQUENCIES as readonly string[]).includes(comp.payFrequency)) errors["compensation.payFrequency"] = "Choose a pay frequency."
  if (!isUsStateCode(input.workState)) errors.workState = "Choose a valid work state."
  if (!isIsoDate(input.startDate)) errors.startDate = "Enter a valid start date."
  if (input.endDate) {
    if (!isIsoDate(input.endDate)) errors.endDate = "Enter a valid end date."
    else if (isIsoDate(input.startDate) && input.endDate <= input.startDate) errors.endDate = "The end date must be after the start date."
  }
  if (!(BENEFIT_PACKAGES as readonly string[]).includes(input.benefitsPackage)) errors.benefitsPackage = "Choose a benefits package."
  return errors
}

export class Writer {
  readonly pages: PDFPage[] = []
  page!: PDFPage
  y = 0

  constructor(
    readonly doc: PDFDocument,
    readonly body: PDFFont,
    readonly bold: PDFFont,
    readonly italic: PDFFont,
  ) {
    this.newPage()
  }

  newPage(): void {
    this.page = this.doc.addPage([PAGE.width, PAGE.height])
    this.pages.push(this.page)
    this.y = PAGE.height - MARGIN.top
  }

  ensure(height: number): void {
    if (this.y - height < MARGIN.bottom) this.newPage()
  }

  lines(text: string, font: PDFFont, size: number, width: number, firstWidth = width): string[] {
    const out: string[] = []
    let limit = firstWidth
    for (const paragraph of toWinAnsi(text).split("\n")) {
      let line = ""
      for (const word of paragraph.split(" ")) {
        const next = line ? `${line} ${word}` : word
        if (font.widthOfTextAtSize(next, size) > limit && line) {
          out.push(line)
          limit = width
          line = word
        } else line = next
      }
      out.push(line)
      limit = width
    }
    return out
  }

  /** A paragraph; `**Lead-in.** body` renders the lead-in in bold on the first line. */
  paragraph(text: string, opts: { font?: PDFFont; size?: number; leading?: number; gap?: number; x?: number; width?: number; color?: ReturnType<typeof rgb> } = {}): void {
    const font = opts.font ?? this.body
    const size = opts.size ?? 10.5
    const leading = opts.leading ?? size * 1.38
    const x = opts.x ?? MARGIN.left
    const width = opts.width ?? CONTENT_WIDTH
    const lead = /^\*\*(.+?)\*\* ([\s\S]*)$/.exec(text)
    const leadText = lead ? toWinAnsi(lead[1]) : ""
    const leadWidth = lead ? this.bold.widthOfTextAtSize(`${leadText} `, size) : 0
    const lines = this.lines(lead ? lead[2] : text, font, size, width, width - leadWidth)
    lines.forEach((line, i) => {
      this.ensure(leading)
      this.y -= leading
      if (i === 0 && lead) {
        this.page.drawText(leadText, { x, y: this.y, size, font: this.bold, color: opts.color ?? INK })
        this.page.drawText(line, { x: x + leadWidth, y: this.y, size, font, color: opts.color ?? INK })
      } else {
        this.page.drawText(line, { x, y: this.y, size, font, color: opts.color ?? INK })
      }
    })
    this.y -= opts.gap ?? 6
  }

  heading(text: string): void {
    this.ensure(48)
    this.y -= 8
    this.paragraph(text, { font: this.bold, size: 11, gap: 3 })
  }
}

export function drawKeyTerms(w: Writer, rows: [string, string][]): void {
  const rowHeight = 20
  w.ensure(rows.length * rowHeight + 20)
  const top = w.y
  w.page.drawRectangle({
    x: MARGIN.left,
    y: top - rows.length * rowHeight,
    width: CONTENT_WIDTH,
    height: rows.length * rowHeight,
    borderColor: GRAY,
    borderWidth: 0.5,
  })
  rows.forEach(([label, value], i) => {
    const y = top - (i + 1) * rowHeight
    if (i > 0) w.page.drawLine({ start: { x: MARGIN.left, y: y + rowHeight }, end: { x: MARGIN.left + CONTENT_WIDTH, y: y + rowHeight }, thickness: 0.4, color: GRAY })
    w.page.drawText(label.toUpperCase(), { x: MARGIN.left + 10, y: y + 7, size: 7.5, font: w.bold, color: GRAY })
    w.page.drawText(toWinAnsi(value), { x: MARGIN.left + 130, y: y + 6.5, size: 10, font: w.body, color: INK })
  })
  w.y = top - rows.length * rowHeight - 14
}

function drawSignatureBlocks(w: Writer, workerName: string): void {
  w.ensure(170)
  w.y -= 14
  w.page.drawText("SIGNATURES", { x: MARGIN.left, y: w.y, size: 8, font: w.bold, color: GRAY })
  w.y -= 12
  const blockWidth = 230
  const gap = CONTENT_WIDTH - 2 * blockWidth
  const columns = [
    { x: MARGIN.left, party: "NORTHWIND EOR, INC.", name: "Northwind EOR", role: "Authorized signatory", key: AGREEMENT_SIGNATURE_KEYS.employer },
    { x: MARGIN.left + blockWidth + gap, party: "EMPLOYEE", name: workerName, role: "Employee", key: AGREEMENT_SIGNATURE_KEYS.worker },
  ]
  const sigTop = w.y
  for (const col of columns) {
    w.page.drawText(col.party, { x: col.x, y: sigTop, size: 8.5, font: w.bold, color: INK })
    const rect = { x: col.x, y: sigTop - 62, width: blockWidth, height: 46 }
    w.page.drawLine({ start: { x: col.x, y: rect.y }, end: { x: col.x + blockWidth, y: rect.y }, thickness: 0.6, color: INK })
    addPlaceholderField(w.doc, w.page, col.key, rect)
    w.page.drawText(toWinAnsi(`${col.name}, ${col.role}`), { x: col.x, y: rect.y - 11, size: 8.5, font: w.body, color: GRAY })
    const dateRect = { x: col.x + 30, y: rect.y - 36, width: 110, height: 14 }
    w.page.drawText("Date:", { x: col.x, y: dateRect.y + 3, size: 9, font: w.body, color: INK })
    w.page.drawLine({ start: { x: dateRect.x, y: dateRect.y }, end: { x: dateRect.x + dateRect.width, y: dateRect.y }, thickness: 0.4, color: GRAY })
    addPlaceholderField(w.doc, w.page, `${col.key}_date`, dateRect)
  }
  w.y = sigTop - 62 - 52
}

function drawChrome(pages: PDFPage[], workerName: string, fonts: { body: PDFFont }): void {
  pages.forEach((page, i) => {
    page.drawText("NORTHWIND EOR  ·  EMPLOYMENT AGREEMENT", { x: MARGIN.left, y: PAGE.height - 44, size: 7.5, font: fonts.body, color: GRAY })
    page.drawLine({ start: { x: MARGIN.left, y: PAGE.height - 50 }, end: { x: PAGE.width - MARGIN.right, y: PAGE.height - 50 }, thickness: 0.4, color: GRAY })
    const label = `Page ${i + 1} of ${pages.length}`
    page.drawText(toWinAnsi(workerName), { x: MARGIN.left, y: 40, size: 7.5, font: fonts.body, color: GRAY })
    page.drawText(label, { x: PAGE.width - MARGIN.right - fonts.body.widthOfTextAtSize(label, 7.5), y: 40, size: 7.5, font: fonts.body, color: GRAY })
  })
}

/** Renders the unsigned agreement PDF (no countersignature). Exposed for previews and tests. */
export async function renderEmploymentAgreement(input: EmploymentAgreementInput): Promise<Uint8Array> {
  const errors = validateAgreementInput(input)
  if (Object.keys(errors).length > 0) throw new DocumentInputError("Employment agreement", errors)

  const now = input.now ?? new Date()
  const effective = now.toISOString().slice(0, 10)
  const doc = await createPdf(`Employment Agreement: ${input.worker.fullName.trim()}`, now)
  doc.setSubject("Employment Agreement")
  doc.setAuthor(input.employer?.legalName ?? NORTHWIND_ENTITY.legalName)

  const body = await doc.embedFont(StandardFonts.TimesRoman)
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold)
  const italic = await doc.embedFont(StandardFonts.TimesRomanItalic)
  const sans = await doc.embedFont(StandardFonts.Helvetica)
  const w = new Writer(doc, body, bold, italic)

  const fields = mergeFields(input, effective)
  w.y -= 4
  w.page.drawText("Employment Agreement", { x: MARGIN.left, y: w.y - 16, size: 22, font: bold, color: INK })
  w.y -= 34
  w.paragraph(`${fields["employer.legalName"]}  ·  at-will employment through an employer of record`, { font: sans, size: 9, color: GRAY, gap: 14 })

  const term = input.endDate ? `${longDate(input.startDate)} to ${longDate(input.endDate)} (fixed term)` : `Starts ${longDate(input.startDate)} (at will)`
  drawKeyTerms(w, [
    ["Employee", input.worker.fullName.trim()],
    ["Position", input.role.title.trim()],
    ["Client", input.client.name.trim()],
    ["Work state", fields["workState.name"]],
    ["Term", term],
    ["Pay", fields["compensation.amount"]],
    ["Pay frequency", fields["compensation.payFrequency"].replace(/^./, (c) => c.toUpperCase())],
    ["Benefits", US_2026.packages[input.benefitsPackage].label],
  ])

  const sections = agreementSections(input, effective)
  sections.forEach((section, index) => {
    if (index === 0) {
      section.paragraphs.forEach((p) => w.paragraph(p))
      return
    }
    w.heading(`${index}.  ${section.title}`)
    section.paragraphs.forEach((p) => w.paragraph(p, { x: MARGIN.left, width: CONTENT_WIDTH }))
  })

  w.ensure(180)
  w.paragraph("Signed by the parties on the dates shown below.", { font: italic, gap: 2 })
  drawSignatureBlocks(w, input.worker.fullName.trim())
  drawChrome(w.pages, input.worker.fullName.trim(), { body: sans })

  return saveDeterministic(doc, now)
}

/**
 * The finished agreement, countersigned by Northwind at `input.now`. Only the worker's signature
 * is missing: pass the returned `pdf` to `applyEsignature` with `fieldKey: AGREEMENT_SIGNATURE_KEYS.worker`;
 * `fields` says where the worker signs (for the signing dialog).
 */
export async function generateEmploymentAgreement(
  input: EmploymentAgreementInput,
): Promise<SignedDocument & GeneratedDocument> {
  const now = input.now ?? new Date()
  const pdf = await renderEmploymentAgreement({ ...input, now })
  const countersigned = await applyEsignature(pdf, {
    signerName: "Northwind EOR",
    signerRole: "Employer (automatic countersignature)",
    typedSignature: "Northwind EOR",
    signedAt: now,
    consent: true,
    fieldKey: AGREEMENT_SIGNATURE_KEYS.employer,
    documentTitle: `Employment Agreement: ${input.worker.fullName.trim()}`,
    ...(input.agreementId ? { documentId: input.agreementId } : {}),
  })
  const fields = await describeSignatureFields(countersigned.pdf, AGREEMENT_SIGNATURE_KEYS.worker, {
    signerRole: "Employee",
    label: "Employee signature",
  })
  return { ...countersigned, fields }
}
