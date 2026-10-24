"use client"

import { useId, type KeyboardEvent, type ReactElement } from "react"
import { cn } from "cn"

import {
  CHART_FILL,
  ChartDataTable,
  ChartEmptyState,
  ChartFrame,
  ChartHatchPattern,
  ChartLegendList,
  type ChartTone,
} from "@/components/ui/chart"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  AGEING_SEGMENT_SPOKEN,
  ageingSegments,
  ageingSplitLabel,
  ageingTakeaway,
  type AgeingInput,
  type AgeingSegment,
  type AgeingSegmentKey,
} from "@/lib/finance-chart-view"
import { formatCents, formatCompactCents } from "@/lib/format"

const TONE: Record<AgeingSegmentKey, ChartTone> = {
  current: "neutral",
  days1to30: "caution",
  days31to60: "alert",
  days60plus: "critical",
  inFlight: "pending",
}

/** Label colour on each fill: dark on the light fills, the page tone on the strong ones. */
const LABEL_FILL: Record<AgeingSegmentKey, string> = {
  current: "fill-foreground",
  days1to30: "fill-background",
  days31to60: "fill-background",
  days60plus: "fill-background",
  inFlight: "fill-foreground",
}

/**
 * How far the segments a filter leaves out fade. Kept light so the unselected fills stay
 * recognisable in every preset; the selected segment is marked by its inset ring, not by the fade.
 */
export const DIMMED_SEGMENT_OPACITY = 0.6

/**
 * When a segment's label shows, by its share of the bar and the bar's width (container queries):
 * wide segments always, narrower ones only once the bar is wide enough for the text.
 */
function labelVisibility(share: number): string | null {
  if (share >= 0.18) return "inline"
  if (share >= 0.12) return "hidden @md:inline"
  if (share >= 0.1) return "hidden @lg:inline"
  if (share >= 0.08) return "hidden @2xl:inline"
  return null
}

export type AgeingBarProps = AgeingInput & {
  /** `headline`: the 64px bar with labels, legend and table. `mini`: an 8px sparkbar for a table row. */
  size?: "headline" | "mini"
  title?: string
  /** Defaults to `ageingTakeaway`. */
  takeaway?: string
  /** Names whose split a `mini` bar shows ("Acme Robotics"); it starts the accessible name. */
  label?: string
  /** Makes each segment a button; the key of the segment pressed. */
  onSegmentClick?: (segment: AgeingSegmentKey) => void
  /** Makes each listed segment a link instead (for server-rendered pages). */
  segmentHrefs?: Partial<Record<AgeingSegmentKey, string>>
  /** The segment the page is filtered by: pressed and ringed, the others faded (never below `DIMMED_SEGMENT_OPACITY`). */
  selected?: AgeingSegmentKey | null
  emptyMessage?: string
  className?: string
}

function segmentName(segment: AgeingSegment): string {
  return `${AGEING_SEGMENT_SPOKEN[segment.key]}: ${formatCents(segment.cents)}, ${Math.round(segment.share * 100)}% of the bar`
}

function percent(value: number): string {
  return `${(value * 100).toFixed(3)}%`
}

/**
 * One segment as its own nested viewport, which clips to the segment: the focus ring is drawn as
 * strokes on the viewport edge, so only their inner half shows and the next segment never covers it.
 */
function SegmentShape({
  segment,
  hatchId,
  dimmed,
  selected,
}: {
  segment: AgeingSegment
  hatchId: string
  dimmed: boolean
  selected: boolean
}) {
  const visibility = labelVisibility(segment.share)
  return (
    <svg x={percent(segment.offset)} width={percent(segment.share)} height="100%" data-dimmed={dimmed || undefined}>
      <rect
        width="100%"
        height="100%"
        fill={segment.key === "inFlight" ? `url(#${hatchId})` : CHART_FILL[TONE[segment.key]]}
        opacity={dimmed ? DIMMED_SEGMENT_OPACITY : undefined}
        className="stroke-card transition-opacity duration-150"
        strokeWidth={2}
      />
      {selected ? (
        <rect width="100%" height="100%" fill="none" className="stroke-foreground" strokeWidth={6} data-selected-ring />
      ) : null}
      <g className="hidden group-focus-visible:inline">
        <rect width="100%" height="100%" fill="none" className="stroke-background" strokeWidth={9} />
        <rect width="100%" height="100%" fill="none" className="stroke-foreground" strokeWidth={5} />
      </g>
      {visibility ? (
        <text
          x="50%"
          y="50%"
          dominantBaseline="central"
          textAnchor="middle"
          className={cn("pointer-events-none text-xs font-medium tabular-nums", dimmed ? "fill-foreground" : LABEL_FILL[segment.key], visibility)}
        >
          {formatCompactCents(segment.cents)}
        </text>
      ) : null}
    </svg>
  )
}

