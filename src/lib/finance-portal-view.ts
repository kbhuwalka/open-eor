/**
 * Pure helpers of the Finance portal screens: the status history of an invoice, wording for void
 * reasons, how long a payment has waited, compact money and the day arithmetic of the receivables
 * drilldown. No server imports, so client components and tests share them.
 */
import { addBusinessDays, toIsoDate } from "@/domain/business-days"
import { BUSINESS_TIME_ZONE, businessDayOf } from "@/domain/business-time"
import { formatIsoDay, formatIsoShortDay } from "@/lib/finance-format"
import type { InvoiceDisplayStatus, PaymentViewStatus } from "@/lib/finance-view"

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
    status: PaymentViewStatus
    initiatedAt: string
    settledAt: string | null
    failedAt?: string | null
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
    if (payment.status === "settled" && payment.settledAt) {
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

/** A payment that has waited longer than this many business days to settle reads as late. */
export const SETTLE_WAIT_BUSINESS_DAYS = 3

export type SettleWait = {
  /** "Oct 21 · 3 days", "Oct 24 · today". */
  label: string
  /** Waiting more than `SETTLE_WAIT_BUSINESS_DAYS` business days. */
  late: boolean
}

function localDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number)
  return new Date(y, m - 1, d)
}

export type WaitAge = {
  /** The business day the payment started. */
  started: string
  /** Calendar days since then: "3 days", "today". */
  label: string
  /** The last business day Finance can settle it without being late (`YYYY-MM-DD`). */
  due: string
  late: boolean
}

/** How long a payment started at `initiatedAt` has waited as of `today`, and whether that is late. */
export function waitAge(initiatedAt: string, today: string): WaitAge {
  const started = businessDayOf(initiatedAt)
  const days = Math.max(0, daysBetween(started, today))
  const due = toIsoDate(addBusinessDays(localDate(started), SETTLE_WAIT_BUSINESS_DAYS))
  return { started, label: days === 0 ? "today" : plural(days, "day"), due, late: today > due }
}

/** The day a payment started (its business day) and how long it has waited as of `today` (`YYYY-MM-DD`). */
export function settleWait(initiatedAt: string, today: string): SettleWait {
  const age = waitAge(initiatedAt, today)
  return { label: `${formatIsoShortDay(age.started)} · ${age.label}`, late: age.late }
}

const compactMillions = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 })
const compactThousands = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 0 })
const wholeDollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })

/** "$1.2M", "$84K", "$950": a summary figure, never an amount someone acts on. */
export function formatCompactCents(cents: number): string {
  const dollars = Math.round(cents / 100)
  return (Math.abs(dollars) >= 1_000_000 ? compactMillions : compactThousands).format(dollars)
}

/** "$41,200": a total on a button, rounded to the dollar; the confirm dialog states it to the cent. */
export function formatWholeDollars(cents: number): string {
  return wholeDollars.format(Math.round(cents / 100))
}

const time = new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TIME_ZONE, hour: "numeric", minute: "2-digit" })

/** "Oct 21, 2026 · 2:14 PM" for a timestamp (business time zone), "Oct 21, 2026" for a day. */
export function formatHistoryWhen(at: string): string {
  return at.length > 10 ? `${formatIsoDay(at)} · ${time.format(new Date(at))}` : formatIsoDay(at)
}

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
