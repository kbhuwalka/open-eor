/**
 * Typed e-signatures on PDFs: stamps the signature (OFL script font), name and date next to the
 * signature field, appends a signature certificate page, and chains HMAC-sealed signature records
 * into the file so `verifySignedDocument` can detect edits to the audit trail.
 */

import {
  PDFDict,
  PDFHexString,
  PDFName,
  PDFString,
  StandardFonts,
  rgb,
  type PDFDocument,
  type PDFFont,
  type PDFPage,
} from "pdf-lib"

import {
  ESIGN_CONSENT_STATEMENT,
  ESIGN_STATEMENT_VERSION,
  typedNameMatches,
  type SignatureField,
  type SignatureRecord,
} from "@/domain/forms"

import { SignatureError } from "./errors"
import { formatInZone, loadPdf, readAsset, saveDeterministic, sha256Hex, toWinAnsi } from "./pdf-utils"
import { sealHmac } from "./secrets"

export const DEFAULT_TIME_ZONE = "America/New_York"

const RECORDS_KEY = PDFName.of("NorthwindSignatures")
const PAGE_SEAL_KEY = PDFName.of("NorthwindCertificateSeal")

type Rect = { x: number; y: number; width: number; height: number }

type Slot =
  | { signatureField: string; dateField: string }
  | { page: number; signature: Rect; date: Rect }

/** Known signature locations on the official forms, keyed by `fieldKey`. */
const SLOTS: Record<string, Slot> = {
  "i9.section1.employee": { signatureField: "Signature of Employee", dateField: "Today's Date mmddyyy" },
  "i9.section2.employer": { signatureField: "Signature of Employer or AR", dateField: "S2 Todays Date mmddyyyy" },
  "i9.supplementA.preparer": { signatureField: "Signature of Preparer or Translator 0", dateField: "Sig Date mmddyyyy 0" },
  // The 2026 W-4 prints Step 5 as drawn lines rather than form fields.
  "w4.employee": {
    page: 0,
    signature: { x: 102, y: 93, width: 340, height: 22 },
    date: { x: 462, y: 93, width: 100, height: 22 },
  },
}

/** `fieldKey`s the official forms understand. Company documents use their own field names. */
export const OFFICIAL_SIGNATURE_KEYS = Object.keys(SLOTS)

export type SignatureInput = {
  signerName: string
  /** Human label for the capacity in which the signer signs ("Worker", "Employer representative"). */
  signerRole: string
  /** What the signer typed; must be their name. */
  typedSignature: string
  signedAt: Date | string
  /** `true` records consent at `signedAt`; pass the timestamp when the signer ticked the box earlier. */
  consent: true | { consentedAt: Date | string }
  /** Where to sign: an official-form key (`w4.employee`, `i9.section1.employee`, …) or the name of a signature field in a company document. */
  fieldKey: string
  documentTitle?: string
  /** Only used by the first signature on a document; later ones continue the chain's id. */
  documentId?: string
  /** IANA zone for the printed local date (defaults to `America/New_York`). */
  timeZone?: string
  /**
   * The rectangles the signer clicked in the signing dialog (the `SignatureField`s a generator
   * returned). When given, the signature is stamped there instead of at the slot `fieldKey` names,
   * and `fieldKey` need not exist in the document.
   */
  fields?: {
    signature: Pick<SignatureField, "page" | "x" | "y" | "width" | "height">
    date?: Pick<SignatureField, "page" | "x" | "y" | "width" | "height">
  }
}

export type SignedDocument = {
  pdf: Uint8Array
  /** SHA-256 (hex) of `pdf`: store it next to the file to prove it has not changed. */
  sha256: string
  /** SHA-256 (hex) of the document before this signature, as printed on the certificate. */
  preSignatureSha256: string
  documentId: string
  record: SignatureRecord
}

function toDate(value: Date | string, label: string): Date {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new SignatureError("INVALID_SIGNED_AT", `${label} is not a valid timestamp.`)
  return date
}

