"use client"

import { useState, type ReactNode } from "react"
import { cn } from "cn"

import { AgeingBar } from "@/components/finance-portal/charts/ageing-bar"
import { BarList } from "@/components/finance-portal/charts/bar-list"
import { BilledVsCollectedChart } from "@/components/finance-portal/charts/billed-vs-collected-chart"
import { UpcomingBillingChart } from "@/components/finance-portal/charts/upcoming-billing-chart"
import { AGEING_SEGMENT_LABELS, type AgeingSegmentKey } from "@/lib/finance-chart-view"
import { formatCents } from "@/lib/format"
import { ageTakeaway, bucketRows, parseReceivablesQuery, type ReceivablesQuery } from "@/lib/receivables-view"
import type { ClientAgeing } from "@/server/finance-insights"

import {
  BILLED_PERIODS,
  BOOK_AGEING,
  CADENCE,
  CADENCE_ESTIMATES_ONLY,
  CLIENT_AGEING,
  EMPTY_CADENCE,
  EMPTY_PERIODS,
  NOTHING_OUTSTANDING,
  NOTHING_OVERDUE,
  SEEDED_BOOK_AGEING,
} from "./fixtures"

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-medium">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  )
}

function Card({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <span className="font-mono text-xs text-muted-foreground">{label}</span>
      <div className="rounded-lg border border-border bg-card p-4">{children}</div>
    </div>
  )
}

const BOOK: ClientAgeing = { asOf: "2026-10-24", clients: CLIENT_AGEING, bookAgeing: BOOK_AGEING }
const NONE: Pick<ReceivablesQuery, "bucket" | "client"> = { bucket: null, client: null }

const hasBucket = (key: AgeingSegmentKey, row: (typeof CLIENT_AGEING)[number]) =>
  key === "inFlight" ? row.inFlight.cents > 0 : row.buckets[key].cents > 0

