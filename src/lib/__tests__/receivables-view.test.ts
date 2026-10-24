import { describe, expect, it } from "vitest"

import type { AgeingTotals, ClientAgeing, ClientAgeingRow } from "@/server/finance-insights"

import {
  BUCKET_PARAM,
  bucketRows,
  bucketSegmentHrefs,
  clearedReceivablesHref,
  clientRows,
  compareChaseOrder,
  daysLabel,
  daysLate,
  parseBucketParam,
  parseReceivablesQuery,
  receivablesChips,
  receivablesFigures,
  receivablesHref,
  searchOf,
  withKnownClient,
} from "../receivables-view"

const zero = { count: 0, cents: 0 }

function totals(buckets: Partial<AgeingTotals["buckets"]>, inFlight = zero): AgeingTotals {
  const all = { current: zero, days1to30: zero, days31to60: zero, days60plus: zero, ...buckets }
  const overdue = [all.days1to30, all.days31to60, all.days60plus]
  return {
    buckets: all,
    inFlight,
    outstandingCents: Object.values(all).reduce((sum, b) => sum + b.cents, 0),
    invoiceCount: Object.values(all).reduce((sum, b) => sum + b.count, 0),
    overdueCents: overdue.reduce((sum, b) => sum + b.cents, 0),
    overdueCount: overdue.reduce((sum, b) => sum + b.count, 0),
    oldestOverdueDays: null,
    oldestDueDate: null,
  }
}

const client = (id: string, name: string, t: AgeingTotals): ClientAgeingRow => ({ companyId: id, companyName: name, ...t })

function book(clients: ClientAgeingRow[]): ClientAgeing {
  const sum = (pick: (c: ClientAgeingRow) => { count: number; cents: number }) =>
    clients.reduce((acc, c) => ({ count: acc.count + pick(c).count, cents: acc.cents + pick(c).cents }), zero)
  return {
    asOf: "2026-10-24",
    clients,
    bookAgeing: totals(
      {
        current: sum((c) => c.buckets.current),
        days1to30: sum((c) => c.buckets.days1to30),
        days31to60: sum((c) => c.buckets.days31to60),
        days60plus: sum((c) => c.buckets.days60plus),
      },
      sum((c) => c.inFlight),
    ),
  }
}

const acme = client("acme", "Acme Robotics", totals({ current: { count: 2, cents: 3_000 }, days1to30: { count: 3, cents: 10_000 } }))
const bright = client("bright", "Brightwave Labs", totals({ days1to30: { count: 1, cents: 4_000 }, days60plus: { count: 1, cents: 2_000 } }))
const harbor = client("harbor", "Harbor Foods Co.", totals({ current: { count: 1, cents: 1_000 } }, { count: 1, cents: 500 }))
const flying = client("flying", "Only In Flight", totals({}, { count: 2, cents: 700 }))
const BOOK = book([acme, bright, harbor, flying])

const NONE = { bucket: null, client: null }

describe("the URL", () => {
  it("parses each bucket value and nothing else", () => {
    expect(parseBucketParam("current")).toBe("current")
    expect(parseBucketParam("1-30")).toBe("days1to30")
    expect(parseBucketParam("31-60")).toBe("days31to60")
    expect(parseBucketParam(["60-plus", "1-30"])).toBe("days60plus")
    expect(parseBucketParam("in-flight")).toBeNull()
    expect(parseBucketParam("days1to30")).toBeNull()
    expect(parseBucketParam(undefined)).toBeNull()
    expect(Object.values(BUCKET_PARAM)).toEqual(["current", "1-30", "31-60", "60-plus"])
  })

  it("parses the query defensively", () => {
    expect(parseReceivablesQuery({ bucket: "1-30", client: "acme", page: "3", size: "25" })).toEqual({
      bucket: "days1to30",
      client: "acme",
      page: 3,
      size: 25,
    })
    expect(parseReceivablesQuery({ bucket: "nope", client: "../etc", page: "-2", size: "7" })).toEqual({ bucket: null, client: null, page: 1, size: 10 })
    expect(parseReceivablesQuery({})).toEqual({ bucket: null, client: null, page: 1, size: 10 })
  })

  it("ignores a client that owes nothing or is unknown", () => {
    const query = parseReceivablesQuery({ client: "acme" })
    expect(withKnownClient(query, BOOK).client).toBe("acme")
    expect(withKnownClient({ ...query, client: "flying" }, BOOK).client).toBeNull()
    expect(withKnownClient({ ...query, client: "ghost" }, BOOK).client).toBeNull()
  })

  it("writes one parameter, keeps the others and resets the page", () => {
    expect(receivablesHref()).toBe("/finance/receivables")
    expect(receivablesHref({ bucket: "days1to30" })).toBe("/finance/receivables?bucket=1-30")
    expect(receivablesHref({ client: "acme" })).toBe("/finance/receivables?client=acme")
    expect(receivablesHref({ client: "acme" }, "bucket=1-30&page=3&size=25")).toBe("/finance/receivables?bucket=1-30&size=25&client=acme")
    expect(receivablesHref({ bucket: null }, "?bucket=1-30&client=acme&page=2")).toBe("/finance/receivables?client=acme")
    expect(clearedReceivablesHref("bucket=1-30&client=acme&size=50&page=4")).toBe("/finance/receivables?size=50")
    expect(searchOf({ bucket: "1-30", client: undefined, x: ["a", "b"] })).toBe("bucket=1-30&x=a&x=b")
  })

  it("links the Home's ageing bar to the same bucket values, and money in flight to Payments", () => {
    expect(bucketSegmentHrefs()).toEqual({
      current: "/finance/receivables?bucket=current",
      days1to30: "/finance/receivables?bucket=1-30",
      days31to60: "/finance/receivables?bucket=31-60",
      days60plus: "/finance/receivables?bucket=60-plus",
      inFlight: "/finance/payments",
    })
  })
})

