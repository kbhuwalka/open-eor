/**
 * The Receivables page's URL state and view models (docs/finance-portal.md §2.5, ui-guidelines
 * C32). The By age bar list filters the invoice table (`?bucket=`) and the header's Client filter
 * narrows everything (`?client=`); the two combine. By age is drawn from the book filtered by the
 * selected client only, so its own bars never move when one is clicked. Every row is a link that
 * toggles `?bucket=`, keeps the other parameters and resets the page. Money in flight is not owed:
 * it is never a row, only a figure. Pure: no React, no I/O.
 */
import type { AgeingBucket, BucketTotal } from "@/server/billing-queries"
import type { AgeingTotals, ClientAgeing, ClientAgeingRow } from "@/server/finance-insights"

import { percentOf, type BarListRow, type BarTone } from "./finance-chart-view"
import { daysBetween, formatCompactCents, plural } from "./finance-portal-view"
import { formatCents } from "./format"
import { DEFAULT_PAGE_SIZE, isPageSize, type PageSize } from "./pagination"

export const RECEIVABLES_PATH = "/finance/receivables"
/** Money in flight is a payment waiting to settle: it lives on Payments. */
export const IN_FLIGHT_HREF = "/finance/payments"

/** Mirrors the server's `AGEING_BUCKETS` (type-checked), so client components never import the server module. */
export const RECEIVABLES_BUCKETS = ["current", "days1to30", "days31to60", "days60plus"] as const satisfies readonly AgeingBucket[]

/** The `?bucket=` value of each bucket; the Finance Home's ageing bar writes the same values. */
export const BUCKET_PARAM: Record<AgeingBucket, string> = {
  current: "current",
  days1to30: "1-30",
  days31to60: "31-60",
  days60plus: "60-plus",
}

/** Row and chip label. */
export const BUCKET_LABEL: Record<AgeingBucket, string> = {
  current: "Current",
  days1to30: "1–30 days late",
  days31to60: "31–60 days late",
  days60plus: "60+ days late",
}

/** Spoken form, for accessible names. */
export const BUCKET_SPOKEN: Record<AgeingBucket, string> = {
  current: "Current, not yet due",
  days1to30: "1 to 30 days late",
  days31to60: "31 to 60 days late",
  days60plus: "More than 60 days late",
}

/** Status hues that get heavier as money gets later; never the brand colour. */
export const BUCKET_TONE: Record<AgeingBucket, BarTone> = {
  current: "neutral",
  days1to30: "caution",
  days31to60: "alert",
  days60plus: "critical",
}

// ── URL state ───────────────────────────────────────────────────────

type RawParams = Record<string, string | string[] | undefined>

const first = (raw: string | string[] | undefined): string | undefined => (Array.isArray(raw) ? raw[0] : raw)

export type ReceivablesQuery = {
  bucket: AgeingBucket | null
  /** Company id. */
  client: string | null
  page: number
  size: PageSize
}

/** The bucket of `?bucket=`; `null` when absent or not one of `BUCKET_PARAM`'s values. */
export function parseBucketParam(raw: string | string[] | undefined): AgeingBucket | null {
  const value = first(raw)
  return RECEIVABLES_BUCKETS.find((key) => BUCKET_PARAM[key] === value) ?? null
}

/** Never throws: an unknown bucket, a malformed client id, a bad page or size falls back to the default. */
export function parseReceivablesQuery(params: RawParams): ReceivablesQuery {
  const client = first(params.client)
  const page = Number.parseInt(first(params.page) ?? "", 10)
  const size = Number.parseInt(first(params.size) ?? "", 10)
  return {
    bucket: parseBucketParam(params.bucket),
    client: client && /^[\w-]{1,64}$/.test(client) ? client : null,
    page: Number.isFinite(page) && page > 1 ? page : 1,
    size: isPageSize(size) ? size : DEFAULT_PAGE_SIZE,
  }
}

