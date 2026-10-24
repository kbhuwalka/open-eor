"use client"

import { useId, useState } from "react"
import Link from "next/link"

import { BenefitPackageFieldset } from "@/components/forms/benefit-package-fieldset"
import { CompFieldset, useCompValue } from "@/components/forms/comp-fieldset"
import { QuoteBreakdown } from "@/components/quote-breakdown"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { OptionSelect } from "@/components/ui/option-select"
import { US_2026 } from "@/domain/cost-rates"
import { buildQuote } from "@/domain/quote"
import type { BenefitPackage } from "@/domain/types"
import { effectiveHourlyCents, resolveWageFloor } from "@/domain/wage"
import { US_STATES } from "@/lib/us-states"

const LOCATION_OPTIONS = US_STATES.map((st) => ({ value: st.code, label: st.name, hint: st.code }))

/** Same `buildQuote` as the hire quote, so the numbers match what is invoiced. Nothing is saved. */
export function CostCalculator({ markupPct }: { markupPct: number }) {
  const id = useId()
  const [stateCode, setStateCode] = useState("")
  const [comp, setComp] = useCompValue({ wage: "", wageUnit: "annual" })
  const [pkg, setPkg] = useState<BenefitPackage>("standard")

  const cents = Math.round(Number(comp.wage) * 100)
  const hasWage = Boolean(stateCode) && Number.isFinite(cents) && cents > 0
  const belowMinimum =
    hasWage && effectiveHourlyCents(cents, comp.wageUnit) < resolveWageFloor(stateCode).effectiveHourlyCents
  const quote =
    hasWage && !belowMinimum
      ? buildQuote({ wageCents: cents, wageUnit: comp.wageUnit, stateCode, package: pkg, markupPct })
      : null

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <FieldSet>
        <FieldLegend variant="label">Location</FieldLegend>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${id}-state`}>Work location *</FieldLabel>
            <OptionSelect
              id={`${id}-state`}
              options={LOCATION_OPTIONS}
              value={stateCode}
              onValueChange={setStateCode}
              placeholder="Select a location…"
              data-testid="calc-state-trigger"
            />
          </Field>
        </FieldGroup>
      </FieldSet>

      <CompFieldset value={comp} onChange={setComp} stateCode={stateCode} />

      <BenefitPackageFieldset
        value={pkg}
        onChange={setPkg}
        description="Shown as a potential cost. In a real hire the employee may decline."
      />

      <FieldSet data-testid="calc-result">
        <FieldLegend variant="label">Estimated cost</FieldLegend>
        {quote ? (
          <QuoteBreakdown
            quote={quote}
            unit={comp.wageUnit}
            benefits="potential"
            packageLabel={US_2026.packages[pkg].label}
          />
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="calc-empty">
            {belowMinimum
              ? "Enter an amount at or above the minimum wage to see the cost."
              : "Choose a work location and enter an amount to see the cost."}
          </p>
        )}
      </FieldSet>

      <div>
        <Button variant="outline" render={<Link href="/client/people/new" />} nativeButton={false}>
          Start a hire
        </Button>
      </div>
    </div>
  )
}
