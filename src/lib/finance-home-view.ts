/**
 * The Finance Home's wording (docs/finance-portal.md §2.6, ui-guidelines C33): the date under the
 * title, the three action tiles, the second line of a "Waiting on you" row and the clients under
 * "Who owes us". Pure: no React, no I/O; the page passes the read models through.
 */
import type { ClientAgeingRow, WaitingPayment } from "@/server/finance-insights"
import type { FinanceOverview } from "@/server/finance-portal-queries"

import { formatCents } from "./format"
import { plural, waitAge } from "./finance-portal-view"
import { depositNote } from "./finance-staff-view"
import { daysLabel, RECEIVABLES_PATH } from "./receivables-view"

export const PAYMENTS_PATH = "/finance/payments"
export const BILLING_PATH = "/finance/billing"
export const WAITING_LIMIT = 5
export const TOP_OVERDUE_CLIENTS = 3

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

export type HomeTileKey = "to-settle" | "overdue" | "ready-to-bill"

export type HomeTile = {
  key: HomeTileKey
  label: string
  href: string
  /** The figure: "5 payments · $95,566.46", "None". */
  value: string
  /** The amount is overdue money (danger foreground). */
  valueDanger: boolean
  /** One line of context under the figure: "oldest 3 days", "next billing Fri Oct 30". */
  context: string
  /** The context says something is late (danger foreground). */
  contextDanger: boolean
  /** The tile's call to action. */
  action: string
  /** Run billing is its own button (to Billing run) only while something is ready to bill. */
  actionButton: boolean
}

/** The three tiles of the Home, in order: To settle, Overdue, Ready to bill. */
export function homeTiles(overview: FinanceOverview): HomeTile[] {
  const { toSettle, overdue, readyToBill } = overview
  const wait = toSettle.oldestInitiatedAt ? waitAge(toSettle.oldestInitiatedAt, overview.today) : null
  const settleTile: HomeTile = {
    key: "to-settle",
    label: "To settle",
    href: PAYMENTS_PATH,
    value: toSettle.count > 0 ? `${plural(toSettle.count, "payment")} · ${formatCents(toSettle.cents)}` : "None",
    valueDanger: false,
    context: wait ? (wait.label === "today" ? "oldest started today" : `oldest ${wait.label}`) : "Nothing waiting on you",
    contextDanger: wait?.late ?? false,
    action: "View payments",
    actionButton: false,
  }
  const overdueTile: HomeTile = {
    key: "overdue",
    label: "Overdue",
    href: RECEIVABLES_PATH,
    value: overdue.count > 0 ? `${formatCents(overdue.cents)} across ${plural(overdue.count, "invoice")}` : "None",
    valueDanger: overdue.cents > 0,
    context: overdue.oldestDays !== null ? `oldest ${daysLabel(overdue.oldestDays)}` : "No invoice is past due",
    contextDanger: false,
    action: "View receivables",
    actionButton: false,
  }
  const ready = readyToBill.count > 0
  const billTile: HomeTile = {
    key: "ready-to-bill",
    label: "Ready to bill",
    href: BILLING_PATH,
    value: ready ? `${plural(readyToBill.count, "invoice")} · ${formatCents(readyToBill.cents)}` : "None",
    valueDanger: false,
    context: ready
      ? "due and not issued yet"
      : readyToBill.nextIssueDate
        ? `next billing ${shortWeekdayDay(readyToBill.nextIssueDate)}`
        : "No billing scheduled",
    contextDanger: false,
    action: ready ? "Run billing" : "View billing run",
    actionButton: ready,
  }
  return [settleTile, overdueTile, billTile]
}

/**
 * The muted second line of a "Waiting on you" row: a deposit first ("Deposit · starts Nov 2 · Dev
 * Petrova"), else the one invoice and its person ("INV-2026-0062 · Noah Carter") or "6 invoices".
 */
export function waitingDetail(payment: Pick<WaitingPayment, "invoiceCount" | "firstInvoice" | "deposit">): string {
  const covers = payment.invoiceCount === 1 ? null : plural(payment.invoiceCount, "invoice")
  if (payment.deposit) return [depositNote(payment.deposit), covers ?? payment.deposit.personName].join(" · ")
  return covers ?? `${payment.firstInvoice.number} · ${payment.firstInvoice.personName}`
}

/** The clients owing the most overdue money, most first; only clients with something overdue. */
export function topOverdueClients(clients: readonly ClientAgeingRow[], limit: number = TOP_OVERDUE_CLIENTS): ClientAgeingRow[] {
  return clients
    .filter((client) => client.overdueCents > 0)
    .sort((a, b) => b.overdueCents - a.overdueCents || a.companyName.localeCompare(b.companyName))
    .slice(0, limit)
}