/** A `?client=` that owes nothing (or is unknown) is ignored, like any other unknown value. */
export function withKnownClient(query: ReceivablesQuery, ageing: ClientAgeing): ReceivablesQuery {
  if (query.client === null) return query
  const owes = ageing.clients.some((client) => client.companyId === query.client && client.outstandingCents > 0)
  return owes ? query : { ...query, client: null }
}

/** The request's parameters as a query string, for links that change one of them. */
export function searchOf(params: RawParams): string {
  const search = new URLSearchParams()
  for (const [key, raw] of Object.entries(params)) {
    if (raw === undefined) continue
    for (const value of Array.isArray(raw) ? raw : [raw]) search.append(key, value)
  }
  return search.toString()
}

/**
 * The Receivables URL after `change`: a bucket or client set, or removed with `null`. Every other
 * parameter of `current` is kept (the page size included) and the page goes back to the first.
 */
export function receivablesHref(change: { bucket?: AgeingBucket | null; client?: string | null } = {}, current: string = ""): string {
  const params = new URLSearchParams(current.startsWith("?") ? current.slice(1) : current)
  params.delete("page")
  if (change.bucket !== undefined) {
    if (change.bucket) params.set("bucket", BUCKET_PARAM[change.bucket])
    else params.delete("bucket")
  }
  if (change.client !== undefined) {
    if (change.client) params.set("client", change.client)
    else params.delete("client")
  }
  const text = params.toString()
  return text ? `${RECEIVABLES_PATH}?${text}` : RECEIVABLES_PATH
}

/** The Finance Home's ageing bar: each bucket opens Receivables on it; money in flight opens Payments. */
export function bucketSegmentHrefs(): Record<AgeingBucket | "inFlight", string> {
  return {
    ...(Object.fromEntries(RECEIVABLES_BUCKETS.map((key) => [key, receivablesHref({ bucket: key })])) as Record<AgeingBucket, string>),
    inFlight: IN_FLIGHT_HREF,
  }
}

export const hasReceivablesFilters = (query: Pick<ReceivablesQuery, "bucket" | "client">): boolean =>
  query.bucket !== null || query.client !== null

// ── The book, filtered ──────────────────────────────────────────────

const ZERO: BucketTotal = { count: 0, cents: 0 }

/** What `query.bucket` holds of these totals, or all of it: the amount owed and its overdue part. */
function owedOf(totals: AgeingTotals, bucket: AgeingBucket | null): { cents: number; count: number; overdueCents: number } {
  if (bucket === null) return { cents: totals.outstandingCents, count: totals.invoiceCount, overdueCents: totals.overdueCents }
  const part = totals.buckets[bucket] ?? ZERO
  return { cents: part.cents, count: part.count, overdueCents: bucket === "current" ? 0 : part.cents }
}

function clientOf(ageing: ClientAgeing, companyId: string | null): ClientAgeingRow | null {
  return companyId === null ? null : (ageing.clients.find((client) => client.companyId === companyId) ?? null)
}

export type ReceivablesFigures = {
  outstandingCents: number
  overdueCents: number
  invoiceCount: number
  /** The book's money in flight; `null` while a filter is on, because it is not an invoice figure and does not follow them. */
  inFlightCents: number | null
}

/** The figures line: what the filtered book owes and its overdue part, plus the book's money in flight when nothing is filtered. */
export function receivablesFigures(ageing: ClientAgeing, query: Pick<ReceivablesQuery, "bucket" | "client">): ReceivablesFigures {
  const client = clientOf(ageing, query.client)
  const owed = owedOf(client ?? ageing.bookAgeing, query.bucket)
  return {
    outstandingCents: owed.cents,
    overdueCents: owed.overdueCents,
    invoiceCount: owed.count,
    inFlightCents: hasReceivablesFilters(query) ? null : ageing.bookAgeing.inFlight.cents,
  }
}

