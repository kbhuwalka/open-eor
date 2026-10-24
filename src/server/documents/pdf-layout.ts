/**
 * Layout helpers for Northwind's flowing, table-based PDFs (invoices, pay slips): fonts, colours,
 * right-aligned and wrapped text, a page cursor that starts a new page on overflow, and page
 * footers. Text goes through `toWinAnsi` because the standard fonts only encode WinAnsi.
 */

import { StandardFonts, degrees, rgb, type PDFDocument, type PDFFont, type PDFPage, type RGB } from "pdf-lib"

import { toWinAnsi } from "./pdf-utils"

export const LETTER = { width: 612, height: 792 } as const
export const MARGIN = 54
export const CONTENT_WIDTH = LETTER.width - MARGIN * 2
export const RIGHT = LETTER.width - MARGIN

export const INK = rgb(0.1, 0.1, 0.1)
export const GRAY = rgb(0.42, 0.42, 0.45)
export const RULE = rgb(0.82, 0.82, 0.85)
export const BAND = rgb(0.95, 0.95, 0.97)
export const BRAND = rgb(0.09, 0.2, 0.42)

export type Fonts = { sans: PDFFont; bold: PDFFont; mono: PDFFont }

export async function embedFonts(doc: PDFDocument): Promise<Fonts> {
  return {
    sans: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    mono: await doc.embedFont(StandardFonts.Courier),
  }
}

type DrawOptions = { size?: number; font: PDFFont; color?: RGB }

export function drawText(page: PDFPage, text: string, x: number, y: number, { size = 9.5, font, color = INK }: DrawOptions): void {
  const safe = toWinAnsi(text)
  if (safe) page.drawText(safe, { x, y, size, font, color })
}

export function drawRight(page: PDFPage, text: string, right: number, y: number, { size = 9.5, font, color = INK }: DrawOptions): void {
  const safe = toWinAnsi(text)
  if (safe) page.drawText(safe, { x: right - font.widthOfTextAtSize(safe, size), y, size, font, color })
}

/** Shortens `text` with an ellipsis so it fits `maxWidth`. */
export function fitText(font: PDFFont, text: string, size: number, maxWidth: number): string {
  const safe = toWinAnsi(text)
  if (font.widthOfTextAtSize(safe, size) <= maxWidth) return safe
  let out = safe
  while (out.length > 1 && font.widthOfTextAtSize(`${out}...`, size) > maxWidth) out = out.slice(0, -1)
  return `${out.trimEnd()}...`
}

/** Greedy word wrap; a single word wider than the column is kept whole. */
export function wrapText(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ""
  for (const word of toWinAnsi(text).split(" ")) {
    const next = line ? `${line} ${word}` : word
    if (line && font.widthOfTextAtSize(next, size) > maxWidth) {
      lines.push(line)
      line = word
    } else line = next
  }
  if (line) lines.push(line)
  return lines
}

export function hRule(page: PDFPage, y: number, from = MARGIN, to = RIGHT, color = RULE, thickness = 0.6): void {
  page.drawLine({ start: { x: from, y }, end: { x: to, y }, thickness, color })
}

/** Small uppercase caption used above values and as table headings. */
export function caption(page: PDFPage, fonts: Fonts, text: string, x: number, y: number): void {
  drawText(page, text.toUpperCase(), x, y, { size: 7, font: fonts.bold, color: GRAY })
}

/**
 * Large translucent word across the page ("PAID", "VOID"); drawn under the content so tables stay
 * legible.
 */
export function drawWatermark(page: PDFPage, fonts: Fonts, text: string, color: RGB): void {
  const size = 110
  const width = fonts.bold.widthOfTextAtSize(text, size)
  const angle = 40
  const rad = (angle * Math.PI) / 180
  const cx = LETTER.width / 2
  const cy = LETTER.height / 2 - 20
  page.drawText(text, {
    x: cx - (width / 2) * Math.cos(rad),
    y: cy - (width / 2) * Math.sin(rad),
    size,
    font: fonts.bold,
    color,
    opacity: 0.1,
    rotate: degrees(angle),
  })
}

/** A rounded status pill whose right edge sits at `right`; returns its left edge. */
export function drawPill(page: PDFPage, fonts: Fonts, label: string, right: number, y: number, color: RGB): number {
  const size = 8.5
  const text = toWinAnsi(label.toUpperCase())
  const textWidth = fonts.bold.widthOfTextAtSize(text, size)
  const width = textWidth + 20
  const x = right - width
  page.drawRectangle({ x, y: y - 5, width, height: 18, color, opacity: 0.12, borderColor: color, borderWidth: 0.8 })
  page.drawText(text, { x: x + 10, y: y + 0.5, size, font: fonts.bold, color })
  return x
}

export type FlowOptions = {
  /** Lowest y content may reach before a new page starts (leaves room for the footer). */
  bottom: number
  /** Where the cursor starts on a continuation page; the callback below may move it lower. */
  top: number
  /** Called after each new page is added, to draw a running header; returns the cursor y. */
  onNewPage?: (page: PDFPage, pageNumber: number) => number | void
  /** Called on every page including the first, before any content (watermarks). */
  onEveryPage?: (page: PDFPage) => void
}

/** A vertical cursor over a growing document. */
export class Flow {
  page: PDFPage
  y: number
  private count = 1

  constructor(
    readonly doc: PDFDocument,
    private readonly options: FlowOptions,
    firstY: number,
  ) {
    this.page = doc.addPage([LETTER.width, LETTER.height])
    options.onEveryPage?.(this.page)
    this.y = firstY
  }

  get pageNumber(): number {
    return this.count
  }

  newPage(): void {
    this.page = this.doc.addPage([LETTER.width, LETTER.height])
    this.count += 1
    this.options.onEveryPage?.(this.page)
    this.y = this.options.onNewPage?.(this.page, this.count) ?? this.options.top
  }

  /**
   * Makes room for `height` points below the cursor, starting a new page if needed. `onBreak`
   * runs on the new page (to repeat a table header). Returns whether a break happened.
   */
  ensure(height: number, onBreak?: () => void): boolean {
    if (this.y - height >= this.options.bottom) return false
    this.newPage()
    onBreak?.()
    return true
  }
}

/** Draws "left text    Page n of N" on every page once the page count is known. */
export function drawFooters(doc: PDFDocument, fonts: Fonts, left: string): void {
  const pages = doc.getPages()
  pages.forEach((page, i) => {
    hRule(page, 46)
    drawText(page, fitText(fonts.sans, left, 7.5, CONTENT_WIDTH - 80), MARGIN, 33, { size: 7.5, font: fonts.sans, color: GRAY })
    drawRight(page, `Page ${i + 1} of ${pages.length}`, RIGHT, 33, { size: 7.5, font: fonts.sans, color: GRAY })
  })
}
