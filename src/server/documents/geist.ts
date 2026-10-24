/**
 * Geist, the web app's typeface (`src/app/layout.tsx`), embedded in PDFs so a document set in it
 * looks like the page it mirrors. The TTFs live in `assets/fonts` with their OFL license.
 *
 * Geist's digits are proportional by default. The `Num` variants switch on the `tnum` feature so
 * columns of amounts line up, the PDF counterpart of Tailwind's `tabular-nums`.
 */

import type { PDFDocument, PDFFont } from "pdf-lib"

import { readAsset } from "./pdf-utils"

export type GeistFonts = {
  regular: PDFFont
  medium: PDFFont
  semibold: PDFFont
  regularNum: PDFFont
  mediumNum: PDFFont
  semiboldNum: PDFFont
}

const WEIGHTS = { regular: "Regular", medium: "Medium", semibold: "SemiBold" } as const

export async function embedGeist(doc: PDFDocument): Promise<GeistFonts> {
  const embed = (weight: (typeof WEIGHTS)[keyof typeof WEIGHTS], tabular: boolean) =>
    doc.embedFont(new Uint8Array(readAsset(`fonts/Geist-${weight}.ttf`)), {
      subset: true,
      customName: `Geist-${weight}${tabular ? "-Tabular" : ""}`,
      features: tabular ? { tnum: true } : undefined,
    })
  return {
    regular: await embed(WEIGHTS.regular, false),
    medium: await embed(WEIGHTS.medium, false),
    semibold: await embed(WEIGHTS.semibold, false),
    regularNum: await embed(WEIGHTS.regular, true),
    mediumNum: await embed(WEIGHTS.medium, true),
    semiboldNum: await embed(WEIGHTS.semibold, true),
  }
}
