/**
 * Pure helpers of the Finance portal screens: the status history of an invoice, wording for void
 * reasons and the day arithmetic of the receivables drilldown. No server imports, so client
 * components and tests share them.
 */
import type { InvoiceDisplayStatus } from "@/lib/finance-view"

export type HistoryEntry = {
  key: string
  /** `YYYY-MM-DD` or an ISO timestamp; `null` when the record keeps no date (a void). */
  at: string | null
  title: string
  detail: string | null
  /** Payment the entry belongs to, for a link. */
  paymentId: string | null
  tone: "neutral" | "success" | "danger" | "info"
}

type HistoryInput = {
  issueDate: string
  displayStatus: InvoiceDisplayStatus
  voidReason: string | null
  payments: readonly {
    paymentId: string
    status: "initiated" | "succeeded" | "failed"
    initiatedAt: string
    settledAt: string | null
    failedAt: string | null
    methodLabel: string
    failureReason: string | null
  }[]
}

const VOID_REASON_LABEL: Record<string, string> = {
  order_cancelled: "Order cancelled before the deposit was paid",
}

/** Stored reasons are free text from Finance, except the code the system writes. */
export function voidReasonLabel(reason: string | null): string {
  if (!reason) return "No reason recorded"
  return VOID_REASON_LABEL[reason] ?? reason
}

/**
 * Everything that happened to an invoice, oldest first: issued, each payment's start and outcome,
 * and the void. The void carries no date because the invoice record keeps none.
 */
export function invoiceHistory(invoice: HistoryInput): HistoryEntry[] {
  const entries: HistoryEntry[] = [
    { key: "issued", at: invoice.issueDate, title: "Invoice issued", detail: null, paymentId: null, tone: "neutral" },
  ]
  for (const payment of invoice.payments) {
    entries.push({
      key: `${payment.paymentId}:initiated`,
      at: payment.initiatedAt,
      title: "Payment initiated",
      detail: payment.methodLabel,
      paymentId: payment.paymentId,
      tone: "info",
    })
    if (payment.status === "succeeded" && payment.settledAt) {
      entries.push({
        key: `${payment.paymentId}:settled`,
        at: payment.settledAt,
        title: "Payment settled",
        detail: "Invoice paid",
        paymentId: payment.paymentId,
        tone: "success",
      })
    }
    if (payment.status === "failed" && payment.failedAt) {
      entries.push({
        key: `${payment.paymentId}:failed`,
        at: payment.failedAt,
        title: "Payment failed",
        detail: payment.failureReason ? `${payment.failureReason}. Invoice payable again.` : "Invoice payable again.",
        paymentId: payment.paymentId,
        tone: "danger",
      })
    }
  }
  entries.sort((a, b) => (a.at ?? "9999").localeCompare(b.at ?? "9999") || a.key.localeCompare(b.key))
  const issued = entries.findIndex((entry) => entry.key === "issued")
  if (issued > 0) entries.unshift(...entries.splice(issued, 1))
  if (invoice.displayStatus === "void") {
    entries.push({
      key: "void",
      at: null,
      title: "Invoice voided",
      detail: voidReasonLabel(invoice.voidReason),
      paymentId: null,
      tone: "neutral",
    })
  }
  return entries
}

/** Whole days from `from` to `to` (both `YYYY-MM-DD`); positive when `to` is later. */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number)
  const [ty, tm, td] = to.split("-").map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000)
}

/** "Due in 3 days", "Due today", "12 days late". */
export function dueLabel(dueDate: string, today: string): string {
  const late = daysBetween(dueDate, today)
  if (late === 0) return "Due today"
  if (late < 0) return `Due in ${-late} ${-late === 1 ? "day" : "days"}`
  return `${late} ${late === 1 ? "day" : "days"} late`
}

export const plural = (n: number, one: string, many: string = `${one}s`): string => `${n} ${n === 1 ? one : many}`

/**
 * A dynamic route segment as the id it names. Next hands `params` over still percent-encoded, and
 * invoice ids contain colons (`payroll:hire_1:12` arrives as `payroll%3Ahire_1%3A12`).
 */
export function decodeIdParam(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
