import { formatDay } from "@/lib/format"
import type { FormCard } from "@/server/onboarding-portal/case-detail"

/**
 * What the employee filled in, read-only. Sensitive values arrive already masked from the server
 * (SSN as ***-**-1234, account numbers as their last four) and there is no way to reveal them here
 * (ui-guidelines: staff views never offer "Reveal").
 */
export function CaseFormsTab({ forms, now }: { forms: FormCard[]; now: Date }) {
  if (forms.length === 0) {
    return <p className="text-sm text-muted-foreground" data-testid="no-forms">The employee has not filed any forms yet.</p>
  }
  return (
    <div className="grid gap-6 md:grid-cols-2" data-testid="case-forms">
      {forms.map((form) => (
        <section key={form.id} className="flex flex-col gap-2" data-testid={`form-${form.id}`} aria-labelledby={`form-${form.id}-title`}>
          <div className="flex items-baseline justify-between gap-3">
            <h3 id={`form-${form.id}-title`} className="text-base font-semibold">{form.title}</h3>
            {form.filedAt ? <span className="text-xs text-muted-foreground">Filed {formatDay(new Date(form.filedAt), now)}</span> : null}
          </div>
          <dl className="overflow-hidden rounded-lg border border-border text-sm">
            {form.fields.map((field) => (
              <div key={field.label} className="flex items-start justify-between gap-4 px-4 py-2.5 not-first:border-t not-first:border-border">
                <dt className="text-muted-foreground">{field.label}</dt>
                <dd className="text-right tabular-nums">{field.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  )
}
