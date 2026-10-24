"use client"

import { useState } from "react"
import Link from "next/link"
import { cn } from "cn"

import { RadioOption } from "@/components/tax-forms/fields"
import { SummaryCard, SummaryRow } from "@/components/summary-card"
import { Button } from "@/components/ui/button"
import { HEALTH_TIER_LABELS, type HealthTier } from "@/domain/cost-rates"
import { benefitEstimate } from "@/lib/employee-benefits"
import type { BenefitElectionView, BenefitsScreenData, EmployeeScreenData } from "@/lib/employee-screen-data"
import { formatCents } from "@/lib/format"
import { submitBenefitsAction } from "@/app/worker/tasks/actions"

import { CompletedPanel } from "./completed-panel"
import { DeferralPicker } from "./deferral-picker"
import { FormError } from "./form-error"
import { EmployeeTaskFrame } from "./task-frame"
import { useTaskFlow } from "./use-task-flow"

type Data = Extract<EmployeeScreenData, { kind: "benefits_decision" }>

/** `null` = not chosen yet; `"waive"` = no health coverage. */
type HealthChoice = HealthTier | "waive" | null

const WAIVE = "waive"

function describe(benefits: BenefitsScreenData, health: HealthChoice, pct: number) {
  const tier = health && health !== WAIVE ? health : null
  const estimate = benefitEstimate({ package: benefits.package, tier, deferralPct: pct, grossCents: benefits.grossPerPeriodCents })
  return { tier, estimate, waivesAll: tier === null && pct === 0 }
}

function Money({ cents, className }: { cents: number; className?: string }) {
  return <span className={cn("tabular-nums", className)}>{formatCents(cents)}</span>
}

function healthLabel(health: HealthChoice): string {
  return health && health !== WAIVE ? HEALTH_TIER_LABELS[health] : "Waived"
}

/**
 * The initial benefits decision: a health tier or a waiver, a 401(k) deferral with the employer
 * match, a live per-paycheck estimate and a confirmation step. A finished decision is shown
 * read-only; the 401(k) is changed later on the Benefits page and coverage through Northwind.
 */
export function BenefitsScreen({ data }: { data: Data }) {
  const { benefits } = data
  const flow = useTaskFlow()
  const decided = benefits.election !== null && Boolean(data.completed)
  const [step, setStep] = useState<"choose" | "confirm">("choose")
  const election = benefits.election
  const [health, setHealth] = useState<HealthChoice>(() =>
    election ? (election.enrolled && election.healthTier ? election.healthTier : "waive") : null,
  )
  const [pct, setPct] = useState(() => election?.retirementDeferralPct ?? benefits.match.defaultPct)
  const [invalid, setInvalid] = useState<string | null>(null)

  const { estimate, tier, waivesAll } = describe(benefits, health, pct)
  const choice = { healthTier: tier, retirementDeferralPct: pct }
  const canEdit = data.canAct

  function toConfirm() {
    if (health === null) {
      setInvalid("Choose a health coverage option, or waive coverage.")
      return
    }
    setInvalid(null)
    setStep("confirm")
    window.scrollTo?.({ top: 0 })
  }

  function confirm() {
    flow.run(() => submitBenefitsAction(data.taskId, choice))
  }

  if (decided && election) {
    return (
      <EmployeeTaskFrame data={data} description={`Your ${benefits.packageLabel} benefits package, as you chose it.`}>
        <ElectionView benefits={benefits} election={election} />
        {data.completed ? <CompletedPanel data={{ ...data, completed: data.completed }} /> : null}
      </EmployeeTaskFrame>
    )
  }

  return (
    <EmployeeTaskFrame
      data={data}
      description={`${benefits.packageDescription} Choose what you want deducted from each paycheck, or waive what you do not need.`}
    >
      {step === "choose" ? (
        <div className="flex flex-col gap-8" data-testid="benefits-choose">
          <fieldset className="flex flex-col gap-3" disabled={!canEdit}>
            <legend className="mb-1 text-lg font-medium">Health coverage</legend>
            <p className="-mt-1 text-sm text-muted-foreground">
              Medical, dental and vision. Your employer pays part of every premium; the amount shown is your share per paycheck.
            </p>
            <div role="radiogroup" aria-label="Health coverage" className="flex flex-col gap-3">
              {benefits.tiers.map((option) => (
                <RadioOption
                  key={option.tier}
                  name="health"
                  value={option.tier}
                  checked={health === option.tier}
                  onChange={() => setHealth(option.tier)}
                  label={`${option.label}: ${formatCents(option.employeeCents)} per paycheck`}
                  description={`Your employer covers ${formatCents(option.employerCents)} of the ${formatCents(option.totalCents)} premium each pay period.`}
                  data-testid={`health-${option.tier}`}
                />
              ))}
              <RadioOption
                name="health"
                value={WAIVE}
                checked={health === WAIVE}
                onChange={() => setHealth(WAIVE)}
                label="Waive health coverage"
                description="No health deduction. You confirm you have coverage elsewhere or choose to go without."
                data-testid="health-waive"
              />
            </div>
            {invalid ? (
              <p role="alert" className="text-sm text-destructive" data-testid="health-error">
                {invalid}
              </p>
            ) : null}
          </fieldset>

          <fieldset className="flex flex-col gap-3" disabled={!canEdit}>
            <legend className="mb-1 text-lg font-medium">401(k) retirement savings</legend>
            <p className="-mt-1 text-sm text-muted-foreground">
              {benefits.match.ratePct > 0
                ? `Your employer adds ${benefits.match.ratePct}% of what you contribute, up to ${benefits.match.capPct}% of your pay.`
                : "Contributions come out of your paycheck before income tax."}{" "}
              Set 0% to skip.
            </p>
            <DeferralPicker
              value={pct}
              max={benefits.match.maxPct}
              onChange={setPct}
              retirementCents={estimate.retirementCents}
              matchCents={estimate.matchCents}
              capPct={benefits.match.capPct}
            />
          </fieldset>

          <Estimate benefits={benefits} health={health} pct={pct} />
          <div className="flex items-center gap-2">
            <Button type="button" disabled={!canEdit} onClick={toConfirm} data-testid="benefits-continue">
              Continue
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-6" data-testid="benefits-confirm">
          <section className="flex flex-col gap-3">
            <h3 className="text-lg font-medium">Confirm your choices</h3>
            {waivesAll ? (
              <p className="text-sm" data-testid="waive-all">
                You are declining all benefits. You can still start a 401(k) contribution later on the Benefits page.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                You can change your 401(k) contribution at any time on the Benefits page; it applies from the next pay
                period. Health coverage changes go through Northwind.
              </p>
            )}
            <Estimate benefits={benefits} health={health} pct={pct} compact />
          </section>
          <FormError key={flow.error?.seq} message={flow.error?.message ?? null} />
          <div className="flex items-center gap-2">
            <Button type="button" disabled={flow.pending} onClick={confirm} data-testid="benefits-confirm-button">
              {flow.pending ? "Saving…" : waivesAll ? "Decline benefits" : "Confirm my benefits"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setStep("choose")} data-testid="benefits-back">
              Back
            </Button>
          </div>
        </div>
      )}
    </EmployeeTaskFrame>
  )
}