function activateOnKey(event: KeyboardEvent, activate: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return
  event.preventDefault()
  activate()
}

/**
 * The receivables split as one horizontal stacked bar: Current, 1–30, 31–60, 60+ days overdue and,
 * when given, money in flight (hatched). Every segment is focusable with an accessible name and a
 * tooltip; with `onSegmentClick` or `segmentHrefs` it is a button or link. The `mini` size is a
 * label-free sparkbar whose accessible name states the split.
 */
export function AgeingBar({
  buckets,
  inFlight,
  size = "headline",
  title = "Who owes us",
  takeaway,
  label,
  onSegmentClick,
  segmentHrefs,
  selected = null,
  emptyMessage = "Nothing outstanding.",
  className,
}: AgeingBarProps) {
  const ids = useId().replace(/:/g, "")
  const hatchId = `ageing-hatch-${ids}`
  const clipId = `ageing-clip-${ids}`
  const input = { buckets, inFlight }
  const segments = ageingSegments(input)
  const drawn = segments.filter((segment) => segment.cents > 0)

  if (size === "mini") {
    const split = ageingSplitLabel(input)
    return (
      <svg role="img" aria-label={label ? `${label}: ${split}` : split} className={cn("block h-2 w-full", className)}>
        <defs>
          <clipPath id={clipId}>
            <rect width="100%" height="100%" rx="4" />
          </clipPath>
          <ChartHatchPattern id={hatchId} stripe="var(--chart-hatch)" background={CHART_FILL.pending} />
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <rect width="100%" height="100%" fill={CHART_FILL.pending} />
          {drawn.map((segment) => (
            <rect
              key={segment.key}
              x={percent(segment.offset)}
              width={percent(segment.share)}
              height="100%"
              fill={segment.key === "inFlight" ? `url(#${hatchId})` : CHART_FILL[TONE[segment.key]]}
              className="stroke-card"
              strokeWidth={1}
            />
          ))}
        </g>
      </svg>
    )
  }

  const sentence = takeaway ?? ageingTakeaway(input)
  if (drawn.length === 0) {
    return (
      <ChartFrame title={title} takeaway={sentence} className={className}>
        <ChartEmptyState message={emptyMessage} className="h-16" />
      </ChartFrame>
    )
  }

  const renderSegment = (segment: AgeingSegment) => {
    const dimmed = selected !== null && selected !== segment.key
    const shape = <SegmentShape segment={segment} hatchId={hatchId} dimmed={dimmed} selected={selected === segment.key} />
    const href = segmentHrefs?.[segment.key]
    const name = segmentName(segment)
    let trigger: ReactElement
    if (href) {
      trigger = <a href={href} aria-current={selected === segment.key ? "true" : undefined} />
    } else if (onSegmentClick) {
      const activate = () => onSegmentClick(segment.key)
      trigger = (
        <g
          role="button"
          tabIndex={0}
          aria-pressed={selected === segment.key}
          onClick={activate}
          onKeyDown={(event) => activateOnKey(event, activate)}
        />
      )
    } else {
      trigger = <g role="img" tabIndex={0} />
    }
    return (
      <Tooltip key={segment.key}>
        <TooltipTrigger
          render={trigger}
          aria-label={name}
          data-segment={segment.key}
          className={cn("group outline-none", (href || onSegmentClick) && "cursor-pointer")}
        >
          {shape}
        </TooltipTrigger>
        <TooltipContent>
          <span className="font-medium">{AGEING_SEGMENT_SPOKEN[segment.key]}</span>
          <span className="block tabular-nums">
            {formatCents(segment.cents)} · {Math.round(segment.share * 100)}%
          </span>
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <ChartFrame title={title} takeaway={sentence} className={className}>
      <div className="@container">
        <svg className="block h-16 w-full overflow-visible">
          <defs>
            <clipPath id={clipId}>
              <rect width="100%" height="100%" rx="8" />
            </clipPath>
            <ChartHatchPattern id={hatchId} stripe="var(--chart-hatch)" background={CHART_FILL.pending} />
          </defs>
          <g clipPath={`url(#${clipId})`}>{drawn.map(renderSegment)}</g>
        </svg>
      </div>
      <ChartLegendList
        items={segments.map((segment) => ({
          key: segment.key,
          label: segment.label,
          tone: TONE[segment.key],
          pattern: segment.key === "inFlight" ? "hatched" : "solid",
          value: formatCents(segment.cents),
          muted: segment.cents === 0,
        }))}
      />
      <ChartDataTable
        caption={`${title}: outstanding by days overdue`}
        columns={["Bucket", "Amount", "Share"]}
        rows={segments.map((segment) => ({
          key: segment.key,
          cells: [AGEING_SEGMENT_SPOKEN[segment.key], formatCents(segment.cents), `${Math.round(segment.share * 100)}%`],
        }))}
      />
    </ChartFrame>
  )
}
