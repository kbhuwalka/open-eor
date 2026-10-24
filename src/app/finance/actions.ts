"use server"

/**
 * Finance portal Server Actions (acl §6): `requireRole("finance")` first, identity from the session
 * only, ids and reasons narrowed, then the billing operations in `src/server/billing.ts`, which
 * authorize the actor again and apply every effect (invoice paid, `confirm_deposit` resolved) inside
 * one transaction. Failures come back as `ActionResult`.
 */
import { revalidatePath } from "next/cache"

import { requireRole, type SessionUser } from "@/auth"
import { getDb } from "@/db"
import {
  failPayment,
  markDepositNotReceived,
  markDepositReceived,
  runBilling,
  settlePayment,
  voidInvoice,
} from "@/server/billing"
import { fail, toActionError, type ActionResult } from "@/server/action-result"
import type { CaseServiceDeps } from "@/server/deps"

const MAX_BULK = 100
const MAX_REASON = 300

function deps(): CaseServiceDeps {
  return { db: getDb(), now: () => new Date() }
}

function refresh(): void {
  revalidatePath("/finance", "layout")
  revalidatePath("/client", "layout")
}

function id(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" && value.length <= 120 ? value : null
}

function reasonOf(value: unknown): string | null {
  if (typeof value !== "string") return null
  const text = value.trim()
  return text !== "" && text.length <= MAX_REASON ? text : null
}

const ok = <T,>(data: T): ActionResult<T> => ({ ok: true, data })

async function asFinance<T>(run: (user: SessionUser) => ActionResult<T>): Promise<ActionResult<T>> {
  try {
    const result = run(await requireRole("finance"))
    if (result.ok) refresh()
    return result
  } catch (error) {
    return toActionError(error)
  }
}

export async function settlePaymentAction(paymentId: unknown): Promise<ActionResult<{ paymentId: string }>> {
  return asFinance((user) => {
    const pid = id(paymentId)
    if (!pid) return fail("validation", "Choose a payment to settle.", { field: "paymentId" })
    return ok(settlePayment(deps(), { actor: user, paymentId: pid }))
  })
}

export type BulkSettleResult = {
  settled: string[]
  failed: { paymentId: string; message: string }[]
}

/**
 * Settles each payment in its own transaction so one that is no longer waiting does not hold back
 * the rest; the result lists both sides. Nothing settled at all is an error.
 */
export async function settlePaymentsAction(paymentIds: unknown): Promise<ActionResult<BulkSettleResult>> {
  try {
    const user = await requireRole("finance")
    const ids = Array.isArray(paymentIds) ? [...new Set(paymentIds.map(id))] : []
    if (ids.length === 0 || ids.length > MAX_BULK || ids.some((value) => value === null)) {
      return fail("validation", "Choose between 1 and 100 payments to settle.", { field: "paymentIds" })
    }
    const result: BulkSettleResult = { settled: [], failed: [] }
    for (const paymentId of ids as string[]) {
      try {
        settlePayment(deps(), { actor: user, paymentId })
        result.settled.push(paymentId)
      } catch (error) {
        const outcome = toActionError(error)
        if (outcome.ok) throw error
        result.failed.push({ paymentId, message: outcome.message })
      }
    }
    refresh()
    if (result.settled.length === 0) {
      return fail("ILLEGAL_TRANSITION", result.failed[0]?.message ?? "Nothing was settled.", { failed: result.failed })
    }
    return { ok: true, data: result }
  } catch (error) {
    return toActionError(error)
  }
}

export async function failPaymentAction(paymentId: unknown, reason: unknown): Promise<ActionResult<{ paymentId: string }>> {
  return asFinance((user) => {
    const pid = id(paymentId)
    if (!pid) return fail("validation", "Choose a payment to mark as failed.", { field: "paymentId" })
    const why = reasonOf(reason)
    if (!why) return fail("validation", `Say why the payment failed (up to ${MAX_REASON} characters).`, { field: "reason" })
    return ok(failPayment(deps(), { actor: user, paymentId: pid, reason: why }))
  })
}

export async function markDepositReceivedAction(caseId: unknown): Promise<ActionResult<{ caseId: string }>> {
  return asFinance((user) => {
    const cid = id(caseId)
    if (!cid) return fail("validation", "Choose an order.", { field: "caseId" })
    return ok(markDepositReceived(deps(), { actor: user, caseId: cid }))
  })
}

/** Fails the client's in-flight deposit payment. The reason is optional; empty text means none. */
export async function markDepositNotReceivedAction(
  caseId: unknown,
  reason?: unknown,
): Promise<ActionResult<{ caseId: string; paymentId: string }>> {
  return asFinance((user) => {
    const cid = id(caseId)
    if (!cid) return fail("validation", "Choose an order.", { field: "caseId" })
    const text = typeof reason === "string" ? reason.trim() : ""
    if (text.length > MAX_REASON) return fail("validation", `Keep the reason under ${MAX_REASON} characters.`, { field: "reason" })
    return ok(markDepositNotReceived(deps(), { actor: user, caseId: cid, ...(text ? { reason: text } : {}) }))
  })
}

export async function voidInvoiceAction(invoiceId: unknown, reason: unknown): Promise<ActionResult<{ invoiceId: string }>> {
  return asFinance((user) => {
    const iid = id(invoiceId)
    if (!iid) return fail("validation", "Choose an invoice to void.", { field: "invoiceId" })
    const why = reasonOf(reason)
    if (!why) return fail("validation", `Say why the invoice is void (up to ${MAX_REASON} characters).`, { field: "reason" })
    return ok(voidInvoice(deps(), { actor: user, invoiceId: iid, reason: why }))
  })
}

export type BillingRunSummary = {
  today: string
  invoices: number
  payrollInvoices: number
  depositInvoices: number
  payslips: number
  totalCents: number
}

/** Runs the billing run for today. Idempotent: a second press issues nothing. */
export async function runBillingAction(): Promise<ActionResult<BillingRunSummary>> {
  return asFinance(() => {
    const result = runBilling(deps())
    return ok({
      today: result.today,
      invoices: result.invoices.length,
      payrollInvoices: result.invoices.filter((invoice) => invoice.kind === "payroll").length,
      depositInvoices: result.invoices.filter((invoice) => invoice.kind === "deposit").length,
      payslips: result.payrollEntries,
      totalCents: result.invoices.reduce((total, invoice) => total + invoice.totalCents, 0),
    })
  })
}
