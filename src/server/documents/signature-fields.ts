import type { PDFDocument } from "pdf-lib"

import type { SignatureField } from "@/domain/forms"

import { locateSlot } from "./esign"
import { loadPdf } from "./pdf-utils"

/** A generated PDF plus the places its next signer has to sign. */
export type GeneratedDocument = {
  pdf: Uint8Array
  /** Signature and date fields for the next signer (see `SignatureField`). */
  fields: SignatureField[]
}

export type DescribeOptions = {
  /** Capacity of the person who will sign ("Employee", "Employer representative"). */
  signerRole: string
  /** Shown on the tag, e.g. "Employee signature". */
  label: string
}

function widgetPlacement(doc: PDFDocument, fieldName: string): { page: number; x: number; y: number; width: number; height: number } | null {
  let widget
  try {
    widget = doc.getForm().getTextField(fieldName).acroField.getWidgets()[0]
  } catch {
    return null
  }
  const pageRef = widget.P()
  const page = doc.getPages().findIndex((p) => p.ref === pageRef)
  if (page < 0) return null
  return { page, ...widget.getRectangle() }
}

/**
 * The signature and date places `applyEsignature` would stamp for `fieldKey`, as `SignatureField`s in
 * PDF points from the bottom-left of the page: the AcroForm widget rectangles for the official forms
 * and company documents, the fixed coordinates for the W-4's drawn Step 5 lines.
 */
export async function describeSignatureFields(pdfBytes: Uint8Array, fieldKey: string, options: DescribeOptions): Promise<SignatureField[]> {
  const doc = await loadPdf(pdfBytes)
  const slot = locateSlot(doc, fieldKey)
  const pages = doc.getPages()
  const signature: SignatureField = {
    id: `${fieldKey}:signature`,
    page: pages.indexOf(slot.page),
    ...slot.signature,
    kind: "signature",
    required: true,
    label: options.label,
    signerRole: options.signerRole,
    fieldKey,
  }
  const fields: SignatureField[] = [signature]

  const dateBase = {
    id: `${fieldKey}:date`,
    kind: "date" as const,
    required: false,
    label: "Date signed",
    signerRole: options.signerRole,
    linkedTo: signature.id,
  }
  if (slot.dateField) {
    const placement = widgetPlacement(doc, slot.dateField)
    if (placement) fields.push({ ...dateBase, ...placement })
  } else if (slot.dateRect) {
    fields.push({ ...dateBase, page: signature.page, ...slot.dateRect })
  }
  return fields
}
