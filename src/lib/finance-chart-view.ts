/**
 * View models and pure helpers of the Finance charts (`src/components/finance-portal/charts/`,
 * ui-guidelines §5.8): the plain props each chart takes, the takeaway sentences and the axis and
 * segment labels. The read models in `src/server/finance-insights.ts` return shapes these types
 * accept as they are, so a server page passes them straight through. No React, no I/O.
 */
import type { AgeingBucket } from "@/server/billing-queries"

import { formatCents, formatCompactCents } from "./format"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function dayParts(iso: string): { month: string; day: number } {
  const [, m, d] = iso.split("-").map(Number)
  return { month: MONTHS[m - 1], day: d }
}

/** "Oct 16". */
export function shortDay(iso: string): string {
  const { month, day } = dayParts(iso)
  return `${month} ${day}`
}

/** "Oct 5–18" within a month, "Sep 28–Oct 11" across one: the period on a chart axis. */
export function shortPeriodLabel(start: string, end: string): string {
  const a = dayParts(start)
  const b = dayParts(end)
  return a.month === b.month ? `${a.month} ${a.day}–${b.day}` : `${a.month} ${a.day}–${b.month} ${b.day}`
}

/** Whole percent, rounded down so an unfinished share never reads 100%. */
export function percentOf(part: number, whole: number): number {
  if (whole <= 0) return 0
  return Math.floor((part / whole) * 100)
}

// ── Billed vs collected ─────────────────────────────────────────────

export const DEFAULT_CHART_PERIODS = 8

/** One pay period of `BilledVsCollectedChart`. `PeriodBilling` from the read model fits as is. */
export type BilledCollectedPoint = {
  periodIndex: number
  start: string
  end: string
  billedCents: number
  collectedCents: number
  /** Paid by the client, not settled yet; shown in the tooltip when above zero. */
  inFlightCents?: number
}

/** "$896K collected of $1.1M billed (79%) · $38.5K in flight"; "Nothing billed yet." when empty. */
export function collectionTakeaway(periods: readonly BilledCollectedPoint[]): string {
  const billed = periods.reduce((total, period) => total + period.billedCents, 0)
  const collected = periods.reduce((total, period) => total + period.collectedCents, 0)
  const inFlight = periods.reduce((total, period) => total + (period.inFlightCents ?? 0), 0)
  if (billed === 0) return "Nothing billed yet."
  const line = `${formatCompactCents(collected)} collected of ${formatCompactCents(billed)} billed (${percentOf(collected, billed)}%)`
  return inFlight > 0 ? `${line} · ${formatCompactCents(inFlight)} in flight` : line
}

export function hasBilling(periods: readonly BilledCollectedPoint[]): boolean {
  return periods.some((period) => period.billedCents > 0 || period.collectedCents > 0)
}

// ── Ageing ──────────────────────────────────────────────────────────

/** The ageing buckets in display order, then money in flight. */
export const AGEING_SEGMENTS = ["current", "days1to30", "days31to60", "days60plus", "inFlight"] as const satisfies readonly (AgeingBucket | "inFlight")[]
export type AgeingSegmentKey = (typeof AGEING_SEGMENTS)[number]

export const AGEING_SEGMENT_LABELS: Record<AgeingSegmentKey, string> = {
  current: "Current",
  days1to30: "1–30 days",
  days31to60: "31–60 days",
  days60plus: "60+ days",
  inFlight: "In flight",
}

/** Spoken form: the visible labels abbreviate "overdue". */
export const AGEING_SEGMENT_SPOKEN: Record<AgeingSegmentKey, string> = {
  current: "Current",
  days1to30: "1 to 30 days overdue",
  days31to60: "31 to 60 days overdue",
  days60plus: "More than 60 days overdue",
  inFlight: "In flight",
}

/** What `AgeingBar` takes. `AgeingTotals` and `Receivables` fit as they are. */
export type AgeingInput = {
  buckets: Record<AgeingBucket, { cents: number }>
  /** Omit to leave the In flight segment out. */
  inFlight?: { cents: number } | null
}

export type AgeingSegment = {
  key: AgeingSegmentKey
  label: string
  cents: number
  /** Share of the bar (0 to 1); the segments of a non-empty bar add up to 1. */
  share: number
  /** Where the segment starts (0 to 1). */
  offset: number
}

