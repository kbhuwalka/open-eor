import Link from "next/link"

import { SummaryCard, SummaryRow } from "@/components/summary-card"
import { buttonVariants } from "@/components/ui/button"
import { businessDayOf } from "@/domain/business-time"
import { shortDay } from "@/lib/employee-view"
import { formatCents } from "@/lib/format"
import type { BenefitHistoryEntry, BenefitsPageData } from "@/server/employee-benefits"

import { ContributionForm } from "./contribution-form"

const STATUS_LABEL: Record<BenefitHistoryEntry["status"], string> = {
  in_force: "In force",
  pending: "Starts later",
  superseded: "Replaced",
}

function Section({ title, description, children, testId }: { title: string; description?: string; children: React.ReactNode; testId?: string }) {
  return (
    <section className="flex flex-col gap-3" data-testid={testId}>
      <div>
        <h3 className="text-lg font-medium">{title}</h3>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  )
}

function matchText(retirement: BenefitsPageData["retirement"]): string {
  return retirement.matchRatePct > 0
    ? `${retirement.matchRatePct}% of what you contribute, up to ${retirement.matchCapPct}% of your pay`
    : "None with this package"
}

/** The employee's current elections, the 401(k) change form and the append-only election history (employee-portal.md §7). */
export function BenefitsView({ data }: { data: BenefitsPageData }) {
  const { health, retirement } = data

  if (!data.elected) {
    return (
      <div className="flex flex-col gap-4 rounded-lg border border-dashed border-border p-6" data-testid="benefits-not-elected">
        <p className="text-sm">
          You have not made your benefits choices yet. Your {data.packageLabel} package from {data.employerName} is waiting for you.
        </p>
        {data.decisionHref ? (
          <div>
            <Link href={data.decisionHref} className={buttonVariants()}>
              Choose your benefits
            </Link>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <Section
        title="Health coverage"
        description={`Medical, dental and vision in your ${data.packageLabel} package.`}
        testId="benefits-health"
      >
        <SummaryCard>
          <SummaryRow label="Plan">
            <span data-testid="benefits-health-plan">{health ? health.label : "Waived"}</span>
          </SummaryRow>
          {health ? (
            <>
              <SummaryRow label="Your share per paycheck">{formatCents(health.employeeCents)}</SummaryRow>
              <SummaryRow label={`${data.employerName} pays per paycheck`}>{formatCents(health.employerCents)}</SummaryRow>
            </>
          ) : null}
        </SummaryCard>
        <p className="text-sm text-muted-foreground" data-testid="benefits-health-note">
          Health coverage changes go through Northwind, not this page. Contact Northwind if your situation changes.
        </p>
      </Section>

      <Section
        title="401(k) retirement savings"
        description="Contributions come out of your paycheck before income tax."
        testId="benefits-retirement"
      >
        <SummaryCard>
          <SummaryRow label="Your contribution">
            <span data-testid="benefits-current-pct">{retirement.currentPct}% of each paycheck</span>
          </SummaryRow>
          {retirement.pending ? (
            <SummaryRow label={`From ${shortDay(retirement.pending.period.start)}`}>
              <span data-testid="benefits-pending">{retirement.pending.pct}% of each paycheck</span>
            </SummaryRow>
          ) : null}
          <SummaryRow label="You put in per paycheck">{formatCents(retirement.perPaycheck.deferralCents)}</SummaryRow>
          <SummaryRow label="Employer match">{matchText(retirement)}</SummaryRow>
          {retirement.matchRatePct > 0 ? (
            <SummaryRow label="Employer adds per paycheck">{formatCents(retirement.perPaycheck.matchCents)}</SummaryRow>
          ) : null}
          <SummaryRow label="Annual IRS limit on your contributions">
            <span data-testid="benefits-irs-limit">{formatCents(retirement.annualLimitCents).replace(/\.00$/, "")}</span>
          </SummaryRow>
        </SummaryCard>
        <p className="text-xs text-muted-foreground">
          Per-paycheck amounts are for a full paycheck of {formatCents(retirement.grossPerPeriodCents)} before taxes. Your pay slip shows the exact amounts.
        </p>
      </Section>

      <Section title="Change your contribution" testId="benefits-change">
        <ContributionForm data={data} />
      </Section>

      <Section title="History" description="Every election, newest first. Past pay slips and invoices keep the election that applied to them." testId="benefits-history">
        <ol className="flex flex-col gap-2">
          {data.history.map((entry) => (
            <li key={entry.version} className="flex flex-col gap-0.5 rounded-lg border border-border px-4 py-3 text-sm" data-testid="benefits-history-entry">
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-medium">
                  {entry.retirementDeferralPct}% 401(k)
                  {entry.healthLabel ? `, ${entry.healthLabel}` : ", health waived"}
                </span>
                <span className="text-xs text-muted-foreground">{STATUS_LABEL[entry.status]}</span>
              </div>
              <span className="text-xs text-muted-foreground">
                {entry.effectiveFrom ? `From the pay period starting ${shortDay(entry.effectiveFrom)}` : "From your first day"}
                {" · "}
                {entry.source === "onboarding" ? "Chosen" : "Changed"} by {entry.decidedBy} on {shortDay(businessDayOf(entry.decidedAt))}
              </span>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  )
}
