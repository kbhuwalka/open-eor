"use client"

import { Bar, BarChart, LabelList, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts"

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

import { barValueLabel } from "./bar-value-label"

const CONFIG = {
  billed: { label: "Billed", tone: "brand" },
  collected: { label: "Collected", tone: "positive" },
} satisfies ChartConfig

type Datum = BilledCollectedPoint & { label: string }

export type BilledVsCollectedChartProps = {
  /** Pay periods oldest first; the last `maxPeriods` are drawn. */
  periods: readonly BilledCollectedPoint[]
  maxPeriods?: number
  title?: string
  /** Defaults to `collectionTakeaway` of the drawn periods. */
  takeaway?: string
  emptyMessage?: string
  className?: string
}

function tooltipRows(point: BilledCollectedPoint): ChartTooltipRow[] {
  const rows: ChartTooltipRow[] = [
    { key: "billed", value: formatCents(point.billedCents) },
    { key: "collected", value: formatCents(point.collectedCents) },
  ]
  if ((point.inFlightCents ?? 0) > 0) rows.push({ key: "inFlight", label: "In flight", value: formatCents(point.inFlightCents ?? 0) })
  rows.push({ key: "gap", label: "Gap", value: formatCents(point.billedCents - point.collectedCents), strong: true })
  return rows
}

function renderTooltip({ active, payload }: TooltipContentProps) {
  const point = payload?.[0]?.payload as Datum | undefined
  if (!point) return null
  return <ChartTooltipContent active={active} title={formatIsoRange(point.start, point.end)} rows={tooltipRows(point)} />
}

/**
 * Two bars per pay period, invoiced (brand) and settled (positive), over the service period on
 * the x axis. Hover or the arrow keys (after tabbing to the plot) show the period's exact figures;
 * a visually hidden table carries them for screen readers.
 */
export function BilledVsCollectedChart({
  periods,
  maxPeriods = DEFAULT_CHART_PERIODS,
  title = "Billed vs collected",
  takeaway,
  emptyMessage = "Nothing billed in these pay periods yet.",
  className,
}: BilledVsCollectedChartProps) {
  const shown = periods.slice(-maxPeriods)
  const data: Datum[] = shown.map((period) => ({ ...period, label: shortPeriodLabel(period.start, period.end) }))
  const sentence = takeaway ?? collectionTakeaway(shown)
  if (!hasBilling(shown)) {
    return (
      <ChartFrame title={title} takeaway={sentence} className={className}>
        <ChartEmptyState message={emptyMessage} className="h-60" />
      </ChartFrame>
    )
  }
  return (
    <ChartFrame title={title} takeaway={sentence} className={className}>
      <ChartContainer config={CONFIG} className="h-60">
        <BarChart
          data={data}
          width="100%"
          height="100%"
          margin={{ top: 18, right: 0, bottom: 0, left: 0 }}
          barCategoryGap="22%"
          barGap={2}
          aria-label={`${title}. ${sentence}. Use the arrow keys to read each pay period.`}
        >
          <XAxis dataKey="label" tickLine={false} tickMargin={6} minTickGap={8} />
          <YAxis tickFormatter={(value: number) => formatCompactCents(value)} tickLine={false} axisLine={false} width={52} />
          <Tooltip content={renderTooltip} cursor isAnimationActive={false} />
          <Bar dataKey="billedCents" name={CONFIG.billed.label} fill={CHART_FILL.brand} radius={[3, 3, 0, 0]} isAnimationActive={false}>
            <LabelList dataKey="billedCents" content={barValueLabel} />
          </Bar>
          <Bar dataKey="collectedCents" name={CONFIG.collected.label} fill={CHART_FILL.positive} radius={[3, 3, 0, 0]} isAnimationActive={false}>
            <LabelList dataKey="collectedCents" content={barValueLabel} />
          </Bar>
        </BarChart>
      </ChartContainer>
      <ChartLegend config={CONFIG} />
      <ChartDataTable
        caption={`${title} by pay period`}
        columns={["Pay period", "Billed", "Collected", "In flight", "Gap"]}
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
