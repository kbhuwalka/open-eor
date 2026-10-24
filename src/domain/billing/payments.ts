/**
 * Invoice status and the payment lifecycle. Pure and derived: an invoice stores only `open` or
 * `void`; whether it is paid, processing or overdue follows from the payments against it and
 * today's date, so a failed payment returns its invoices to payable without touching them.
 */

import { DomainError } from "../types"
import type {
  Invoice,
  InvoiceDisplayStatus,
  Payment,
  PaymentAllocation,
  SavedPaymentMethod,
} from "./types"

function allocatedTo(invoiceId: string, payments: readonly Payment[], status: Payment["status"]): number {
  let total = 0
  for (const payment of payments) {
    if (payment.status !== status) continue
    for (const allocation of payment.allocations) {
      if (allocation.invoiceId === invoiceId) total += allocation.amountCents
    }
  }
  return total
}

/** How payments cover an invoice, ignoring failed ones. */
export function paymentCoverage(invoice: Invoice, payments: readonly Payment[]): "paid" | "processing" | null {
  if (allocatedTo(invoice.id, payments, "succeeded") >= invoice.totalCents) return "paid"
  if (allocatedTo(invoice.id, payments, "initiated") > 0) return "processing"
  return null
}

/**
 * `void`, else `paid` (a succeeded payment covers it), else `processing` (covered by an initiated
 * payment), else `overdue` (due before `today`, an ISO day), else `open`.
 */
export function invoiceDisplayStatus(
  invoice: Invoice,
  payments: readonly Payment[],
  today: string,
): InvoiceDisplayStatus {
  if (invoice.status === "void") return "void"
  const coverage = paymentCoverage(invoice, payments)
  if (coverage) return coverage
  return invoice.dueDate < today ? "overdue" : "open"
}

/** Can still be paid: open or overdue, and not already in a payment that is paid or in flight. */
export function isPayable(invoice: Invoice, payments: readonly Payment[]): boolean {
  return invoice.status === "open" && paymentCoverage(invoice, payments) === null
}

export type PaymentSelectionError =
  | "EMPTY_SELECTION"
  | "UNKNOWN_INVOICE"
  | "MIXED_COMPANIES"
  | "VOID_INVOICE"
  | "ALREADY_PAID"
  | "ALREADY_PROCESSING"

export type PaymentSelectionResult =
  | { ok: true; companyId: string; invoiceIds: string[]; totalCents: number }
  | { ok: false; code: PaymentSelectionError; invoiceIds: string[] }

/**
 * Checks that `selectedIds` can be paid together: at least one, every one a known invoice, all of
 * one company, and none void, paid, or already in an initiated payment. Duplicate ids count once.
 */
export function validatePaymentSelection(
  invoices: readonly Invoice[],
  payments: readonly Payment[],
  selectedIds: readonly string[],
): PaymentSelectionResult {
  const ids = [...new Set(selectedIds)]
  if (ids.length === 0) return { ok: false, code: "EMPTY_SELECTION", invoiceIds: [] }

  const byId = new Map(invoices.map((invoice) => [invoice.id, invoice]))
  const unknown = ids.filter((id) => !byId.has(id))
  if (unknown.length > 0) return { ok: false, code: "UNKNOWN_INVOICE", invoiceIds: unknown }

  const selected = ids.map((id) => byId.get(id) as Invoice)
  if (new Set(selected.map((invoice) => invoice.companyId)).size > 1) {
    return { ok: false, code: "MIXED_COMPANIES", invoiceIds: ids }
  }

  const rejected = (code: PaymentSelectionError, test: (invoice: Invoice) => boolean): PaymentSelectionResult | null => {
    const hits = selected.filter(test).map((invoice) => invoice.id)
    return hits.length > 0 ? { ok: false, code, invoiceIds: hits } : null
  }
  const failure =
    rejected("VOID_INVOICE", (invoice) => invoice.status === "void") ??
    rejected("ALREADY_PAID", (invoice) => paymentCoverage(invoice, payments) === "paid") ??
    rejected("ALREADY_PROCESSING", (invoice) => paymentCoverage(invoice, payments) === "processing")
  if (failure) return failure

  return {
    ok: true,
    companyId: selected[0].companyId,
    invoiceIds: ids,
    totalCents: selected.reduce((total, invoice) => total + invoice.totalCents, 0),
  }
}

export type InitiatePaymentInput = {
  id: string
  invoices: readonly Invoice[]
  payments: readonly Payment[]
  selectedIds: readonly string[]
  method: SavedPaymentMethod | null
  now: Date
}

/** Validates the selection and, if payable, starts a payment that allocates each invoice in full. */
export function initiatePayment(
  input: InitiatePaymentInput,
): { ok: true; payment: Payment } | Extract<PaymentSelectionResult, { ok: false }> {
  const selection = validatePaymentSelection(input.invoices, input.payments, input.selectedIds)
  if (!selection.ok) return selection
  const byId = new Map(input.invoices.map((invoice) => [invoice.id, invoice]))
  const allocations: PaymentAllocation[] = selection.invoiceIds.map((invoiceId) => ({
    invoiceId,
    amountCents: (byId.get(invoiceId) as Invoice).totalCents,
  }))
  return {
    ok: true,
    payment: {
      id: input.id,
      companyId: selection.companyId,
      status: "initiated",
      method: input.method,
      allocations,
      totalCents: selection.totalCents,
      initiatedAt: input.now.toISOString(),
      settledAt: null,
      failedAt: null,
      failureReason: null,
    },
  }
}

function assertInitiated(payment: Payment, to: Payment["status"]): void {
  if (payment.status !== "initiated") {
    throw new DomainError("ILLEGAL_TRANSITION", { entity: "payment", paymentId: payment.id, from: payment.status, to })
  }
}

/** The payment cleared: its invoices read as paid. Only an initiated payment can settle. */
export function settlePayment(payment: Payment, now: Date): Payment {
  assertInitiated(payment, "succeeded")
  return { ...payment, status: "succeeded", settledAt: now.toISOString(), failedAt: null, failureReason: null }
}

/** The payment did not clear: its invoices are payable again. Only an initiated payment can fail. */
export function failPayment(payment: Payment, reason: string, now: Date): Payment {
  assertInitiated(payment, "failed")
  return { ...payment, status: "failed", settledAt: null, failedAt: now.toISOString(), failureReason: reason }
}
