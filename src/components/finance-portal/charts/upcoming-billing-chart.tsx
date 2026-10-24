"use client"

import { useId } from "react"
import { Bar, BarChart, LabelList, Rectangle, Tooltip, XAxis, YAxis, type BarShapeProps, type TooltipContentProps } from "recharts"

import {
  CHART_FILL,
  ChartContainer,
  ChartDataTable,
  ChartEmptyState,
  ChartFrame,
  ChartHatchPattern,
  ChartLegend,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { cadenceTakeaway, hasCadence, shortDay, type CadencePoint } from "@/lib/finance-chart-view"
import { formatIsoDay, formatIsoRange } from "@/lib/finance-format"
import { formatCents, formatCompactCents } from "@/lib/format"

import { barValueLabel } from "./bar-value-label"

const CONFIG = {
  issued: { label: "Issued", tone: "brand" },
  estimate: { label: "Estimate", tone: "brand", pattern: "hatched" },
} satisfies ChartConfig

type Datum = CadencePoint & { label: string }

export type UpcomingBillingChartProps = {
  /** Oldest first: the issued periods, then the estimated ones (`billingCadence().periods`). */
  periods: readonly CadencePoint[]
  title?: string
  /** Defaults to `cadenceTakeaway`. */
  takeaway?: string
  emptyMessage?: string
  className?: string
}

const invoicesText = (count: number) => `${count} invoice${count === 1 ? "" : "s"}`

function renderTooltip({ active, payload }: TooltipContentProps) {
  const point = payload?.[0]?.payload as Datum | undefined
  if (!point) return null
  const issued = point.kind === "issued"
  return (
    <ChartTooltipContent
      active={active}
      title={`${issued ? "Issued" : "Estimate for"} ${formatIsoDay(point.issueDate)}`}
      rows={[
        { key: point.kind, value: formatCents(point.totalCents), strong: true },
        { key: "invoices", label: "Invoices", value: String(point.invoiceCount) },
        { key: "period", label: "Service", value: formatIsoRange(point.start, point.end) },
      ]}
    />
  )
}

/**
 * The billing rhythm: one bar per pay period on its issue date, the last ones issued (solid) and
 * the next ones estimated for the people billable today (hatched).
 */
export function UpcomingBillingChart({
  periods,
  title = "Billing by pay period",
  takeaway,
  emptyMessage = "No billing yet.",
  className,
}: UpcomingBillingChartProps) {
  const hatchId = `estimate-hatch-${useId().replace(/:/g, "")}`
  const data: Datum[] = periods.map((period) => ({ ...period, label: shortDay(period.issueDate) }))
  const sentence = takeaway ?? cadenceTakeaway(periods)
  if (!hasCadence(periods)) {
    return (
      <ChartFrame title={title} takeaway={sentence} className={className}>
        <ChartEmptyState message={emptyMessage} className="h-48" />
      </ChartFrame>
    )
  }
  const renderBar = (props: BarShapeProps) => {
    const estimate = (props.payload as Datum).kind === "estimate"
    return (
      <Rectangle
        {...props}
        fill={estimate ? `url(#${hatchId})` : CHART_FILL.brand}
        stroke={estimate ? CHART_FILL.brand : "none"}
        strokeWidth={estimate ? 1 : 0}
        radius={[3, 3, 0, 0]}
      />
    )
  }
  return (
    <ChartFrame title={title} takeaway={sentence} className={className}>
      <ChartContainer config={CONFIG} className="h-48">
        <BarChart
          data={data}
          width="100%"
          height="100%"
          margin={{ top: 18, right: 0, bottom: 0, left: 0 }}
          barCategoryGap="28%"
          aria-label={`${title}. ${sentence}. Use the arrow keys to read each pay period.`}
        >
          <defs>
            <ChartHatchPattern id={hatchId} stripe={CHART_FILL.brand} background="color-mix(in oklch, var(--chart-brand) 10%, transparent)" />
          </defs>
          <XAxis dataKey="label" tickLine={false} tickMargin={6} />
          <YAxis tickFormatter={(value: number) => formatCompactCents(value)} tickLine={false} axisLine={false} width={52} />
          <Tooltip content={renderTooltip} cursor isAnimationActive={false} />
          <Bar dataKey="totalCents" name="Billed" shape={renderBar} isAnimationActive={false}>
            <LabelList dataKey="totalCents" content={barValueLabel} />
          </Bar>
        </BarChart>
      </ChartContainer>
      <ChartLegend config={CONFIG} />
      <ChartDataTable
        caption={`${title}: issued and estimated`}
        columns={["Issue date", "Kind", "Invoices", "Amount", "Service period"]}
        rows={periods.map((period) => ({
          key: `${period.kind}-${period.periodIndex}`,
          cells: [
            formatIsoDay(period.issueDate),
            period.kind === "issued" ? "Issued" : "Estimate",
            invoicesText(period.invoiceCount),
            formatCents(period.totalCents),
            formatIsoRange(period.start, period.end),
          ],
        }))}
      />
    </ChartFrame>
  )
}
