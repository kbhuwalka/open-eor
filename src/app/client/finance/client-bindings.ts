/**
 * The client portal's bindings for the finance components: the server actions adapted to the
 * shapes the components take, and the PDF route. Shared by the Finance page and the person
 * Payments tab so both pay and download the same way. Links that open an invoice are
 * `invoiceDrawerHref` (`src/lib/invoice-links.ts`).
 */

import type { PayOutcome } from "@/lib/finance-view"

import { getInvoiceDetailAction, payInvoicesAction } from "./actions"

/** Starts one payment; a refusal keeps the action's user-safe message and its machine code. */
export async function payInvoices(invoiceIds: string[]): Promise<PayOutcome> {
  const result = await payInvoicesAction(invoiceIds)
  if (result.ok) return { ok: true, ...result.data }
  const code = typeof result.details?.error === "string" ? result.details.error : result.code
  return { ok: false, message: result.message, code }
}

export const loadInvoiceDetail = getInvoiceDetailAction

export const invoicePdfHref = (invoiceId: string) => `/client/finance/invoices/${encodeURIComponent(invoiceId)}/pdf`
