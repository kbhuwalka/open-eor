"use client"

/**
 * The chart primitives (ui-guidelines §5.8), after shadcn's `chart` wrapper: a container that
 * themes Recharts from the `--chart-*` tokens and hands its series config to the tooltip and the
 * legend, plus the frame (title and takeaway), the visually hidden data table, the empty state and
 * the hatch pattern every chart shares. Colours are CSS variables, never literals, so a theme
 * restyles every chart. Charts built on these live with their domain (`finance-portal/charts`).
 */
import { createContext, useContext, useId, type ReactNode } from "react"
import { cn } from "cn"

/** The chart colour roles. Two or three per chart; status meaning only where the data has it. */
export type ChartTone = "brand" | "brandSoft" | "positive" | "neutral" | "caution" | "alert" | "critical" | "pending"

/** The fill of a tone, for SVG `fill` / `stroke` attributes. */
export const CHART_FILL: Record<ChartTone, string> = {
  brand: "var(--chart-brand)",
  brandSoft: "var(--chart-brand-soft)",
  positive: "var(--chart-positive)",
  neutral: "var(--chart-neutral)",
  caution: "var(--chart-caution)",
  alert: "var(--chart-alert)",
  critical: "var(--chart-critical)",
  pending: "var(--chart-pending)",
}

const SOLID_SWATCH: Record<ChartTone, string> = {
  brand: "bg-chart-brand",
  brandSoft: "bg-chart-brand-soft",
  positive: "bg-chart-positive",
  neutral: "bg-chart-neutral",
  caution: "bg-chart-caution",
  alert: "bg-chart-alert",
  critical: "bg-chart-critical",
  pending: "bg-chart-pending",
}

const HATCHED_SWATCH: Record<ChartTone, string> = {
  brand: "border border-chart-brand bg-[repeating-linear-gradient(135deg,var(--chart-brand)_0_1.5px,transparent_1.5px_4px)]",
  brandSoft: "border border-chart-brand-soft bg-[repeating-linear-gradient(135deg,var(--chart-brand-soft)_0_1.5px,transparent_1.5px_4px)]",
  positive: "border border-chart-positive bg-[repeating-linear-gradient(135deg,var(--chart-positive)_0_1.5px,transparent_1.5px_4px)]",
  neutral: "border border-chart-neutral bg-[repeating-linear-gradient(135deg,var(--chart-neutral)_0_1.5px,transparent_1.5px_4px)]",
  caution: "border border-chart-caution bg-[repeating-linear-gradient(135deg,var(--chart-caution)_0_1.5px,transparent_1.5px_4px)]",
  alert: "border border-chart-alert bg-[repeating-linear-gradient(135deg,var(--chart-alert)_0_1.5px,transparent_1.5px_4px)]",
  critical: "border border-chart-critical bg-[repeating-linear-gradient(135deg,var(--chart-critical)_0_1.5px,transparent_1.5px_4px)]",
  pending: "border border-chart-hatch bg-[repeating-linear-gradient(135deg,var(--chart-hatch)_0_1.5px,var(--chart-pending)_1.5px_4px)]",
}

export type ChartPattern = "solid" | "hatched"

export type ChartSeries = { label: string; tone: ChartTone; pattern?: ChartPattern }

/** Series by key: what the legend lists and the tooltip labels. */
export type ChartConfig = Record<string, ChartSeries>

const ChartContext = createContext<ChartConfig | null>(null)

function useChartConfig(): ChartConfig {
  const config = useContext(ChartContext)
  if (!config) throw new Error("Chart parts must be rendered inside a <ChartContainer>")
  return config
}

/**
 * Sizes and themes a Recharts chart: axis text muted, axis lines on the border token, the hover
 * cursor a muted band, the keyboard focus ring on the plot. Give it a height (`h-60`); the chart
 * inside fills it (`width="100%" height="100%"`).
 */
export function ChartContainer({ config, className, children }: { config: ChartConfig; className?: string; children: ReactNode }) {
  return (
    <ChartContext.Provider value={config}>
      <div
        data-slot="chart"
        className={cn(
          "relative w-full text-xs [&_.recharts-cartesian-axis-line]:stroke-border [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-layer]:outline-hidden [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted/60 [&_.recharts-surface]:overflow-visible [&_.recharts-surface]:rounded-md [&_.recharts-surface]:outline-hidden [&_.recharts-surface:focus-visible]:ring-3 [&_.recharts-surface:focus-visible]:ring-ring/50",
          className,
        )}
      >
        {children}
      </div>
    </ChartContext.Provider>
  )
}

export function ChartSwatch({ tone, pattern = "solid", className }: { tone: ChartTone; pattern?: ChartPattern; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2.5 shrink-0 rounded-[3px]", pattern === "hatched" ? HATCHED_SWATCH[tone] : SOLID_SWATCH[tone], className)}
    />
  )
}

export type ChartTooltipRow = {
  /** A series key of the config (gets its swatch and label), or any key with an explicit `label`. */
  key: string
  label?: string
  value: string
  strong?: boolean
}