function sealPayload(record: Omit<SignatureRecord, "seal">): string {
  return JSON.stringify([
    record.version,
    record.sequence,
    record.documentId,
    record.documentTitle,
    record.fieldKey,
    record.signerName,
    record.signerRole,
    record.typedSignature,
    record.signedAt,
    record.consentedAt,
    record.consentStatementVersion,
    record.preSignatureSha256,
    record.pagesBefore,
    record.previousSeal,
  ])
}

function infoDict(doc: PDFDocument): PDFDict {
  const info = doc.context.lookupMaybe(doc.context.trailerInfo.Info, PDFDict)
  if (info) return info
  const created = doc.context.obj({})
  doc.context.trailerInfo.Info = doc.context.register(created)
  return created
}

export function readSignatureRecords(doc: PDFDocument): SignatureRecord[] {
  const raw = infoDict(doc).lookup(RECORDS_KEY)
  const text =
    raw instanceof PDFHexString ? raw.decodeText() : raw instanceof PDFString ? raw.decodeText() : undefined
  if (!text) return []
  const parsed: unknown = JSON.parse(text)
  return Array.isArray(parsed) ? (parsed as SignatureRecord[]) : []
}

function writeSignatureRecords(doc: PDFDocument, records: SignatureRecord[]): void {
  infoDict(doc).set(RECORDS_KEY, PDFHexString.fromText(JSON.stringify(records)))
}

export function locateSlot(
  doc: PDFDocument,
  fieldKey: string,
): { page: PDFPage; signature: Rect; dateRect: Rect | null; dateField: string | null } {
  const known = SLOTS[fieldKey]
  if (known && "page" in known) {
    return { page: doc.getPage(known.page), signature: known.signature, dateRect: known.date, dateField: null }
  }
  const signatureField = known ? known.signatureField : fieldKey
  const dateField = known ? known.dateField : `${fieldKey}_date`
  const form = doc.getForm()
  let field
  try {
    field = form.getTextField(signatureField)
  } catch {
    throw new SignatureError("SIGNATURE_SLOT_NOT_FOUND", `This document has no signature field "${fieldKey}".`)
  }
  const widget = field.acroField.getWidgets()[0]
  const pageRef = widget.P()
  const page = doc.getPages().find((p) => p.ref === pageRef)
  if (!page) throw new SignatureError("SIGNATURE_SLOT_NOT_FOUND", `Signature field "${fieldKey}" is not on a page.`)
  let hasDate = true
  try {
    form.getTextField(dateField)
  } catch {
    hasDate = false
  }
  return { page, signature: widget.getRectangle(), dateRect: null, dateField: hasDate ? dateField : null }
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = []
  let line = ""
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(next, size) > width && line) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

const INK = rgb(0.08, 0.1, 0.35)
const GRAY = rgb(0.42, 0.42, 0.45)
const BLACK = rgb(0.1, 0.1, 0.1)

async function embedScript(doc: PDFDocument): Promise<PDFFont> {
  return doc.embedFont(readAsset("fonts/DancingScript.ttf"), { subset: true, customName: "DancingScript" })
}

function stamp(args: {
  page: PDFPage
  rect: Rect
  script: PDFFont
  sans: PDFFont
  typed: string
  caption: string
  shortCaption: string
}): void {
  const { page, rect, script, sans, typed } = args
  const captionSize = 5.5
  const tall = rect.height >= 28
  let scriptSize = Math.min(tall ? 24 : rect.height * 0.95, 24)
  const maxScriptWidth = tall ? rect.width - 8 : rect.width * 0.5
  const natural = script.widthOfTextAtSize(typed, scriptSize)
  if (natural > maxScriptWidth) scriptSize = (scriptSize * maxScriptWidth) / natural
  const scriptWidth = script.widthOfTextAtSize(typed, scriptSize)
  const fitsInline = (text: string) => scriptWidth + sans.widthOfTextAtSize(text, captionSize) + 16 <= rect.width
  const caption = tall || fitsInline(args.caption) ? args.caption : args.shortCaption

  if (tall) {
    page.drawText(typed, { x: rect.x + 4, y: rect.y + 11 + (rect.height - 11 - scriptSize) / 3, size: scriptSize, font: script, color: INK })
    page.drawText(caption, { x: rect.x + 4, y: rect.y + 3, size: captionSize, font: sans, color: GRAY })
    return
  }
  page.drawText(typed, { x: rect.x + 3, y: rect.y + 2.5, size: scriptSize, font: script, color: INK })
  if (fitsInline(caption)) {
    const width = sans.widthOfTextAtSize(caption, captionSize)
    page.drawText(caption, { x: rect.x + rect.width - width - 3, y: rect.y + 3, size: captionSize, font: sans, color: GRAY })
  }
}

