"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { CircleCheck } from "lucide-react"

import { changeContributionAction } from "@/app/worker/benefits/actions"
import { DeferralPicker } from "@/components/employee-tasks/deferral-picker"
import { FormError } from "@/components/employee-tasks/form-error"
import { Button } from "@/components/ui/button"
import { projectRetirement } from "@/domain/billing/elections"
import { benefitEstimate } from "@/lib/employee-benefits"
import { shortDay } from "@/lib/employee-view"
import { formatCents } from "@/lib/format"
import type { BenefitsPageData } from "@/server/employee-benefits"

type Failure = { message: string; fields: Record<string, string>; seq: number }

let failures = 0

const formatWhole = (cents: number) => formatCents(Math.round(cents / 100) * 100).replace(/\.00$/, "")

/**
 * The one change an employee can make to their benefits: the 401(k) percent. It always says when a
 * save takes effect (the next pay period that has not started) and what the percent means against
 * the IRS limits; the server decides everything and the form only reports it.
 */
export function ContributionForm({ data }: { data: BenefitsPageData }) {
  const router = useRouter()
  const { retirement, change } = data
  const saved = retirement.pending?.pct ?? retirement.currentPct
  const [pct, setPct] = useState(saved)
  const [pending, start] = useTransition()
  const [failure, setFailure] = useState<Failure | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const estimate = useMemo(
    () => benefitEstimate({ package: data.package, tier: null, deferralPct: pct, grossCents: retirement.grossPerPeriodCents }),
    [data.package, pct, retirement.grossPerPeriodCents],
  )
  const projection = useMemo(
    () =>
      change.taxYear === null
        ? null
        : projectRetirement({
            taxYear: change.taxYear,
            package: data.package,
            wageCents: retirement.wageCents,
            wageUnit: retirement.wageUnit,
            deferralPct: pct,
            history: retirement.schedule.map((entry) => ({
              version: entry.version,
              effectiveFrom: entry.effectiveFrom,
              enrolled: true,
              healthTier: null,
              retirementDeferralPct: entry.deferralPct,
            })),
            changeFrom: change.period?.start,
            startDate: retirement.startDate,
          }),
    [change.taxYear, change.period?.start, data.package, pct, retirement.schedule, retirement.startDate, retirement.wageCents, retirement.wageUnit],
  )

  if (!change.allowed || !change.period) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="contribution-unavailable">
        {change.reason}
      </p>
    )
  }
  const { period } = change

  function save() {
    setFailure(null)
    setNotice(null)
    start(async () => {
      const result = await changeContributionAction(pct)
      if (!result.ok) {
        const fields = result.details?.errors
        setFailure({
          message: result.message,
          fields: typeof fields === "object" && fields !== null ? (fields as Record<string, string>) : {},
          seq: (failures += 1),
        })
        return
      }
      setNotice(
        result.data.changed
          ? `Saved. Your contribution is ${result.data.deferralPct}% from the pay period starting ${shortDay(result.data.period.start)}.`
          : `Nothing to save: your contribution is already ${result.data.deferralPct}%.`,
      )
      router.refresh()
    })
  }

  return (
    <form
      className="flex flex-col gap-4"
      aria-label="Change your 401(k) contribution"
      data-testid="contribution-form"
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      <DeferralPicker
        value={pct}
        max={retirement.maxPct}
        onChange={(next) => {
          setPct(next)
          setNotice(null)
        }}
        retirementCents={estimate.retirementCents}
        matchCents={estimate.matchCents}
        capPct={retirement.matchCapPct}
      />

      <div className="flex flex-col gap-1 text-sm" data-testid="contribution-limits">
        {projection?.limitReachedPeriod ? (
          <p>
            At {pct}% you reach the IRS limit of {formatWhole(projection.annualLimitCents)} a year in the pay period ending{" "}
            {shortDay(projection.limitReachedPeriod.end)}. Deductions stop for the rest of {projection.taxYear}.
          </p>
        ) : projection && pct > 0 ? (
          <p className="text-muted-foreground">
            Over {projection.taxYear} that is about {formatWhole(projection.annualDeferralCents)}, under the IRS limit of{" "}
            {formatWhole(projection.annualLimitCents)}.
          </p>
        ) : null}
        {projection?.compensationCapped ? (
          <p className="text-muted-foreground">
            Pay above {formatWhole(projection.compensationLimitCents)} a year does not count toward the employer match.
          </p>
        ) : null}
      </div>

      <p className="text-sm" data-testid="contribution-effective">
        Takes effect with the pay period starting <span className="font-medium">{shortDay(period.start)}</span>
        <span className="text-muted-foreground"> (paid {shortDay(period.payDate)}).</span> Pay slips already issued do not change.
      </p>

      {failure ? <FormError key={failure.seq} message={failure.message} fields={failure.fields} labels={{ deferralPct: "Contribution" }} /> : null}
      {notice ? (
        <p role="status" className="flex items-start gap-2 text-sm font-medium text-status-success-foreground" data-testid="contribution-saved">
          <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
          {notice}
        </p>
      ) : null}

      <div>
        <Button type="submit" disabled={pending || pct === saved} data-testid="contribution-save">
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  )
}