/**
 * The tooltip card: a title line (the period), one row per figure with the exact amount. It is a
 * `role="status"` region so the figures are announced as the keyboard moves through the chart.
 */
export function ChartTooltipContent({ active, title, rows }: { active?: boolean; title: ReactNode; rows: readonly ChartTooltipRow[] }) {
  const config = useChartConfig()
  if (!active) return null
  return (
    <div role="status" aria-live="polite" className="min-w-44 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <div className="mb-1.5 font-medium">{title}</div>
      <dl className="flex flex-col gap-1">
        {rows.map((row) => {
          const series = config[row.key]
          return (
            <div key={row.key} className="flex items-center gap-2">
              {series ? <ChartSwatch tone={series.tone} pattern={series.pattern} /> : <span aria-hidden className="size-2.5 shrink-0" />}
              <dt className="text-muted-foreground">{row.label ?? series?.label ?? row.key}</dt>
              <dd className={cn("ml-auto pl-3 tabular-nums", row.strong && "font-medium")}>{row.value}</dd>
            </div>
          )
        })}
      </dl>
    </div>
  )
}

/** The legend under a chart: every series of the chart's config in order, with an optional value each. */
export function ChartLegend({ config, values, className }: { config: ChartConfig; values?: Partial<Record<string, ReactNode>>; className?: string }) {
  return <ChartLegendList items={Object.entries(config).map(([key, series]) => ({ key, ...series, value: values?.[key] }))} className={className} />
}

export type ChartLegendItem = ChartSeries & { key: string; value?: ReactNode; muted?: boolean }

/** A legend from explicit items (charts drawn without Recharts). Wraps on narrow screens. */
export function ChartLegendList({ items, className }: { items: readonly ChartLegendItem[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap gap-x-4 gap-y-1.5 text-xs", className)}>
      {items.map((item) => (
        <li key={item.key} className={cn("flex items-center gap-1.5", item.muted && "text-muted-foreground")}>
          <ChartSwatch tone={item.tone} pattern={item.pattern} />
          <span className={cn(item.value !== undefined ? "text-muted-foreground" : "text-foreground")}>{item.label}</span>
          {item.value !== undefined ? <span className="font-medium tabular-nums">{item.value}</span> : null}
        </li>
      ))}
    </ul>
  )
}

/**
 * Title and one-line takeaway over a chart. The title names the chart (`h3`); the takeaway is the
 * sentence the reader should leave with, so it carries the weight. `variant="section"` is the
 * Finance Home's: the title as a `text-base font-semibold` section heading with the takeaway muted
 * beside it, a hairline under the row (the same head as To do), and no box.
 */
export function ChartFrame({
  title,
  takeaway,
  children,
  className,
  variant = "card",
}: {
  title: string
  takeaway: ReactNode
  children: ReactNode
  className?: string
  variant?: "card" | "section"
}) {
  const titleId = useId()
  if (variant === "section") {
    return (
      <figure aria-labelledby={titleId} className={cn("flex min-w-0 flex-col gap-2", className)}>
        <figcaption className="flex min-h-8 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h3 id={titleId} className="text-base font-semibold">
            {title}
          </h3>
          <p className="text-sm text-muted-foreground">{takeaway}</p>
        </figcaption>
        <div className="flex flex-col gap-3 border-t border-border pt-4">{children}</div>
      </figure>
    )
  }
  return (
    <figure aria-labelledby={titleId} className={cn("flex min-w-0 flex-col gap-3", className)}>
      <figcaption className="flex flex-col gap-0.5">
        <h3 id={titleId} className="text-xs font-medium text-muted-foreground">
          {title}
        </h3>
        <p className="text-sm font-medium text-foreground">{takeaway}</p>
      </figcaption>
      {children}
    </figure>
  )
}

/**
 * The figures as a table for screen readers; the chart itself is `aria-hidden` or labelled. The
 * `sr-only` box is a div because a table ignores `width: 1px` and would widen the page.
 */
export function ChartDataTable({
  caption,
  columns,
  rows,
}: {
  caption: string
  columns: readonly string[]
  rows: readonly { key: string; cells: readonly ReactNode[] }[]
}) {
  return (
    <div className="sr-only">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th key={column} scope="col" className={index === 0 ? undefined : "text-right"}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              {row.cells.map((cell, index) =>
                index === 0 ? (
                  <th key={index} scope="row">
                    {cell}
                  </th>
                ) : (
                  <td key={index}>{cell}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** In place of the plot when there is nothing to draw: one muted line (C7), same height as the plot. */
export function ChartEmptyState({ message, className }: { message: string; className?: string }) {
  return (
    <div className={cn("flex items-center justify-center rounded-lg border border-dashed border-border px-4 text-center text-sm text-muted-foreground", className)}>
      {message}
    </div>
  )
}

/** Diagonal stripes for an SVG `fill="url(#id)"`: estimates and money in flight. */
export function ChartHatchPattern({ id, stripe, background = "transparent" }: { id: string; stripe: string; background?: string }) {
  return (
    <pattern id={id} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="7" height="7" fill={background} />
      <rect width="1.5" height="7" fill={stripe} />
    </pattern>
  )
}
