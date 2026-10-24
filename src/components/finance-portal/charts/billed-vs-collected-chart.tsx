"use client"

import { Bar, BarChart, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts"

import {
  CHART_FILL,
  ChartContainer,
  ChartDataTable,
  ChartEmptyState,
  ChartFrame,
  ChartLegend,
  ChartTooltipContent,
  type ChartConfig,
  type ChartTooltipRow,
} from "@/components/ui/chart"
import {
  collectionTakeaway,
  DEFAULT_CHART_PERIODS,
  hasBilling,
  shortPeriodLabel,
  type BilledCollectedPoint,
} from "@/lib/finance-chart-view"
import { formatIsoRange } from "@/lib/finance-format"
import { formatCents, formatCompactCents } from "@/lib/format"

const CONFIG = {
  collected: { label: "Collected", tone: "brand" },
  outstanding: { label: "Not yet collected", tone: "brandSoft" },
} satisfies ChartConfig

type Datum = BilledCollectedPoint & { label: string; outstandingCents: number }

export type BilledVsCollectedChartProps = {
  /** Pay periods oldest first; the last `maxPeriods` are drawn. */
  periods: readonly BilledCollectedPoint[]
  maxPeriods?: number
  title?: string
  /** Defaults to `collectionTakeaway` of the drawn periods. */
  takeaway?: string
  emptyMessage?: string
  className?: string
  /** `section` is the Finance Home's: no box, the title and takeaway as a section head (`ChartFrame`). */
  variant?: "card" | "section"
}

function tooltipRows(point: BilledCollectedPoint): ChartTooltipRow[] {
  const rows: ChartTooltipRow[] = [
    { key: "billed", label: "Billed", value: formatCents(point.billedCents) },
    { key: "collected", value: formatCents(point.collectedCents) },
  ]
  if ((point.inFlightCents ?? 0) > 0) rows.push({ key: "inFlight", label: "In flight", value: formatCents(point.inFlightCents ?? 0) })
  rows.push({ key: "outstanding", value: formatCents(point.billedCents - point.collectedCents), strong: true })
  return rows
}

function renderTooltip({ active, payload }: TooltipContentProps) {
  const point = payload?.[0]?.payload as Datum | undefined
  if (!point) return null
  return <ChartTooltipContent active={active} title={formatIsoRange(point.start, point.end)} rows={tooltipRows(point)} />
}

/**
 * One bar per pay period, as tall as what was invoiced: the part settled in the brand colour and the
 * part not yet collected in its tint, over the service period on the x axis. Hover or the arrow
 * keys (after tabbing to the plot) show the period's exact figures; a visually hidden table carries
 * them for screen readers.
 */
export function BilledVsCollectedChart({
  periods,
  maxPeriods = DEFAULT_CHART_PERIODS,
  title = "Billed vs collected",
  takeaway,
  emptyMessage = "Nothing billed in these pay periods yet.",
  className,
  variant = "card",
}: BilledVsCollectedChartProps) {
  const shown = periods.slice(-maxPeriods)
  const data: Datum[] = shown.map((period) => ({
    ...period,
    label: shortPeriodLabel(period.start, period.end),
    outstandingCents: Math.max(0, period.billedCents - period.collectedCents),
  }))
  const sentence = takeaway ?? collectionTakeaway(shown)
  if (!hasBilling(shown)) {
    return (
      <ChartFrame title={title} takeaway={sentence} className={className} variant={variant}>
        <ChartEmptyState message={emptyMessage} className="h-60" />
      </ChartFrame>
    )
  }
  return (
    <ChartFrame title={title} takeaway={sentence} className={className} variant={variant}>
      <ChartContainer config={CONFIG} className="h-60">
        <BarChart
          data={data}
          width="100%"
          height="100%"
          margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
          barCategoryGap="28%"
          aria-label={`${title}. ${sentence}. Use the arrow keys to read each pay period.`}
        >
          <XAxis dataKey="label" tickLine={false} tickMargin={6} minTickGap={8} />
          <YAxis tickFormatter={(value: number) => formatCompactCents(value)} tickLine={false} axisLine={false} width={52} />
          <Tooltip content={renderTooltip} cursor isAnimationActive={false} />
          <Bar dataKey="collectedCents" name={CONFIG.collected.label} stackId="period" fill={CHART_FILL.brand} isAnimationActive={false} />
          <Bar
            dataKey="outstandingCents"
            name={CONFIG.outstanding.label}
            stackId="period"
            fill={CHART_FILL.brandSoft}
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ChartContainer>
      <ChartLegend config={CONFIG} />
      <ChartDataTable
        caption={`${title} by pay period`}
        columns={["Pay period", "Billed", "Collected", "In flight", "Not yet collected"]}
        rows={shown.map((period) => ({
          key: String(period.periodIndex),
          cells: [
            formatIsoRange(period.start, period.end),
            formatCents(period.billedCents),
            formatCents(period.collectedCents),
            formatCents(period.inFlightCents ?? 0),
            formatCents(period.billedCents - period.collectedCents),
          ],
        }))}
      />
    </ChartFrame>
  )
}
