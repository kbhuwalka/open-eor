"use client"

import type { LabelProps } from "recharts"

import { formatCompactCents } from "@/lib/format"

/** Average advance of a tabular digit or `$`/`K` at the 11px label size. */
const CHAR_WIDTH = 6.4

/**
 * LabelList content for bar charts: the compact amount just above the bar, drawn only when the bar
 * is at least as wide as the text, so labels never collide on a narrow chart (the tooltip and the
 * data table still have every figure).
 */
export function barValueLabel(props: LabelProps) {
  const box = props.viewBox
  const value = typeof props.value === "number" ? props.value : Number(props.value)
  if (!box || !("width" in box) || !Number.isFinite(value) || value <= 0) return null
  const text = formatCompactCents(value)
  if (box.width < text.length * CHAR_WIDTH) return null
  return (
    <text
      x={box.x + box.width / 2}
      y={box.y - 4}
      textAnchor="middle"
      className="fill-muted-foreground text-[11px] tabular-nums"
    >
      {text}
    </text>
  )
}
