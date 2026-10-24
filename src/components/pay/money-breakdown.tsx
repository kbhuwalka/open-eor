import { formatCents } from "@/lib/format"
import type { BreakdownSegment, BreakdownSegmentKey } from "@/lib/payslip-view"

/** Tones are the neutral scale only (ui-guidelines D1); the legend carries the meaning, never colour alone. */
const TONE: Record<BreakdownSegmentKey, { bar: string; swatch: string }> = {
  take_home: { bar: "fill-primary", swatch: "bg-primary" },
  federal_income_tax: { bar: "fill-foreground/60", swatch: "bg-foreground/60" },
  social_security_medicare: { bar: "fill-foreground/45", swatch: "bg-foreground/45" },
  state_taxes: { bar: "fill-foreground/32", swatch: "bg-foreground/32" },
  health: { bar: "fill-foreground/22", swatch: "bg-foreground/22" },
  retirement: { bar: "fill-foreground/15", swatch: "bg-foreground/15" },
  other_deductions: { bar: "fill-foreground/10", swatch: "bg-foreground/10" },
}

function percent(part: number, total: number): string {
  if (total <= 0) return "0%"
  const value = Math.round((part / total) * 1000) / 10
  return `${value}%`
}

/**
 * "Where your money goes": one stacked bar of this period's gross pay with a legend of amounts
 * and shares. An SVG keeps segment widths as attributes, so the page needs no inline CSS.
 */
export function MoneyBreakdown({ segments, grossCents }: { segments: BreakdownSegment[]; grossCents: number }) {
  const total = segments.reduce((sum, segment) => sum + segment.cents, 0)
  const bars = segments.reduce<{ segment: BreakdownSegment; x: number; width: number }[]>((acc, segment) => {
    const x = acc.length === 0 ? 0 : acc[acc.length - 1].x + acc[acc.length - 1].width
    return [...acc, { segment, x, width: (segment.cents / total) * 100 }]
  }, [])
  return (
    <section aria-labelledby="breakdown-heading" className="flex flex-col gap-3" data-testid="money-breakdown">
      <h3 id="breakdown-heading" className="text-lg font-medium">
        Where your money goes
      </h3>
      <svg
        viewBox="0 0 100 1"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Gross pay of ${formatCents(grossCents)}: ${segments.map((s) => `${s.label} ${percent(s.cents, total)}`).join(", ")}`}
        className="h-3 w-full overflow-hidden rounded-full"
      >
        {bars.map(({ segment, x, width }) => (
          <rect
            key={segment.key}
            x={x}
            y={0}
            width={width}
            height={1}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            className={`${TONE[segment.key].bar} stroke-card`}
          />
        ))}
      </svg>
      <ul className="flex flex-col gap-2 text-sm" data-testid="breakdown-legend">
        {segments.map((segment) => (
          <li key={segment.key} className="flex items-center gap-2" data-testid={`breakdown-${segment.key}`}>
            <span aria-hidden className={`size-2.5 shrink-0 rounded-sm ${TONE[segment.key].swatch}`} />
            <span className="flex-1">{segment.label}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{percent(segment.cents, total)}</span>
            <span className="w-24 text-right tabular-nums">{formatCents(segment.cents)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
