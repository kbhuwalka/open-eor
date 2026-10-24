/**
 * Adapter between the invoice download route and the invoice PDF generator (`src/server/documents`).
 * The generator prints from the domain objects it is given; nothing is recomputed here.
 */

import { generateInvoicePdf, type InvoicePdfInput } from "@/server/documents"

export type InvoicePdf = { bytes: Uint8Array; filename: string }

export function invoicePdfFilename(invoiceNumber: string): string {
  return `${invoiceNumber}.pdf`
}

export async function renderInvoicePdf(input: InvoicePdfInput): Promise<InvoicePdf> {
  return { bytes: await generateInvoicePdf(input), filename: invoicePdfFilename(input.invoice.number) }
}