async function appendCertificate(
  doc: PDFDocument,
  record: SignatureRecord,
  local: { date: string; time: string; zone: string },
  script: PDFFont,
): Promise<void> {
  const page = doc.addPage([612, 792])
  const sans = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const mono = await doc.embedFont(StandardFonts.Courier)
  const left = 54
  const right = 558
  let y = 738

  page.drawText("NORTHWIND EOR", { x: left, y, size: 8, font: bold, color: GRAY })
  y -= 28
  page.drawText("Certificate of Electronic Signature", { x: left, y, size: 20, font: bold, color: BLACK })
  y -= 20
  page.drawText(toWinAnsi(record.documentTitle), { x: left, y, size: 11, font: sans, color: BLACK })
  y -= 14
  page.drawText(`Document ID ${record.documentId}  ·  Signature ${record.sequence}`, { x: left, y, size: 9, font: sans, color: GRAY })
  y -= 12
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.5, color: GRAY })
  y -= 22

  const labelX = left
  const valueX = 196
  const row = (label: string, value: string, opts: { font?: PDFFont; size?: number; lines?: string[] } = {}) => {
    page.drawText(label.toUpperCase(), { x: labelX, y, size: 7.5, font: bold, color: GRAY })
    const lines = opts.lines ?? [value]
    for (const line of lines) {
      page.drawText(toWinAnsi(line), { x: valueX, y, size: opts.size ?? 10, font: opts.font ?? sans, color: BLACK })
      y -= (opts.size ?? 10) + 4
    }
    y -= 8
  }

  row("Signer", record.signerName)
  row("Capacity", record.signerRole)
  page.drawText("SIGNATURE", { x: labelX, y, size: 7.5, font: bold, color: GRAY })
  page.drawText(record.typedSignature, { x: valueX, y: y - 4, size: 26, font: script, color: INK })
  y -= 36
  row("Signature field", record.fieldKey, { font: mono, size: 9 })
  row("Signed", `${record.signedAt.replace("T", " ").replace(/\.\d+Z$/, "Z")}   (${local.date} ${local.time} ${local.zone})`)
  row("Consent recorded", record.consentedAt.replace("T", " ").replace(/\.\d+Z$/, "Z"))
  row("Document SHA-256", "", {
    font: mono,
    size: 8.5,
    lines: [record.preSignatureSha256.slice(0, 32), record.preSignatureSha256.slice(32)],
  })
  page.drawText("Fingerprint of the document exactly as the signer saw it, before this page was added.", {
    x: valueX,
    y: y + 10,
    size: 7,
    font: sans,
    color: GRAY,
  })
  y -= 4
  row("Record seal", "", {
    font: mono,
    size: 8.5,
    lines: [record.seal.slice(0, 32), record.seal.slice(32)],
  })

  y -= 4
  page.drawLine({ start: { x: left, y: y + 8 }, end: { x: right, y: y + 8 }, thickness: 0.5, color: GRAY })
  y -= 12
  page.drawText("Electronic signature disclosure and consent", { x: left, y, size: 10, font: bold, color: BLACK })
  y -= 16
  for (const line of wrap(ESIGN_CONSENT_STATEMENT, sans, 9, right - left)) {
    page.drawText(toWinAnsi(line), { x: left, y, size: 9, font: sans, color: BLACK })
    y -= 12.5
  }
  y -= 10
  const note =
    "The seal is an HMAC-SHA256 over every field of this record and the seal of the previous signature. " +
    "Northwind EOR verifies it with a key held on its servers; any change to the record, or to an earlier " +
    "signature on this document, makes verification fail."
  for (const line of wrap(note, sans, 8, right - left)) {
    page.drawText(line, { x: left, y, size: 8, font: sans, color: GRAY })
    y -= 11
  }

  page.node.set(PAGE_SEAL_KEY, PDFString.of(record.seal))
}

