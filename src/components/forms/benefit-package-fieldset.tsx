"use client"

import {
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { US_2026 } from "@/domain/cost-rates"
import { BENEFIT_PACKAGES, type BenefitPackage } from "@/domain/types"

/** Benefits package choice. Submits `package`. */
export function BenefitPackageFieldset({
  value,
  onChange,
  description = "Offered to the employee, who may decline. Costs apply only if they enroll.",
  errorMessage,
}: {
  value: BenefitPackage
  onChange: (next: BenefitPackage) => void
  description?: string
  errorMessage?: string
}) {
  return (
    <FieldSet>
      <FieldLegend variant="label">Benefits</FieldLegend>
      <FieldDescription>{description}</FieldDescription>
      <FieldGroup className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {BENEFIT_PACKAGES.map((option) => {
          const selected = value === option
          return (
            <label
              key={option}
              className={
                "flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-sm transition-colors has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 " +
                (selected ? "border-primary/40 bg-primary/5" : "border-border hover:bg-muted/50")
              }
            >
              <input
                type="radio"
                name="package"
                value={option}
                checked={selected}
                onChange={() => onChange(option)}
                className="sr-only"
                data-testid={`package-${option}`}
              />
              <span className="font-medium">{US_2026.packages[option].label}</span>
              <span className="text-xs text-muted-foreground">{US_2026.packages[option].description}</span>
            </label>
          )
        })}
      </FieldGroup>
      <FieldError>{errorMessage}</FieldError>
    </FieldSet>
  )
}