describe("the figures line", () => {
  it("is the whole book with no filter, money in flight included", () => {
    expect(receivablesFigures(BOOK, NONE)).toEqual({ outstandingCents: 20_000, overdueCents: 16_000, invoiceCount: 8, inFlightCents: 1_200 })
  })

  it("follows both filters, and hides money in flight under any filter", () => {
    expect(receivablesFigures(BOOK, { bucket: "days1to30", client: null })).toEqual({
      outstandingCents: 14_000,
      overdueCents: 14_000,
      invoiceCount: 4,
      inFlightCents: null,
    })
    expect(receivablesFigures(BOOK, { bucket: "current", client: null })).toMatchObject({ outstandingCents: 4_000, overdueCents: 0 })
    expect(receivablesFigures(BOOK, { bucket: null, client: "acme" })).toMatchObject({ outstandingCents: 13_000, overdueCents: 10_000, inFlightCents: null })
    expect(receivablesFigures(BOOK, { bucket: "days1to30", client: "acme" })).toMatchObject({ outstandingCents: 10_000, invoiceCount: 3 })
    expect(receivablesFigures(BOOK, { bucket: "days31to60", client: "acme" })).toMatchObject({ outstandingCents: 0, overdueCents: 0, invoiceCount: 0 })
  })
})

describe("By age", () => {
  it("has the four buckets with amount, count and a bar scaled to the longest, and no in flight row", () => {
    const rows = bucketRows(BOOK, NONE)
    expect(rows.map((row) => [row.key, row.label, row.cents, row.count])).toEqual([
      ["current", "Current", 4_000, 3],
      ["days1to30", "1–30 days late", 14_000, 4],
      ["days31to60", "31–60 days late", 0, 0],
      ["days60plus", "60+ days late", 2_000, 1],
    ])
    expect(rows.map((row) => row.scale)).toEqual([4 / 14, 1, 0, 2 / 14])
    expect(rows.map((row) => row.segments[0].tone)).toEqual(["neutral", "caution", "alert", "critical"])
  })

  it("toggles ?bucket=, keeping the client; an empty row links nowhere", () => {
    const rows = bucketRows(BOOK, { bucket: "days1to30", client: null }, "bucket=1-30&size=25&page=2")
    expect(rows[0].href).toBe("/finance/receivables?bucket=current&size=25")
    expect(rows[1]).toMatchObject({ selected: true, href: "/finance/receivables?size=25" })
    expect(rows[2].href).toBeNull()
    expect(rows[1].name).toBe("1 to 30 days late: $140.00, 4 invoices, selected")
    expect(rows[0].name).toBe("Current, not yet due: $40.00, 3 invoices")
  })

  it("is drawn from the book filtered by the client, never by its own selection (crossfilter)", () => {
    const unselected = bucketRows(BOOK, { bucket: null, client: "acme" })
    const selected = bucketRows(BOOK, { bucket: "days1to30", client: "acme" }, "bucket=1-30&client=acme")
    expect(unselected.map((row) => row.cents)).toEqual([3_000, 10_000, 0, 0])
    expect(selected.map((row) => row.cents)).toEqual(unselected.map((row) => row.cents))
    expect(selected.map((row) => row.scale)).toEqual(unselected.map((row) => row.scale))
    expect(selected[1].href).toBe("/finance/receivables?client=acme")
  })

  it("keeps a selected empty bucket clearable", () => {
    const rows = bucketRows(BOOK, { bucket: "days31to60", client: null }, "bucket=31-60")
    expect(rows[2]).toMatchObject({ cents: 0, selected: true, href: "/finance/receivables" })
  })
})