function checkedRect(doc: PDFDocument, field: { page: number; x: number; y: number; width: number; height: number }) {
  const page = doc.getPages()[field.page]
  const values = [field.x, field.y, field.width, field.height]
  if (!page || !values.every(Number.isFinite) || field.width <= 0 || field.height <= 0) {
    throw new SignatureError("INVALID_FIELD", "The signature field is not a valid rectangle on a page of this document.")
  }
  const { width: pageWidth, height: pageHeight } = page.getSize()
  if (field.x < 0 || field.y < 0 || field.x + field.width > pageWidth + 0.5 || field.y + field.height > pageHeight + 0.5) {
    throw new SignatureError("INVALID_FIELD", "The signature field lies outside its page.")
  }
  return { page, rect: { x: field.x, y: field.y, width: field.width, height: field.height } }
}

function resolveTarget(doc: PDFDocument, input: SignatureInput) {
  if (!input.fields) return locateSlot(doc, input.fieldKey)
  const signature = checkedRect(doc, input.fields.signature)
  let slot: ReturnType<typeof locateSlot> | null = null
  try {
    slot = locateSlot(doc, input.fieldKey)
  } catch {
    slot = null
  }
  const date = input.fields.date ? checkedRect(doc, input.fields.date) : null
  // A date widget on the form is filled as a form field; otherwise the date is drawn in its rectangle.
  const dateField = slot?.dateField ?? null
  return {
    page: signature.page,
    signature: signature.rect,
    dateRect: dateField ? null : (date?.rect ?? slot?.dateRect ?? null),
    dateField,
    datePage: date ? doc.getPages().indexOf(date.page) : doc.getPages().indexOf(signature.page),
  }
}

/**
 * Signs `pdfBytes` with a typed signature. Pure given its inputs: the same bytes, signer and
 * timestamps always produce the same output. Throws `SignatureError`.
 */
export async function applyEsignature(pdfBytes: Uint8Array, input: SignatureInput): Promise<SignedDocument> {
  if (!input.signerName.trim() || !input.signerRole.trim()) {
    throw new SignatureError("SIGNER_REQUIRED", "A signer name and role are required.")
  }
  if (!input.consent) throw new SignatureError("CONSENT_REQUIRED", "The signer must consent to sign electronically.")
  if (!typedNameMatches(input.typedSignature, input.signerName)) {
    throw new SignatureError("TYPED_NAME_MISMATCH", "The typed signature must match the signer's name.")
  }
  const signedAt = toDate(input.signedAt, "signedAt")
  const consentedAt = input.consent === true ? signedAt : toDate(input.consent.consentedAt, "consent.consentedAt")
  const timeZone = input.timeZone ?? DEFAULT_TIME_ZONE

  const preSignatureSha256 = sha256Hex(pdfBytes)
  const doc = await loadPdf(pdfBytes)
  const previous = readSignatureRecords(doc)
  const last = previous.at(-1)
  const documentId = last?.documentId ?? input.documentId ?? `NW-${preSignatureSha256.slice(0, 12).toUpperCase()}`
  const documentTitle = input.documentTitle ?? last?.documentTitle ?? doc.getTitle() ?? "Document"

  const target = resolveTarget(doc, input)
  const { page, signature, dateRect, dateField } = target
  const sans = await doc.embedFont(StandardFonts.Helvetica)
  const script = await embedScript(doc)
  const local = formatInZone(signedAt, timeZone)
  const typed = input.typedSignature.trim()
  const caption = toWinAnsi(`E-signed ${local.date} ${local.time} ${local.zone} · ${documentId}`)

  const shortCaption = toWinAnsi(`E-signed ${local.date} ${local.time} ${local.zone}`)
  stamp({ page, rect: signature, script, sans, typed, caption, shortCaption })

  if (dateField) {
    const field = doc.getForm().getTextField(dateField)
    field.setText(local.date)
    field.setFontSize(9)
    field.updateAppearances(sans)
  } else if (dateRect) {
    const datePage = "datePage" in target && target.datePage !== undefined ? doc.getPages()[target.datePage] : page
    datePage.drawText(local.date, { x: dateRect.x + 5, y: dateRect.y + 4, size: 10, font: sans, color: INK })
  }

  const unsealed: Omit<SignatureRecord, "seal"> = {
    version: 1,
    sequence: previous.length + 1,
    documentId,
    documentTitle,
    fieldKey: input.fieldKey,
    signerName: input.signerName.trim(),
    signerRole: input.signerRole.trim(),
    typedSignature: typed,
    signedAt: signedAt.toISOString(),
    consentedAt: consentedAt.toISOString(),
    consentStatementVersion: ESIGN_STATEMENT_VERSION,
    preSignatureSha256,
    pagesBefore: doc.getPageCount(),
    previousSeal: last?.seal ?? null,
  }
  const record: SignatureRecord = { ...unsealed, seal: sealHmac(sealPayload(unsealed)) }

  await appendCertificate(doc, record, local, script)
  writeSignatureRecords(doc, [...previous, record])

  const pdf = await saveDeterministic(doc, signedAt)
  return { pdf, sha256: sha256Hex(pdf), preSignatureSha256, documentId, record }
}

