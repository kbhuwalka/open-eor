/**
 * The Finance Home's wording and URL (docs/finance-portal.md §2.6, ui-guidelines C33): the date
 * under the title, the `?client=` filter, the figures line and the second line of a To do row.
 * Pure: no React, no I/O; the page passes the read models through.
 */
import type { WaitingPayment } from "@/server/finance-insights"
import type { FinanceOverview } from "@/server/finance-portal-queries"

import { plural } from "./finance-portal-view"
import { receivablesHref } from "./receivables-view"

export const HOME_PATH = "/finance"
export const PAYMENTS_PATH = "/finance/payments"
export const BILLING_PATH = "/finance/billing"
export const WAITING_LIMIT = 5

/** The Home's `?client=<companyId>`; `null` (all clients) when absent or not an id. */
export function parseHomeClient(params: Record<string, string | string[] | undefined>): string | null {
  const raw = Array.isArray(params.client) ? params.client[0] : params.client
  return raw && /^[\w-]{1,64}$/.test(raw) ? raw : null
}

/** The Home for one client, or for all of them. */
export const homeHref = (client: string | null): string => (client ? `${HOME_PATH}?client=${encodeURIComponent(client)}` : HOME_PATH)

/** Payments, narrowed to the client the Home is filtered to. */
export const paymentsHref = (client: string | null): string => (client ? `${PAYMENTS_PATH}?client=${encodeURIComponent(client)}` : PAYMENTS_PATH)

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function dayParts(day: string): { weekday: string; month: string; date: number } {
  const [y, m, d] = day.split("-").map(Number)
  return { weekday: WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()], month: MONTHS[m - 1], date: d }
}

/** "Saturday, Oct 24" for a `YYYY-MM-DD` business day. */
export function homeDateLabel(day: string): string {
  const { weekday, month, date } = dayParts(day)
  return `${weekday}, ${month} ${date}`
}

/** "Fri Oct 30". */
export function shortWeekdayDay(day: string): string {
  const { weekday, month, date } = dayParts(day)
  return `${weekday.slice(0, 3)} ${month} ${date}`
}

export type HomeFigureKey = "to-settle" | "overdue" | "ready-to-bill"

/** One figure of the line under the title: an amount (none when there is nothing) and the words after it. */
export type HomeFigure = {
  key: HomeFigureKey
  href: string
  /** The money, shown in whole dollars; `null` when there is none, and the text stands alone. */
  amountCents: number | null
  /** "to settle", "overdue", "ready to bill", or the whole sentence when there is no amount: "Nothing overdue". */
  text: string
  /** Overdue money (danger foreground). */
  danger: boolean
}

/**
 * The Home's figures line, in order: what is to settle, what is overdue and what is ready to bill
 * (or, with nothing ready, when billing is next). Each links to its page, To settle and Overdue
 * narrowed to `client` when the Home is filtered to one.
 */
export function homeFigures(overview: FinanceOverview, client: string | null = null): HomeFigure[] {
  const { toSettle, overdue, readyToBill } = overview
  const settle: HomeFigure = {
    key: "to-settle",
    href: paymentsHref(client),
    amountCents: toSettle.count > 0 ? toSettle.cents : null,
    text: toSettle.count > 0 ? "to settle" : "Nothing to settle",
    danger: false,
  }
  const late: HomeFigure = {
    key: "overdue",
    href: receivablesHref({ client }),
    amountCents: overdue.cents > 0 ? overdue.cents : null,
    text: overdue.cents > 0 ? "overdue" : "Nothing overdue",
    danger: overdue.cents > 0,
  }
  const bill: HomeFigure =
    readyToBill.count > 0
      ? { key: "ready-to-bill", href: BILLING_PATH, amountCents: readyToBill.cents, text: "ready to bill", danger: false }
      : {
          key: "ready-to-bill",
          href: BILLING_PATH,
          amountCents: null,
          text: readyToBill.nextIssueDate ? `Next billing ${shortWeekdayDay(readyToBill.nextIssueDate)}` : "No billing scheduled",
          danger: false,
        }
  return [settle, late, bill]
}

/** A To do row's title: the invoice it settles ("INV-2026-0062"), or how many ("6 invoices"). */
export function waitingTitle(payment: Pick<WaitingPayment, "invoiceCount" | "firstInvoice">): string {
  return payment.invoiceCount === 1 ? payment.firstInvoice.number : plural(payment.invoiceCount, "invoice")
}
