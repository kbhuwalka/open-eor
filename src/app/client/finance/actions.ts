"use server"

/**
 * Client Finance Server Actions (acl §6): `requireRole` first, identity from the session only
 * (the client id is `session.clientCompanyId`, never a form value), input narrowed, then the
 * `FinanceDataSource` seam. Failures come back as `ActionResult`.
 */
import { revalidatePath } from "next/cache"

import { requireRole } from "@/auth"
import { parseInvoiceIds, type InvoiceDetail } from "@/lib/finance-view"
import { fail, toActionError, type ActionResult } from "@/server/action-result"
import { financeQueries, type PayInvoicesError } from "@/server/finance-queries"

export type PayInvoicesData = {
  paymentId: string
  invoiceIds: string[]
  totalCents: number
}

const PAY_ERROR_MESSAGE: Record<PayInvoicesError, string> = {
  NOT_AVAILABLE: "Online payment is not available yet. Your invoices have not been changed.",
  NO_PAYMENT_METHOD: "There is no payment method on file. Contact your Northwind account manager.",
  EMPTY_SELECTION: "Choose at least one invoice to pay.",
  UNKNOWN_INVOICE: "One of those invoices could not be found. Refresh the page and try again.",
  MIXED_COMPANIES: "One of those invoices could not be found. Refresh the page and try again.",
  VOID_INVOICE: "One of those invoices was voided. Refresh the page and try again.",
  ALREADY_PAID: "One of those invoices is already paid. Refresh the page and try again.",
  ALREADY_PROCESSING: "One of those invoices already has a payment in progress.",
}

export async function payInvoicesAction(invoiceIds: unknown): Promise<ActionResult<PayInvoicesData>> {
  try {
    const user = await requireRole("client_hr")
    if (!user.clientCompanyId) return fail("forbidden", "Only client users can pay invoices.")
    const ids = parseInvoiceIds(invoiceIds)
    if (!ids) return fail("validation", "Choose at least one invoice to pay.", { field: "invoiceIds" })

    const result = await financeQueries.payInvoices(user.clientCompanyId, ids, {
      userId: user.id,
      displayName: user.displayName,
    })
    if (!result.ok) {
      return fail("validation", PAY_ERROR_MESSAGE[result.error], {
        error: result.error,
        invoiceIds: result.invoiceIds,
      })
    }
    revalidatePath("/client/finance")
    revalidatePath("/client/people/[caseId]", "page")
    return {
      ok: true,
      data: { paymentId: result.paymentId, invoiceIds: result.invoiceIds, totalCents: result.totalCents },
    }
  } catch (error) {
    return toActionError(error)
  }
}

export async function getInvoiceDetailAction(invoiceId: unknown): Promise<InvoiceDetail | null> {
  const user = await requireRole("client_hr")
  if (!user.clientCompanyId || typeof invoiceId !== "string" || invoiceId === "") return null
  return financeQueries.getInvoiceDetail(user.clientCompanyId, invoiceId)
}
