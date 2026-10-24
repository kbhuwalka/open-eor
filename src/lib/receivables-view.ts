/**
 * The Receivables dashboard's URL state and view models (docs/finance-portal.md §2.5,
 * ui-guidelines C32). Two bar lists filter the invoice table: By age (`?bucket=`) and By client
 * (`?client=`). The two combine, and each chart is drawn from the book filtered by the other
 * chart's selection only (a crossfilter), so a chart's own bars never move when it is clicked.
 * Every row is a link that toggles its own parameter, keeps the others and resets the page. Money
 * in flight is not owed: it is never a row, only a figure. Pure: no React, no I/O.
 */
import type { AgeingBucket, BucketTotal } from "@/server/billing-queries"
import type { AgeingTotals, ClientAgeing, ClientAgeingRow } from "@/server/finance-insights"

import type { BarListRow, BarTone } from "./finance-chart-view"
import { daysBetween, plural } from "./finance-portal-view"
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

/** By client shows this many rows at most; past it the smallest fold into one "N others" row. */
export const CLIENT_ROW_LIMIT = 6

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

/** "Acme Robotics: $140,579.02, $109,238.55 overdue, 21 invoices, selected". */
function clientRowName(name: string, cents: number, overdueCents: number, count: number, selected: boolean): string {
  const overdue = overdueCents > 0 ? `${formatCents(overdueCents)} overdue` : "nothing overdue"
  return `${name}: ${formatCents(cents)}, ${overdue}, ${plural(count, "invoice")}${selected ? ", selected" : ""}`
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

/**
 * By client: what each client owes in the book filtered by the selected bucket, largest first, as
 * two parts (overdue, then not yet due). More than `limit` clients keep the largest `limit - 1`
 * and fold the rest into one "N others" row that links nowhere; the selected client is never
 * folded away, so it can always be cleared.
 */
export function clientRows(
  ageing: ClientAgeing,
  query: Pick<ReceivablesQuery, "bucket" | "client">,
  current: string = "",
  limit: number = CLIENT_ROW_LIMIT,
): BarListRow[] {
  const rows = ageing.clients
    .map((client) => {
      const owed = owedOf(client, query.bucket)
      const selected = query.client === client.companyId
      return {
        key: client.companyId,
        label: client.companyName,
        cents: owed.cents,
        count: owed.count,
        segments: [
          { tone: "alert" as const, cents: owed.overdueCents },
          { tone: "neutral" as const, cents: owed.cents - owed.overdueCents },
        ],
        selected,
        href: owed.cents > 0 || selected ? receivablesHref({ client: selected ? null : client.companyId }, current) : null,
        name: clientRowName(client.companyName, owed.cents, owed.overdueCents, owed.count, selected),
      }
    })
    .filter((row) => row.cents > 0 || row.selected)
    .sort((a, b) => b.cents - a.cents || a.label.localeCompare(b.label))

  if (rows.length <= limit) return scaled(rows)
  const shown = rows.slice(0, limit - 1)
  const rest = rows.slice(limit - 1)
  const pinned = rest.find((row) => row.selected)
  const folded = rest.filter((row) => !row.selected)
  if (pinned) shown.push(pinned)
  const sum = (pick: (row: (typeof rows)[number]) => number) => folded.reduce((total, row) => total + pick(row), 0)
  const cents = sum((row) => row.cents)
  const overdue = sum((row) => row.segments[0].cents)
  const count = sum((row) => row.count)
  const label = plural(folded.length, "other")
  return scaled([
    ...shown,
    {
      key: "others",
      label,
      cents,
      count,
      segments: [
        { tone: "alert", cents: overdue },
        { tone: "neutral", cents: cents - overdue },
      ],
      selected: false,
      href: null,
      folded: true,
      name: clientRowName(label, cents, overdue, count, false),
    },
  ])
}

export type ReceivablesChip = { key: "bucket" | "client"; label: string; href: string }

/** One removable chip per selection, By age first; each chip's link removes only its own filter. */
export function receivablesChips(ageing: ClientAgeing, query: Pick<ReceivablesQuery, "bucket" | "client">, current: string = ""): ReceivablesChip[] {
  const chips: ReceivablesChip[] = []
  if (query.bucket) chips.push({ key: "bucket", label: BUCKET_LABEL[query.bucket], href: receivablesHref({ bucket: null }, current) })
  if (query.client) {
    chips.push({ key: "client", label: clientOf(ageing, query.client)?.companyName ?? "Unknown client", href: receivablesHref({ client: null }, current) })
  }
  return chips
}

/** Both filters off, the other parameters kept. */
export const clearedReceivablesHref = (current: string = ""): string => receivablesHref({ bucket: null, client: null }, current)

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