const scaled = (rows: Omit<BarListRow, "scale">[]): BarListRow[] => {
  const max = Math.max(0, ...rows.map((row) => row.cents))
  return rows.map((row) => ({ ...row, scale: max > 0 ? row.cents / max : 0 }))
}

/** "1 to 30 days late: $217,021.45, 36 invoices, selected". */
function rowName(spoken: string, cents: number, count: number, selected: boolean): string {
  return `${spoken}: ${formatCents(cents)}, ${plural(count, "invoice")}${selected ? ", selected" : ""}`
}

/**
 * By age: the four buckets of the book filtered by the selected client (not by the selected
 * bucket, so these bars stay put when one is clicked). A row toggles `?bucket=`; an empty row
 * links nowhere unless it is the selected one, which must stay clearable.
 */
export function bucketRows(ageing: ClientAgeing, query: Pick<ReceivablesQuery, "bucket" | "client">, current: string = ""): BarListRow[] {
  const source = clientOf(ageing, query.client) ?? ageing.bookAgeing
  return scaled(
    RECEIVABLES_BUCKETS.map((key) => {
      const { cents, count } = source.buckets[key] ?? ZERO
      const selected = query.bucket === key
      return {
        key,
        label: BUCKET_LABEL[key],
        cents,
        count,
        segments: [{ tone: BUCKET_TONE[key], cents }],
        selected,
        href: cents > 0 || selected ? receivablesHref({ bucket: selected ? null : key }, current) : null,
        name: rowName(BUCKET_SPOKEN[key], cents, count, selected),
      }
    }),
  )
}

/** The By age heading's takeaway: how much of the book is late ("62% overdue of $350K outstanding"). */
export function ageTakeaway(rows: readonly BarListRow[]): string {
  const owed = rows.reduce((total, row) => total + row.cents, 0)
  if (owed === 0) return "Nothing is owed."
  const late = rows.filter((row) => row.key !== "current").reduce((total, row) => total + row.cents, 0)
  return `${percentOf(late, owed)}% overdue of ${formatCompactCents(owed)} outstanding`
}

/** The clients the Client filter offers: those that owe something, by name. */
export function owingClients(ageing: ClientAgeing): { id: string; name: string }[] {
  return ageing.clients
    .filter((client) => client.outstandingCents > 0)
    .map((client) => ({ id: client.companyId, name: client.companyName }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export type ReceivablesChip = { key: "bucket"; label: string; href: string }

/** The selected age as a removable chip; the client is the header filter's, so it has none. */
export function receivablesChips(query: Pick<ReceivablesQuery, "bucket">, current: string = ""): ReceivablesChip[] {
  return query.bucket ? [{ key: "bucket", label: BUCKET_LABEL[query.bucket], href: receivablesHref({ bucket: null }, current) }] : []
}

/** The age filter off, the client and other parameters kept. */
export const clearedReceivablesHref = (current: string = ""): string => receivablesHref({ bucket: null }, current)

// ── Rows of the table ───────────────────────────────────────────────

/** The chase order: the oldest due date first, ties by invoice number. */
export function compareChaseOrder(a: { dueDate: string; number: string }, b: { dueDate: string; number: string }): number {
  return a.dueDate.localeCompare(b.dueDate) || a.number.localeCompare(b.number)
}

export type DaysLate = { days: number; label: string; late: boolean }

/** How an unpaid invoice stands against its due date today: "17 days late", "1 day late", "due today", "in 6 days". */
export function daysLate(dueDate: string, today: string): DaysLate {
  const days = daysBetween(dueDate, today)
  if (days > 0) return { days, label: `${daysLabel(days)} late`, late: true }
  if (days === 0) return { days, label: "due today", late: false }
  return { days, label: `in ${daysLabel(-days)}`, late: false }
}

/** "1 day", "12 days". */
export const daysLabel = (days: number): string => plural(days, "day")
