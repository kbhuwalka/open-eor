/**
 * Direct deposit authorization: a Northwind company form (not a government form). Account and
 * routing numbers are printed in full because this PDF is generated server-side for payroll.
 */

import { StandardFonts, rgb, type PDFDocument, type PDFFont, type PDFPage } from "pdf-lib"

import { validateDirectDeposit, type DirectDepositData } from "@/domain/forms"
import { formatDollars } from "@/domain/forms"

import { DocumentInputError } from "./errors"
import { addPlaceholderField, createPdf, saveDeterministic, toWinAnsi } from "./pdf-utils"
import { NORTHWIND_ENTITY } from "./agreement-template"
import { describeSignatureFields, type GeneratedDocument } from "./signature-fields"

/** Signature field exposed to `applyEsignature`. */
export const DIRECT_DEPOSIT_SIGNATURE_KEY = "sig_worker"

const INK = rgb(0.1, 0.1, 0.1)
const GRAY = rgb(0.42, 0.42, 0.45)
const LEFT = 60
const WIDTH = 492

export type DirectDepositOptions = {
  employee: { fullName: string }
  employerName?: string
  now?: Date
}

function labelled(page: PDFPage, fonts: { sans: PDFFont; bold: PDFFont; mono: PDFFont }, label: string, value: string, x: number, y: number, width: number, mono = false): void {
  page.drawText(label.toUpperCase(), { x, y: y + 16, size: 7, font: fonts.bold, color: GRAY })
  page.drawText(toWinAnsi(value), { x, y: y + 3, size: 11, font: mono ? fonts.mono : fonts.sans, color: INK })
  page.drawLine({ start: { x, y }, end: { x: x + width, y }, thickness: 0.4, color: GRAY })
}

function checkbox(page: PDFPage, x: number, y: number, checked: boolean, label: string, fonts: { sans: PDFFont; bold: PDFFont }): void {
  page.drawRectangle({ x, y, width: 9, height: 9, borderColor: INK, borderWidth: 0.8 })
  if (checked) {
    page.drawLine({ start: { x: x + 1.8, y: y + 1.8 }, end: { x: x + 7.2, y: y + 7.2 }, thickness: 1.1, color: INK })
    page.drawLine({ start: { x: x + 1.8, y: y + 7.2 }, end: { x: x + 7.2, y: y + 1.8 }, thickness: 1.1, color: INK })
  }
  page.drawText(label, { x: x + 15, y: y + 0.5, size: 10, font: checked ? fonts.bold : fonts.sans, color: INK })
}

function paragraph(page: PDFPage, font: PDFFont, text: string, x: number, y: number, width: number, size = 9.5, leading = 13): number {
  let line = ""
  let cursor = y
  for (const word of toWinAnsi(text).split(" ")) {
    const next = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(next, size) > width && line) {
      page.drawText(line, { x, y: cursor, size, font, color: INK })
      cursor -= leading
      line = word
    } else line = next
  }
  if (line) {
    page.drawText(line, { x, y: cursor, size, font, color: INK })
    cursor -= leading
  }
  return cursor
}

/**
 * One-page direct deposit authorization. Sign it with
 * `applyEsignature(pdf, { fieldKey: DIRECT_DEPOSIT_SIGNATURE_KEY, … })`. Throws `DocumentInputError`.
 */