/** Segments in display order, zero segments included (they have no width). */
export function ageingSegments(input: AgeingInput): AgeingSegment[] {
  const cents = (key: AgeingSegmentKey) => (key === "inFlight" ? (input.inFlight?.cents ?? 0) : input.buckets[key].cents)
  const keys = AGEING_SEGMENTS.filter((key) => key !== "inFlight" || input.inFlight != null)
  const total = keys.reduce((sum, key) => sum + cents(key), 0)
  let offset = 0
  return keys.map((key) => {
    const share = total > 0 ? cents(key) / total : 0
    const segment = { key, label: AGEING_SEGMENT_LABELS[key], cents: cents(key), share, offset }
    offset += share
    return segment
  })
}

export function overdueCentsOf(input: AgeingInput): number {
  return input.buckets.days1to30.cents + input.buckets.days31to60.cents + input.buckets.days60plus.cents
}

/** "$217K overdue of $259K outstanding · $95.6K in flight"; "Nothing is overdue · …" when none is. */
export function ageingTakeaway(input: AgeingInput): string {
  const outstanding = input.buckets.current.cents + overdueCentsOf(input)
  const inFlight = input.inFlight?.cents ?? 0
  const flying = inFlight > 0 ? ` · ${formatCompactCents(inFlight)} in flight` : ""
  if (outstanding === 0) return inFlight > 0 ? `Nothing outstanding${flying}` : "Nothing outstanding."
  const overdue = overdueCentsOf(input)
  if (overdue === 0) return `Nothing is overdue · ${formatCompactCents(outstanding)} not yet due${flying}`
  return `${formatCompactCents(overdue)} overdue of ${formatCompactCents(outstanding)} outstanding${flying}`
}

/** The split in words for an accessible name: "Current $1,000.00 (40%), 1 to 30 days overdue $1,500.00 (60%)". */
export function ageingSplitLabel(input: AgeingInput): string {
  const parts = ageingSegments(input)
    .filter((segment) => segment.cents > 0)
    .map((segment) => `${AGEING_SEGMENT_SPOKEN[segment.key]} ${formatCents(segment.cents)} (${Math.round(segment.share * 100)}%)`)
  return parts.length > 0 ? parts.join(", ") : "Nothing outstanding"
}

// ── Bar list ────────────────────────────────────────────────────────

/** The status hues a bar list draws with (a subset of the chart tones); never the brand colour. */
export type BarTone = "neutral" | "caution" | "alert" | "critical"

/** One row of `BarList`: a label, a bar of one or more parts and the amount written on the row. */
export type BarListRow = {
  key: string
  label: string
  cents: number
  /** Invoices behind the amount. */
  count: number
  /** The bar's parts in drawing order; they add up to `cents`. */
  segments: readonly { tone: BarTone; cents: number }[]
  /** Length of the bar against the longest row (0 to 1). */
  scale: number
  selected: boolean
  /** The link that toggles this row as a filter; `null` for a row that filters nothing (empty, or folded). */
  href: string | null
  /** The row's accessible name, stating its figures. */
  name: string
  /** The "N others" row, which stands for several. */
  folded?: boolean
}

// ── Billing cadence ─────────────────────────────────────────────────

/** One bar of `UpcomingBillingChart`. `CadencePeriod` from the read model fits as is. */
export type CadencePoint = {
  periodIndex: number
  kind: "issued" | "estimate"
  issueDate: string
  start: string
  end: string
  invoiceCount: number
  totalCents: number
}

/** "Next billing Oct 30: about $171K · last $170K on Oct 16", or the half that exists. */
export function cadenceTakeaway(periods: readonly CadencePoint[]): string {
  const next = periods.find((period) => period.kind === "estimate")
  const last = periods.filter((period) => period.kind === "issued").at(-1)
  const estimate = next && (next.totalCents > 0 ? `about ${formatCompactCents(next.totalCents)}` : "nothing estimated yet")
  if (next && last) return `Next billing ${shortDay(next.issueDate)}: ${estimate} · last ${formatCompactCents(last.totalCents)} on ${shortDay(last.issueDate)}`
  if (next) return `Next billing ${shortDay(next.issueDate)}: ${estimate}`
  if (last) return `Last billing ${shortDay(last.issueDate)}: ${formatCompactCents(last.totalCents)}`
  return "No billing yet."
}

export function hasCadence(periods: readonly CadencePoint[]): boolean {
  return periods.some((period) => period.totalCents > 0)
}