/** Every Finance chart over fixtures: wide and narrow containers, interactions and empty states. */
export function ChartsShowcase() {
  const [selected, setSelected] = useState<AgeingSegmentKey | null>(null)
  const toggle = (key: AgeingSegmentKey) => setSelected((current) => (current === key ? null : key))
  const clients = selected ? CLIENT_AGEING.filter((row) => hasBucket(selected, row)) : CLIENT_AGEING
  const [filters, setFilters] = useState(NONE)
  const current = new URLSearchParams(Object.entries(filters).flatMap(([key, value]) => (value ? [[key, value]] : []))).toString()
  const follow = (href: string) => {
    const { bucket, client } = parseReceivablesQuery(Object.fromEntries(new URL(href, "http://x").searchParams))
    setFilters({ bucket, client })
  }

  return (
    <div className="flex flex-col gap-12">
      <Section title="BilledVsCollectedChart" description="The last 8 pay periods: invoiced (brand) and settled (positive). Labels show only where a bar is wide enough.">
        <div className="flex flex-wrap items-start gap-6">
          <Card label="wide (3/5 of max-w-5xl)" className="w-full lg:w-[36rem]">
            <BilledVsCollectedChart periods={BILLED_PERIODS} />
          </Card>
          <Card label="narrow (w-80)" className="w-80">
            <BilledVsCollectedChart periods={BILLED_PERIODS} />
          </Card>
          <Card label="full width, 4 periods" className="w-full">
            <BilledVsCollectedChart periods={BILLED_PERIODS} maxPeriods={4} />
          </Card>
        </div>
      </Section>

      <Section title="AgeingBar" description="Headline (64px) with labels, legend and clickable segments; mini (8px) sparkbars for table rows.">
        <div className="flex flex-wrap items-start gap-6">
          <Card label="headline, onSegmentClick (filters the rows below)" className="w-full">
            <AgeingBar buckets={BOOK_AGEING.buckets} inFlight={BOOK_AGEING.inFlight} onSegmentClick={toggle} selected={selected} />
            <p className="mt-3 text-xs text-muted-foreground" role="status">
              {selected ? `Filtered by ${AGEING_SEGMENT_LABELS[selected]}. Click it again to clear.` : "Click a segment to filter the clients."}
            </p>
            <table className="mt-3 w-full text-sm">
              <tbody>
                {clients.map((row) => (
                  <tr key={row.companyId} className="border-b border-border last:border-b-0">
                    <td className="py-2 pr-3 font-medium">{row.companyName}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatCents(row.outstandingCents)}</td>
                    <td className={cn("py-2 pr-3 text-right tabular-nums", row.overdueCents > 0 && "text-status-danger-foreground")}>
                      {formatCents(row.overdueCents)}
                    </td>
                    <td className="py-2 pr-3 text-right text-muted-foreground tabular-nums">
                      {row.oldestOverdueDays ? `${row.oldestOverdueDays} days` : "—"}
                    </td>
                    <td className="w-40 py-2">
                      <AgeingBar size="mini" label={row.companyName} buckets={row.buckets} inFlight={row.inFlight} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card label="headline, segmentHrefs, as seeded" className="w-full lg:w-[36rem]">
            <AgeingBar
              buckets={SEEDED_BOOK_AGEING.buckets}
              inFlight={SEEDED_BOOK_AGEING.inFlight}
              segmentHrefs={{ current: "?bucket=current", days1to30: "?bucket=days1to30", inFlight: "?bucket=inFlight" }}
            />
          </Card>
          <Card label="narrow (w-80)" className="w-80">
            <AgeingBar buckets={BOOK_AGEING.buckets} inFlight={BOOK_AGEING.inFlight} />
          </Card>
          <Card label="nothing overdue, no in-flight segment" className="w-full lg:w-[36rem]">
            <AgeingBar buckets={NOTHING_OVERDUE.buckets} title="Harbor Foods Co." />
          </Card>
        </div>
      </Section>

      <Section title="BarList" description="Receivables' By age (CH10): rows that toggle a filter; a $0 row is disabled. Card and section variants.">
        <div className="grid gap-6 lg:grid-cols-2">
          <BarList title="By age" rows={bucketRows(BOOK, filters, current)} rowHeader="Days late" emptyMessage="Nothing is owed." onNavigate={follow} />
          <div className="flex flex-col gap-2">
            <span className="font-mono text-xs text-muted-foreground">section (as on Receivables)</span>
            <BarList
              title="By age"
              variant="section"
              takeaway={ageTakeaway(bucketRows(BOOK, filters, current))}
              rows={bucketRows(BOOK, filters, current)}
              rowHeader="Days late"
              emptyMessage="Nothing is owed."
              onNavigate={follow}
            />
          </div>
          <div className="flex flex-col gap-2">
            <span className="font-mono text-xs text-muted-foreground">narrow (w-80)</span>
            <BarList title="By age" rows={bucketRows(BOOK, NONE)} rowHeader="Days late" emptyMessage="Nothing is owed." className="w-80" />
          </div>
          <div className="flex flex-col gap-2">
            <span className="font-mono text-xs text-muted-foreground">empty</span>
            <BarList
              title="By age"
              rows={bucketRows({ ...BOOK, clients: [], bookAgeing: NOTHING_OUTSTANDING }, NONE)}
              rowHeader="Days late"
              emptyMessage="Nothing is owed."
            />
          </div>
        </div>
      </Section>

      <Section title="UpcomingBillingChart" description="The last 3 issued pay periods (solid) and the next 3 estimates (hatched), on the issue date.">
        <div className="flex flex-wrap items-start gap-6">
          <Card label="wide (2/5 of max-w-5xl)" className="w-full lg:w-[24rem]">
            <UpcomingBillingChart periods={CADENCE} />
          </Card>
          <Card label="narrow (w-80)" className="w-80">
            <UpcomingBillingChart periods={CADENCE} />
          </Card>
          <Card label="full width" className="w-full">
            <UpcomingBillingChart periods={CADENCE} />
          </Card>
          <Card label="estimates only (nothing issued yet)" className="w-full lg:w-[24rem]">
            <UpcomingBillingChart periods={CADENCE_ESTIMATES_ONLY} />
          </Card>
        </div>
      </Section>

      <Section title="Empty states" description="One muted line in place of the plot, the same height, never a zero chart.">
        <div className="grid gap-6 lg:grid-cols-3">
          <Card label="BilledVsCollectedChart">
            <BilledVsCollectedChart periods={EMPTY_PERIODS} />
          </Card>
          <Card label="AgeingBar">
            <AgeingBar buckets={NOTHING_OUTSTANDING.buckets} inFlight={NOTHING_OUTSTANDING.inFlight} />
          </Card>
          <Card label="UpcomingBillingChart">
            <UpcomingBillingChart periods={EMPTY_CADENCE} />
          </Card>
        </div>
      </Section>
    </div>
  )
}
