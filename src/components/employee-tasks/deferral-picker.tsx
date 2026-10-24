"use client"

import { Minus, Plus } from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { formatCents } from "@/lib/format"

function Money({ cents, className }: { cents: number; className?: string }) {
  return <span className={cn("tabular-nums", className)}>{formatCents(cents)}</span>
}

/**
 * A 401(k) contribution percent: a stepper with a typed value and a slider, plus what it means per
 * paycheck. Shared by the onboarding benefits decision and the Benefits page.
 */
export function DeferralPicker({
  value,
  max,
  onChange,
  retirementCents,
  matchCents,
  capPct,
  inputId = "deferral-pct",
}: {
  value: number
  max: number
  onChange: (value: number) => void
  retirementCents: number
  matchCents: number
  capPct: number
  inputId?: string
}) {
  const clamp = (next: number) => onChange(Math.min(max, Math.max(0, Math.round(next))))
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" size="icon" aria-label="Decrease contribution" disabled={value <= 0} onClick={() => clamp(value - 1)}>
          <Minus />
        </Button>
        <label className="flex items-baseline gap-1.5" htmlFor={inputId}>
          <input
            id={inputId}
            type="number"
            min={0}
            max={max}
            step={1}
            value={value}
            onChange={(event) => clamp(Number(event.target.value || 0))}
            className="h-10 w-16 rounded-lg border border-input bg-muted px-2 text-center text-sm font-medium tabular-nums outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/50"
            data-testid="deferral-input"
          />
          <span className="text-sm font-medium">% of each paycheck</span>
        </label>
        <Button type="button" variant="outline" size="icon" aria-label="Increase contribution" disabled={value >= max} onClick={() => clamp(value + 1)}>
          <Plus />
        </Button>
      </div>
      <input
        type="range"
        min={0}
        max={Math.min(max, 25)}
        step={1}
        value={Math.min(value, 25)}
        onChange={(event) => clamp(Number(event.target.value))}
        aria-label="401(k) contribution percent"
        className="w-full accent-primary"
        data-testid="deferral-range"
      />
      <p className="text-sm tabular-nums" aria-live="polite" data-testid="deferral-impact">
        {value === 0 ? (
          "No 401(k) contribution."
        ) : (
          <>
            You put in <Money cents={retirementCents} className="font-medium" /> per paycheck
            {matchCents > 0 ? (
              <>
                {" "}
                and your employer adds <Money cents={matchCents} className="font-medium" />.
              </>
            ) : (
              "."
            )}
          </>
        )}
      </p>
      {value > 0 && value < capPct ? (
        <p className="text-xs text-muted-foreground">Contribute {capPct}% to get your employer&apos;s full match.</p>
      ) : null}
    </div>
  )
}
