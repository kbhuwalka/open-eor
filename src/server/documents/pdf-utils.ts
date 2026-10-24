/**
 * Shared PDF plumbing: asset loading, deterministic metadata, text sanitising for the standard
 * fonts, AcroForm helpers and hashing. No business rules.
 */

import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"
import {
  PDFDict,
  PDFDocument,
  PDFName,
  StandardFonts,
  type PDFField,
  type PDFFont,
  type PDFTextField,
  type PDFForm,
  type PDFPage,
} from "pdf-lib"
import fontkit from "@pdf-lib/fontkit"

export const PRODUCER = "Northwind EOR"
/** Fixed creation stamp for documents we author, so the same input always yields the same bytes. */
export const EPOCH = new Date("2026-01-01T00:00:00.000Z")

const cache = new Map<string, Buffer>()

/** Reads a repo asset (`assets/forms/…`, `assets/fonts/…`) once per process. */
export function readAsset(relativePath: string): Buffer {
  let bytes = cache.get(relativePath)
  if (!bytes) {
    bytes = readFileSync(path.join(process.cwd(), "assets", relativePath))
    cache.set(relativePath, bytes)
  }
  return bytes
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex")
}

/** Loads a PDF without letting pdf-lib stamp the current time into it. */
export async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  doc.registerFontkit(fontkit)
  return doc
}

export async function createPdf(title: string, now: Date): Promise<PDFDocument> {
  const doc = await PDFDocument.create({ updateMetadata: false })
  doc.registerFontkit(fontkit)
  doc.setTitle(title)
  doc.setProducer(PRODUCER)
  doc.setCreator(PRODUCER)
  doc.setCreationDate(now)
  doc.setModificationDate(now)
  return doc
}

/** An official government form from `assets/forms`, with XFA removed so pdf-lib reads the AcroForm. */
export async function loadOfficialForm(file: "fw4.pdf" | "i-9.pdf"): Promise<PDFDocument> {
  const doc = await loadPdf(readAsset(`forms/${file}`))
  const acroForm = doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict)
  acroForm?.delete(PDFName.of("XFA"))
  return doc
}

export async function saveDeterministic(doc: PDFDocument, modified: Date): Promise<Uint8Array> {
  doc.setProducer(PRODUCER)
  doc.setModificationDate(modified)
  return doc.save({ useObjectStreams: false })
}

const LATIN_FALLBACK: Record<string, string> = { Ł: "L", ł: "l", Đ: "D", đ: "d", ı: "i", Ħ: "H", ħ: "h" }

/**
 * The built-in fonts only encode WinAnsi. Decompose accents, drop what cannot be encoded, and
 * collapse whitespace so a name like "Zoë" survives and "李" degrades to "?" instead of throwing.
 */
export function toWinAnsi(text: string): string {
  const normalised = text.normalize("NFC").replace(/[\r\n\t]+/g, " ")
  let out = ""
  for (const char of normalised) {
    const code = char.codePointAt(0)!
    if (code >= 0x20 && code <= 0x7e) out += char
    else if (code >= 0xa0 && code <= 0xff) out += char
    else if (char === "’" || char === "‘") out += "'"
    else if (char === "“" || char === "”") out += '"'
    else if (char === "–" || char === "—") out += "-"
    else if (char === "•") out += "•"
    else {
      const base = LATIN_FALLBACK[char] ?? char.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      out += base !== char && /^[\x20-\x7e]+$/.test(base) ? base : "?"
    }
  }
  return out.replace(/ {2,}/g, " ").trim()
}

/** `MM/DD/YYYY` for a `YYYY-MM-DD` day; "" when blank. */
export function usDate(iso: string | undefined): string {
  if (!iso) return ""
  const [y, m, d] = iso.split("-")
  return `${m}/${d}/${y}`
}

export function formatInZone(date: Date, timeZone: string): { date: string; time: string; zone: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ""
  const hour = get("hour") === "24" ? "00" : get("hour")
  return {
    date: `${get("month")}/${get("day")}/${get("year")}`,
    time: `${hour}:${get("minute")}`,
    zone: get("timeZoneName"),
  }
}

export type TextOptions = {
  /** Largest font size to use; the text shrinks to fit the field's width down to `min`. */
  max?: number
  min?: number
}

/**
 * Writes values into AcroForm fields with Helvetica, shrinking long values to fit the field and
 * locking every field when done.
 */
export class FormFiller {
  private constructor(
    readonly doc: PDFDocument,
    readonly form: PDFForm,
    private readonly font: PDFFont,
    private readonly defaultMax: number,
  ) {}

  static async create(doc: PDFDocument, defaultMax = 10): Promise<FormFiller> {
    return new FormFiller(doc, doc.getForm(), await doc.embedFont(StandardFonts.Helvetica), defaultMax)
  }

  text(name: string, value: string | undefined, options: TextOptions = {}): void {
    const field = this.form.getTextField(name)
    const max = field.getMaxLength()
    let text = toWinAnsi(value ?? "")
    if (max !== undefined && text.length > max) text = text.slice(0, max)
    if (text === "") return
    field.setText(text)
    if (field.isMultiline()) {
      if (options.max !== undefined) {
        field.setFontSize(options.max)
        this.syncWidgetFont(field)
      }
      return
    }
    const widget = field.acroField.getWidgets()[0]
    const width = widget.getRectangle().width - 6
    const ceiling = options.max ?? this.defaultMax
    const floor = options.min ?? 5
    const natural = this.font.widthOfTextAtSize(text, ceiling)
    const size = natural <= width ? ceiling : Math.max(floor, (ceiling * width) / natural)
    field.setFontSize(Math.floor(size * 10) / 10)
    this.syncWidgetFont(field)
  }

  /** Some USCIS fields carry their own default appearance on each widget; keep them in step. */
  private syncWidgetFont(field: PDFTextField): void {
    const da = field.acroField.getDefaultAppearance()
    if (!da) return
    for (const widget of field.acroField.getWidgets()) {
      if (widget.getDefaultAppearance() !== undefined) widget.setDefaultAppearance(da)
    }
  }

  check(name: string, on: boolean): void {
    if (on) this.form.getCheckBox(name).check()
  }

  select(name: string, value: string | undefined): void {
    if (value) this.form.getDropdown(name).select(value)
  }

  /** Renders appearances, makes every field read-only and returns the bytes. */
  async save(modified: Date): Promise<Uint8Array> {
    this.form.updateFieldAppearances(this.font)
    for (const field of this.form.getFields() as PDFField[]) field.enableReadOnly()
    return saveDeterministic(this.doc, modified)
  }
}

/**
 * A read-only, invisible text field that marks where a signature or date goes. pdf-lib paints new
 * widgets white by default, which would hide the stamp drawn on the page beneath them.
 */
export function addPlaceholderField(
  doc: PDFDocument,
  page: PDFPage,
  name: string,
  rect: { x: number; y: number; width: number; height: number },
): void {
  const field = doc.getForm().createTextField(name)
  field.addToPage(page, { ...rect, borderWidth: 0 })
  field.enableReadOnly()
  for (const widget of field.acroField.getWidgets()) {
    widget.dict.delete(PDFName.of("MK"))
    widget.dict.delete(PDFName.of("AP"))
  }
}