describe("By client", () => {
  it("ranks clients by amount owed, without money in flight, in two parts", () => {
    const rows = clientRows(BOOK, NONE)
    expect(rows.map((row) => [row.key, row.cents, row.count])).toEqual([
      ["acme", 13_000, 5],
      ["bright", 6_000, 2],
      ["harbor", 1_000, 1],
    ])
    expect(rows[0].segments).toEqual([
      { tone: "alert", cents: 10_000 },
      { tone: "neutral", cents: 3_000 },
    ])
    expect(rows[0].name).toBe("Acme Robotics: $130.00, $100.00 overdue, 5 invoices")
    expect(rows[2].name).toBe("Harbor Foods Co.: $10.00, nothing overdue, 1 invoice")
    expect(rows[0].href).toBe("/finance/receivables?client=acme")
  })

  it("is drawn from the book filtered by the bucket, never by its own selection (crossfilter)", () => {
    const rows = clientRows(BOOK, { bucket: "current", client: null }, "bucket=current")
    expect(rows.map((row) => [row.key, row.cents])).toEqual([
      ["acme", 3_000],
      ["harbor", 1_000],
    ])
    expect(rows[0].segments.map((s) => s.cents)).toEqual([0, 3_000])
    expect(rows[0].href).toBe("/finance/receivables?bucket=current&client=acme")
    const selected = clientRows(BOOK, { bucket: "current", client: "acme" }, "bucket=current&client=acme")
    expect(selected.map((row) => row.cents)).toEqual(rows.map((row) => row.cents))
    expect(selected[0]).toMatchObject({ selected: true, href: "/finance/receivables?bucket=current" })
  })

  it("keeps the selected client when the bucket leaves it nothing, so it can be cleared", () => {
    const rows = clientRows(BOOK, { bucket: "days60plus", client: "acme" }, "bucket=60-plus&client=acme")
    expect(rows.map((row) => [row.key, row.cents])).toEqual([
      ["bright", 2_000],
      ["acme", 0],
    ])
    expect(rows[1]).toMatchObject({ selected: true, href: "/finance/receivables?bucket=60-plus" })
  })

  it("folds clients past the limit into one N others row that links nowhere, never folding the selected one", () => {
    const many = book(
      Array.from({ length: 8 }, (_, i) => client(`c${i}`, `Client ${i}`, totals({ days1to30: { count: 1, cents: (8 - i) * 100 } }))),
    )
    const rows = clientRows(many, NONE)
    expect(rows.map((row) => row.key)).toEqual(["c0", "c1", "c2", "c3", "c4", "others"])
    expect(rows[5]).toMatchObject({ label: "3 others", cents: 600, count: 3, href: null, folded: true, selected: false })
    expect(rows[5].segments).toEqual([
      { tone: "alert", cents: 600 },
      { tone: "neutral", cents: 0 },
    ])

    const pinned = clientRows(many, { bucket: null, client: "c7" })
    expect(pinned.map((row) => row.key)).toEqual(["c0", "c1", "c2", "c3", "c4", "c7", "others"])
    expect(pinned[6]).toMatchObject({ label: "2 others", cents: 500 })
    expect(clientRows(book(many.clients.slice(0, 6)), NONE).map((row) => row.key)).toEqual(["c0", "c1", "c2", "c3", "c4", "c5"])
  })
})

describe("chips", () => {
  it("one per selection, each removing only its own filter", () => {
    expect(receivablesChips(BOOK, NONE)).toEqual([])
    expect(receivablesChips(BOOK, { bucket: "days1to30", client: "acme" }, "bucket=1-30&client=acme&page=2")).toEqual([
      { key: "bucket", label: "1–30 days late", href: "/finance/receivables?client=acme" },
      { key: "client", label: "Acme Robotics", href: "/finance/receivables?bucket=1-30" },
    ])
  })
})

describe("the table", () => {
  it("orders by the oldest due date, then the number", () => {
    const rows = [
      { dueDate: "2026-10-20", number: "INV-2026-0002" },
      { dueDate: "2026-10-01", number: "INV-2026-0009" },
      { dueDate: "2026-10-20", number: "INV-2026-0001" },
    ]
    expect(rows.sort(compareChaseOrder).map((row) => row.number)).toEqual(["INV-2026-0009", "INV-2026-0001", "INV-2026-0002"])
  })

  it("says how late an invoice is", () => {
    expect(daysLate("2026-10-07", "2026-10-24")).toEqual({ days: 17, label: "17 days late", late: true })
    expect(daysLate("2026-10-23", "2026-10-24")).toEqual({ days: 1, label: "1 day late", late: true })
    expect(daysLate("2026-10-24", "2026-10-24")).toEqual({ days: 0, label: "due today", late: false })
    expect(daysLate("2026-10-25", "2026-10-24")).toEqual({ days: -1, label: "in 1 day", late: false })
    expect(daysLate("2026-10-30", "2026-10-24")).toEqual({ days: -6, label: "in 6 days", late: false })
    expect(daysLabel(1)).toBe("1 day")
    expect(daysLabel(12)).toBe("12 days")
  })
})