export type VerifiedSignature = SignatureRecord & { sealValid: boolean; certificatePresent: boolean }

export type VerificationResult = {
  /** True when there is at least one signature and every check passed. */
  valid: boolean
  signatures: VerifiedSignature[]
  /** Plain-language reasons, empty when `valid`. */
  problems: string[]
  /** SHA-256 (hex) of the bytes that were checked. */
  sha256: string
}

/**
 * Checks a signed PDF: every record's seal, the chain between records, the certificate pages, and
 * optionally the stored file hash (`expectedSha256`) and the pre-signature bytes of the latest
 * signature (`preSignaturePdf`).
 */
export async function verifySignedDocument(
  pdfBytes: Uint8Array,
  options: { expectedSha256?: string; preSignaturePdf?: Uint8Array } = {},
): Promise<VerificationResult> {
  const sha256 = sha256Hex(pdfBytes)
  const problems: string[] = []
  const signatures: VerifiedSignature[] = []

  if (options.expectedSha256 && options.expectedSha256.toLowerCase() !== sha256) {
    problems.push("The file does not match the hash recorded when it was signed.")
  }

  let doc: PDFDocument
  let records: SignatureRecord[]
  try {
    doc = await loadPdf(pdfBytes)
    records = readSignatureRecords(doc)
  } catch {
    return { valid: false, signatures, problems: ["The file is not a readable signed PDF."], sha256 }
  }
  if (records.length === 0) problems.push("The document carries no signature records.")

  const pages = doc.getPages()
  let previousSeal: string | null = null
  records.forEach((record, index) => {
    const { seal, ...rest } = record
    const sealValid = typeof seal === "string" && seal === sealHmac(sealPayload(rest))
    const page = pages[record.pagesBefore]
    const certificatePresent = (() => {
      const stored = page?.node.lookup(PAGE_SEAL_KEY)
      return stored instanceof PDFString && stored.decodeText() === seal
    })()
    signatures.push({ ...record, sealValid, certificatePresent })
    const label = `Signature ${record.sequence} (${record.signerName})`
    if (!sealValid) problems.push(`${label}: the record was altered.`)
    if (!certificatePresent) problems.push(`${label}: the certificate page is missing or was replaced.`)
    if (record.sequence !== index + 1) problems.push(`${label}: out of order.`)
    if (record.previousSeal !== previousSeal) problems.push(`${label}: does not follow the previous signature.`)
    if (record.documentId !== records[0].documentId) problems.push(`${label}: belongs to a different document.`)
    previousSeal = record.seal
  })

  const latest = records.at(-1)
  if (options.preSignaturePdf && latest && sha256Hex(options.preSignaturePdf) !== latest.preSignatureSha256) {
    problems.push("The supplied original does not match the fingerprint on the latest certificate.")
  }
  if (latest && pages.length < latest.pagesBefore + 1) problems.push("Pages were removed after signing.")

  return { valid: records.length > 0 && problems.length === 0, signatures, problems, sha256 }
}

