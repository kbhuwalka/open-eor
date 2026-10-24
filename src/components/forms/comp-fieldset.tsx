"use client"

import { useId, useState } from "react"

import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect, type Option } from "@/components/ui/option-select"
import { annualizeWageCents, perUnitCents } from "@/domain/quote"
import { WAGE_UNITS, type WageUnit } from "@/domain/types"
import { effectiveHourlyCents, minimumWageCents, resolveWageFloor } from "@/domain/wage"
import { formatWage } from "@/lib/format"
import { stateName } from "@/lib/us-states"

export type CompValue = {
  /** Dollars as typed, e.g. "65" or "150000". */
  wage: string
  wageUnit: WageUnit
}

function amountText(cents: number, unit: WageUnit): string {
  const dollars = (cents / 100).toFixed(2)
  return unit === "hourly" ? dollars : dollars.replace(/\.00$/, "")
}

/**
 * Compensation state that survives a frequency change. The exact annual amount behind the
 * last typed value is remembered, so switching Annually → Monthly → Annually shows the same
 * pay instead of re-rounding it, and the amount field is rewritten in the new frequency.
 */
export function useCompValue(initial: CompValue): [CompValue, (next: CompValue) => void] {
  const [value, setValue] = useState<CompValue>(initial)
  const [annualCents, setAnnualCents] = useState<number | null>(() => {
    const cents = Math.round(Number(initial.wage) * 100)
    return Number.isFinite(cents) && cents > 0 ? annualizeWageCents(cents, initial.wageUnit) : null
  })

  function update(next: CompValue) {
    if (next.wageUnit !== value.wageUnit) {
      setValue({
        wageUnit: next.wageUnit,
        wage: annualCents === null ? next.wage : amountText(perUnitCents(annualCents, next.wageUnit), next.wageUnit),
      })
      return
    }
    const cents = Math.round(Number(next.wage) * 100)
    setAnnualCents(Number.isFinite(cents) && cents > 0 ? annualizeWageCents(cents, next.wageUnit) : null)
    setValue(next)
  }

  return [value, update]
}

const UNIT_LABEL: Record<WageUnit, string> = {
  hourly: "Hourly",
  monthly: "Monthly",
  annual: "Annually",
}

const UNIT_OPTIONS: Option[] = WAGE_UNITS.map((unit) => ({ value: unit, label: UNIT_LABEL[unit] }))

const PLACEHOLDER: Record<WageUnit, string> = {
  hourly: "65.00",
  monthly: "12500",
  annual: "150000",
}

/**
 * Wage and pay frequency, with the state's minimum wage shown in the selected
 * frequency (domain §7 G1–G3). The work location lives with the person; this
 * only reads it. Submits `wage` and `wageUnit`.
 */
export function CompFieldset({
  value,
  onChange,
  stateCode,
  errorField,
  errorMessage,
  disabled,
}: {
  value: CompValue
  onChange: (next: CompValue) => void
  /** Two-letter work location; empty until chosen. */
  stateCode: string
  errorField?: string
  errorMessage?: string
  disabled?: boolean
}) {
  const id = useId()
  const cents = Math.round(Number(value.wage) * 100)
  const hasWage = Number.isFinite(cents) && cents > 0
  const floor = stateCode ? resolveWageFloor(stateCode) : null
  const belowFloor =
    floor !== null &&
    hasWage &&
    effectiveHourlyCents(cents, value.wageUnit) < floor.effectiveHourlyCents

  const errorFor = (field: string) =>
    errorField === field && errorMessage ? errorMessage : undefined

  return (
    <FieldSet>
      <FieldLegend variant="label">Compensation</FieldLegend>
      <FieldGroup className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field data-invalid={errorField === "wageUnit" || undefined}>
          <FieldLabel htmlFor={`${id}-unit`}>Frequency *</FieldLabel>
          <OptionSelect
            id={`${id}-unit`}
            name="wageUnit"
            options={UNIT_OPTIONS}
            value={value.wageUnit}
            onValueChange={(unit) => unit && onChange({ ...value, wageUnit: unit as WageUnit })}
            disabled={disabled}
            data-testid="wage-unit-trigger"
          />
          <FieldError>{errorFor("wageUnit")}</FieldError>
        </Field>

        <Field data-invalid={errorField === "wage" || undefined}>
          <FieldLabel htmlFor={`${id}-wage`}>Amount *</FieldLabel>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
              $
            </span>
            <Input
              id={`${id}-wage`}
              name="wage"
              inputMode="decimal"
              placeholder={PLACEHOLDER[value.wageUnit]}
              className="pl-7 tabular-nums"
              value={value.wage}
              onChange={(e) => onChange({ ...value, wage: e.target.value })}
              error={errorField === "wage"}
              disabled={disabled}
              data-testid="wage-input"
            />
          </div>
          <FieldError>{errorFor("wage")}</FieldError>
        </Field>
      </FieldGroup>

      <FieldDescription
        data-testid="wage-floor-hint"
        className={belowFloor ? "text-destructive" : undefined}
      >
        {floor
          ? `Minimum wage in ${stateName(stateCode)}: ${formatWage(minimumWageCents(stateCode, value.wageUnit), value.wageUnit)}${floor.source === "FEDERAL" ? " (federal)" : ""}${belowFloor ? " · this amount is below it" : ""}`
          : "Choose a work location to see its minimum wage."}
      </FieldDescription>
    </FieldSet>
  )
}
