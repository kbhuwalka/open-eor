/**
 * Fixtures of the `/dev/charts` showcase, typed as the read models of `src/server/finance-insights.ts`
 * return them, so the showcase also proves the charts take those shapes as they are. Amounts follow
 * the seeded book of Oct 24, 2026; dates come from the pay calendar.
 */
import { payPeriodByIndex } from "@/domain/billing/pay-calendar"
import type { AgeingTotals, CadencePeriod, ClientAgeingRow, PeriodBilling } from "@/server/finance-insights"

const PERIOD_FIGURES: [index: number, billed: number, collected: number, inFlight: number][] = [
  [14, 5_461_318, 5_461_318, 0],
  [15, 8_911_167, 8_911_167, 0],
  [16, 12_055_611, 12_055_611, 0],
  [17, 14_407_522, 14_407_522, 0],
  [18, 16_871_509, 16_871_509, 0],
  [19, 19_201_435, 19_201_435, 0],
  [20, 18_130_666, 12_727_483, 0],
  [21, 17_039_814, 0, 3_847_831],
]

function periodDates(index: number) {
  const period = payPeriodByIndex(index)
  return { periodIndex: index, start: period.start, end: period.end, issueDate: period.issueDate, dueDate: period.dueDate, payDate: period.payDate }
}

export const BILLED_PERIODS: PeriodBilling[] = PERIOD_FIGURES.map(([index, billed, collected, inFlight]) => ({
  ...periodDates(index),
  billedCents: billed,
  invoiceCount: Math.round(billed / 560_000),
  collectedCents: collected,
  paidInvoiceCount: Math.round(collected / 560_000),
  inFlightCents: inFlight,
  inFlightInvoiceCount: inFlight > 0 ? 6 : 0,
}))

/** Periods nothing was billed for (a new book). */
export const EMPTY_PERIODS: PeriodBilling[] = BILLED_PERIODS.map((period) => ({
  ...period,
  billedCents: 0,
  invoiceCount: 0,
  collectedCents: 0,
  paidInvoiceCount: 0,
  inFlightCents: 0,
  inFlightInvoiceCount: 0,
}))

const bucket = (count: number, cents: number) => ({ count, cents })

function totals(patch: Pick<AgeingTotals, "buckets" | "inFlight" | "oldestOverdueDays" | "oldestDueDate">): AgeingTotals {
  const { buckets } = patch
  const overdue = [buckets.days1to30, buckets.days31to60, buckets.days60plus]
  return {
    ...patch,
    outstandingCents: buckets.current.cents + overdue.reduce((sum, b) => sum + b.cents, 0),
    invoiceCount: buckets.current.count + overdue.reduce((sum, b) => sum + b.count, 0),
    overdueCents: overdue.reduce((sum, b) => sum + b.cents, 0),
    overdueCount: overdue.reduce((sum, b) => sum + b.count, 0),
  }
}

/** The whole book: mostly 1–30 days late, as seeded, plus older debt so every bucket shows. */
export const BOOK_AGEING: AgeingTotals = totals({
  buckets: { current: bucket(4, 4_187_788), days1to30: bucket(36, 21_702_145), days31to60: bucket(5, 3_120_400), days60plus: bucket(2, 1_310_250) },
  inFlight: bucket(10, 9_556_646),
  oldestOverdueDays: 74,
  oldestDueDate: "2026-08-11",
})

/** As seeded: nothing older than 30 days. */
export const SEEDED_BOOK_AGEING: AgeingTotals = totals({
  buckets: { current: bucket(4, 4_187_788), days1to30: bucket(36, 21_702_145), days31to60: bucket(0, 0), days60plus: bucket(0, 0) },
  inFlight: bucket(10, 9_556_646),
  oldestOverdueDays: 17,
  oldestDueDate: "2026-10-07",
})

export const NOTHING_OVERDUE: AgeingTotals = totals({
  buckets: { current: bucket(3, 1_053_741), days1to30: bucket(0, 0), days31to60: bucket(0, 0), days60plus: bucket(0, 0) },
  inFlight: bucket(6, 3_847_831),
  oldestOverdueDays: null,
  oldestDueDate: "2026-10-28",
})

export const NOTHING_OUTSTANDING: AgeingTotals = totals({
  buckets: { current: bucket(0, 0), days1to30: bucket(0, 0), days31to60: bucket(0, 0), days60plus: bucket(0, 0) },
  inFlight: bucket(0, 0),
  oldestOverdueDays: null,
  oldestDueDate: null,
})

const client = (companyId: string, companyName: string, ageing: AgeingTotals): ClientAgeingRow => ({ companyId, companyName, ...ageing })

export const CLIENT_AGEING: ClientAgeingRow[] = [
  client(
    "client_1",
    "Acme Robotics",
    totals({
      buckets: { current: bucket(2, 3_134_047), days1to30: bucket(17, 10_923_855), days31to60: bucket(3, 2_050_100), days60plus: bucket(2, 1_310_250) },
      inFlight: bucket(3, 3_916_914),
      oldestOverdueDays: 74,
      oldestDueDate: "2026-08-11",
    }),
  ),
  client(
    "client_2",
    "Brightwave Labs",
    totals({
      buckets: { current: bucket(0, 0), days1to30: bucket(19, 10_778_290), days31to60: bucket(2, 1_070_300), days60plus: bucket(0, 0) },
      inFlight: bucket(1, 1_791_901),
      oldestOverdueDays: 41,
      oldestDueDate: "2026-09-13",
    }),
  ),
  client("client_3", "Harbor Foods Co.", NOTHING_OVERDUE),
]

export const CADENCE: CadencePeriod[] = [
  ...[19, 20, 21].map((index, position) => ({
    ...periodDates(index),
    kind: "issued" as const,
    invoiceCount: [33, 33, 30][position],
    totalCents: [19_201_435, 18_130_666, 17_039_814][position],
  })),
  ...[22, 23, 24].map((index, position) => ({
    ...periodDates(index),
    kind: "estimate" as const,
    invoiceCount: [29, 26, 26][position],
    totalCents: [15_238_227, 14_987_283, 14_621_851][position],
  })),
]

export const CADENCE_ESTIMATES_ONLY: CadencePeriod[] = CADENCE.filter((period) => period.kind === "estimate")

export const EMPTY_CADENCE: CadencePeriod[] = CADENCE_ESTIMATES_ONLY.map((period) => ({ ...period, invoiceCount: 0, totalCents: 0 }))
