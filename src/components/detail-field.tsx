import type { ReactNode } from "react"

import { Field, FieldLabel } from "@/components/ui/field"

/** A read-only value in the form-field look (ui-guidelines C9): label above, filled box below; an empty value reads as an em dash. */
export function DetailField({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <Field className="gap-1.5">
      <FieldLabel className="font-normal text-muted-foreground">{label}</FieldLabel>
      <div className="flex min-h-10 items-center rounded-lg border border-input bg-muted px-3 py-2 text-sm break-words">
        {children === null || children === undefined || children === "" ? (
          <>
            <span aria-hidden>—</span>
            <span className="sr-only">Not provided</span>
          </>
        ) : (
          children
        )}
      </div>
    </Field>
  )
}