export async function buildDirectDepositAuthorization(
  data: DirectDepositData,
  options: DirectDepositOptions,
): Promise<GeneratedDocument> {
  const errors = validateDirectDeposit(data)
  if (Object.keys(errors).length > 0) throw new DocumentInputError("Direct deposit", errors)

  const now = options.now ?? new Date()
  const employer = options.employerName ?? NORTHWIND_ENTITY.legalName
  const doc: PDFDocument = await createPdf(`Direct Deposit Authorization: ${options.employee.fullName}`, now)
  doc.setSubject("Direct Deposit Authorization")
  const page = doc.addPage([612, 792])
  const sans = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const mono = await doc.embedFont(StandardFonts.Courier)
  const fonts = { sans, bold, mono }
  let y = 720

  page.drawText("NORTHWIND EOR", { x: LEFT, y, size: 8, font: bold, color: GRAY })
  y -= 28
  page.drawText("Direct Deposit Authorization", { x: LEFT, y, size: 21, font: bold, color: INK })
  y -= 18
  page.drawText(toWinAnsi(`Employer: ${employer}`), { x: LEFT, y, size: 10, font: sans, color: GRAY })
  y -= 12
  page.drawLine({ start: { x: LEFT, y }, end: { x: LEFT + WIDTH, y }, thickness: 0.5, color: GRAY })

  y -= 56
  page.drawText("1. EMPLOYEE", { x: LEFT, y: y + 34, size: 8.5, font: bold, color: INK })
  labelled(page, fonts, "Employee", options.employee.fullName, LEFT, y, WIDTH)

  y -= 66
  page.drawText("2. ACCOUNT", { x: LEFT, y: y + 34, size: 8.5, font: bold, color: INK })
  labelled(page, fonts, "Bank name", data.bankName.trim(), LEFT, y, 240)
  labelled(page, fonts, "Name on account", data.accountHolderName.trim(), LEFT + 262, y, 230)
  y -= 38
  labelled(page, fonts, "Routing number (ABA)", data.routingNumber.trim(), LEFT, y, 240, true)
  labelled(page, fonts, "Account number", data.accountNumber.trim(), LEFT + 262, y, 230, true)
  y -= 30
  page.drawText("ACCOUNT TYPE", { x: LEFT, y: y + 14, size: 7, font: bold, color: GRAY })
  checkbox(page, LEFT, y, data.accountType === "checking", "Checking", fonts)
  checkbox(page, LEFT + 110, y, data.accountType === "savings", "Savings", fonts)

  y -= 52
  page.drawText("3. AMOUNT", { x: LEFT, y: y + 24, size: 8.5, font: bold, color: INK })
  checkbox(page, LEFT, y + 6, data.allocation === "entire_net_pay", "Deposit my entire net pay into this account", fonts)
  const fixed = data.allocation === "fixed_amount"
  checkbox(page, LEFT, y - 12, fixed, fixed ? `Deposit $${formatDollars(data.fixedAmountCents)} each pay period; the rest goes to my default method of payment` : "Deposit a fixed amount each pay period; the rest goes to my default method of payment", fonts)

  y -= 56
  page.drawText("4. AUTHORIZATION", { x: LEFT, y: y + 18, size: 8.5, font: bold, color: INK })
  y = paragraph(
    page,
    sans,
    `I authorize ${employer} ("Northwind") and its payroll processor to deposit my net pay by electronic funds transfer (ACH) into the account above, and, if a deposit is made in error, to withdraw the amount of the error from the same account. This authorization stays in effect until I cancel it in writing or Northwind has reason to end it, and Northwind needs a reasonable time to act on any change. I confirm that I am an owner of the account and that the information above is accurate. Northwind may pay me by another method if a deposit cannot be completed.`,
    LEFT,
    y,
    WIDTH,
  )

  y -= 22
  const sig = { x: LEFT, y: y - 46, width: 300, height: 46 }
  page.drawText("EMPLOYEE SIGNATURE", { x: LEFT, y: y + 2, size: 7, font: bold, color: GRAY })
  page.drawLine({ start: { x: sig.x, y: sig.y }, end: { x: sig.x + sig.width, y: sig.y }, thickness: 0.6, color: INK })
  page.drawText("DATE", { x: LEFT + 332, y: y + 2, size: 7, font: bold, color: GRAY })
  const dateRect = { x: LEFT + 332, y: sig.y, width: 120, height: 20 }
  page.drawLine({ start: { x: dateRect.x, y: dateRect.y }, end: { x: dateRect.x + dateRect.width, y: dateRect.y }, thickness: 0.6, color: INK })
  addPlaceholderField(doc, page, DIRECT_DEPOSIT_SIGNATURE_KEY, sig)
  addPlaceholderField(doc, page, `${DIRECT_DEPOSIT_SIGNATURE_KEY}_date`, dateRect)

  page.drawText("Northwind use only: verified against pre-note or bank letter  ____    Initials  ______", { x: LEFT, y: 64, size: 8, font: sans, color: GRAY })
  page.drawText("Account and routing numbers on this form are confidential payroll information.", { x: LEFT, y: 50, size: 8, font: sans, color: GRAY })

  const pdf = await saveDeterministic(doc, now)
  const fields = await describeSignatureFields(pdf, DIRECT_DEPOSIT_SIGNATURE_KEY, { signerRole: "Employee", label: "Employee signature" })
  return { pdf, fields }
}