function Estimate({
  benefits,
  health,
  pct,
  compact = false,
}: {
  benefits: BenefitsScreenData
  health: HealthChoice
  pct: number
  compact?: boolean
}) {
  const { estimate } = describe(benefits, health, pct)
  return (
    <section aria-label="Estimated per-paycheck deductions" className="flex flex-col gap-2" data-testid="benefits-estimate">
      {compact ? null : <h3 className="text-lg font-medium">Estimated per-paycheck deductions</h3>}
      <SummaryCard aria-live="polite">
        <SummaryRow label="Health coverage">
          <span data-testid="estimate-health">
            {health === null ? "Not chosen" : health === WAIVE ? "Waived" : <Money cents={estimate.healthCents} />}
          </span>
        </SummaryRow>
        {compact && health ? <SummaryRow label="Plan">{healthLabel(health)}</SummaryRow> : null}
        <SummaryRow label={`401(k) at ${pct}%`}>
          <Money cents={estimate.retirementCents} />
        </SummaryRow>
        <SummaryRow label="Total before taxes" strong>
          <span data-testid="estimate-total">
            <Money cents={estimate.totalCents} />
          </span>
        </SummaryRow>
        {estimate.matchCents > 0 ? (
          <SummaryRow label="Your employer adds to your 401(k)">
            <Money cents={estimate.matchCents} />
          </SummaryRow>
        ) : null}
      </SummaryCard>
      <p className="text-xs text-muted-foreground">
        Estimates for a full paycheck of {formatCents(benefits.grossPerPeriodCents)} before taxes. Your pay slip shows the exact amounts.
      </p>
    </section>
  )
}

function ElectionView({ benefits, election }: { benefits: BenefitsScreenData; election: BenefitElectionView }) {
  const health: HealthChoice = election.enrolled && election.healthTier ? election.healthTier : "waive"
  const pct = election.enrolled ? (election.retirementDeferralPct ?? 0) : 0
  return (
    <section className="flex flex-col gap-4" data-testid="benefits-election">
      {!election.enrolled ? (
        <p className="text-sm" data-testid="benefits-declined">
          You declined benefits.
        </p>
      ) : null}
      <Estimate benefits={benefits} health={health} pct={pct} compact />
      <p className="text-sm text-muted-foreground" data-testid="benefits-elsewhere">
        Change your 401(k) contribution any time on the{" "}
        <Link href="/worker/benefits" className="font-medium text-foreground underline underline-offset-4">
          Benefits page
        </Link>
        . Health coverage changes go through Northwind.
      </p>
    </section>
  )
}
