"use client"

import { useState } from "react"

import { SummaryRow } from "@/components/summary-card"
import { FieldGroup } from "@/components/ui/field"
import {
  W4_FILING_STATUSES,
  W4_FILING_STATUS_LABELS,
  W4_STEPS,
  W4_TAX_YEAR,
  formatDollars,
  formatSsn,
  maskSsn,
  validateW4,
  w4DependentAmounts,
  w4WithDefaults,
  type W4Data,
  type W4Draft,
  type W4FilingStatus,
} from "@/domain/forms"
import { stateName } from "@/lib/us-states"

import { CheckboxField, DollarsField, MaskedField, RadioOption, StateField, TextField } from "./fields"
import { centsToDollars, dollarsToCents, parseCount } from "./money"
import {
  ReviewAndSign,
  signerFrom,
  StepActions,
  StepIndicator,
  StepSection,
  useWizard,
  type RenderPreview,
  type SignedSubmission,
} from "./wizard"

type Form = {
  firstName: string
  middleInitial: string
  lastName: string
  ssn: string
  address: string
  city: string
  state: string
  zip: string
  filingStatus: W4FilingStatus | ""
  multipleJobs: boolean
  qualifyingChildren: string
  otherDependents: string
  otherIncome: string
  deductions: string
  extraWithholding: string
  exempt: boolean
}

function toForm(initial: W4Draft | undefined): Form {
  return {
    firstName: initial?.firstName ?? "",
    middleInitial: initial?.middleInitial ?? "",
    lastName: initial?.lastName ?? "",
    ssn: initial?.ssn ?? "",
    address: initial?.address ?? "",
    city: initial?.city ?? "",
    state: initial?.state ?? "",
    zip: initial?.zip ?? "",
    filingStatus: initial?.filingStatus ?? "",
    multipleJobs: initial?.multipleJobs ?? false,
    qualifyingChildren: initial?.qualifyingChildren ? String(initial.qualifyingChildren) : "",
    otherDependents: initial?.otherDependents ? String(initial.otherDependents) : "",
    otherIncome: centsToDollars(initial?.otherIncomeCents),
    deductions: centsToDollars(initial?.deductionsCents),
    extraWithholding: centsToDollars(initial?.extraWithholdingCents),
    exempt: initial?.exemptFromWithholding ?? false,
  }
}

function toDraft(f: Form): W4Draft {
  return {
    firstName: f.firstName,
    middleInitial: f.middleInitial,
    lastName: f.lastName,
    ssn: f.ssn,
    address: f.address,
    city: f.city,
    state: f.state,
    zip: f.zip,
    filingStatus: f.filingStatus === "" ? undefined : f.filingStatus,
    multipleJobs: f.multipleJobs,
    qualifyingChildren: parseCount(f.qualifyingChildren),
    otherDependents: parseCount(f.otherDependents),
    otherIncomeCents: dollarsToCents(f.otherIncome),
    deductionsCents: dollarsToCents(f.deductions),
    extraWithholdingCents: dollarsToCents(f.extraWithholding),
    exemptFromWithholding: f.exempt,
  }
}

/**
 * Federal Form W-4 (2026) in five steps plus review and signature. Step validation uses
 * `validateW4`; `renderPreview` fills the official PDF for the review step; `onSubmit` receives the
 * typed data and the typed-name signature.
 */
export function W4Wizard({
  initial,
  signerName,
  renderPreview,
  onSubmit,
  onCancel,
}: {
  initial?: W4Draft
  /** Name(s) the signature has to match; defaults to the first and last name entered in step 1. */
  signerName?: string | readonly string[]
  renderPreview: RenderPreview<W4Data>
  onSubmit: (submission: SignedSubmission<W4Data>) => void | Promise<void>
  onCancel?: () => void
}) {
  const [form, setForm] = useState<Form>(() => toForm(initial))
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((prev) => ({ ...prev, [key]: value }))
  const draft = toDraft(form)
  const wizard = useWizard(W4_STEPS, () => validateW4(draft))
  const { errors, bindContainer } = wizard

  const data = w4WithDefaults(draft)
  const amounts = w4DependentAmounts({
    qualifyingChildren: Number.isFinite(draft.qualifyingChildren) ? draft.qualifyingChildren! : 0,
    otherDependents: Number.isFinite(draft.otherDependents) ? draft.otherDependents! : 0,
  })
  const exempt = form.exempt
  const names = signerName ?? [
    `${data.firstName} ${data.lastName}`,
    ...(data.middleInitial ? [`${data.firstName} ${data.middleInitial} ${data.lastName}`] : []),
  ]

  return (
    <div className="flex max-w-2xl flex-col gap-6" data-testid="w4-wizard">
      <StepIndicator
        steps={[...W4_STEPS, { id: "review", label: "Review and sign" }]}
        current={wizard.index}
      />

      <div ref={bindContainer} className="flex flex-col gap-6">
        {wizard.step?.id === "personal" ? (
          <>
            <StepSection title="Step 1: Personal information" description={`Form W-4 (${W4_TAX_YEAR}). Federal withholding only.`}>
              <FieldGroup>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_5rem_1fr]">
                  <TextField label="First name" required value={form.firstName} onChange={(v) => set("firstName", v)} error={errors.firstName} autoComplete="given-name" data-testid="w4-first-name" />
                  <TextField label="M.I." value={form.middleInitial} onChange={(v) => set("middleInitial", v)} error={errors.middleInitial} maxLength={1} data-testid="w4-middle-initial" />
                  <TextField label="Last name" required value={form.lastName} onChange={(v) => set("lastName", v)} error={errors.lastName} autoComplete="family-name" data-testid="w4-last-name" />
                </div>
                <MaskedField
                  label="Social Security number"
                  required
                  value={form.ssn}
                  onChange={(v) => set("ssn", v)}
                  error={errors.ssn}
                  maxLength={11}
                  revealLabel="Social Security number"
                  description="Encrypted when stored and shown masked everywhere except the form itself."
                  data-testid="w4-ssn"
                />
                <TextField label="Street address" required value={form.address} onChange={(v) => set("address", v)} error={errors.address} autoComplete="street-address" data-testid="w4-address" />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1fr_8rem]">
                  <TextField label="City or town" required value={form.city} onChange={(v) => set("city", v)} error={errors.city} data-testid="w4-city" />
                  <StateField value={form.state} onChange={(v) => set("state", v)} error={errors.state} data-testid="w4-state" />
                  <TextField label="ZIP code" required value={form.zip} onChange={(v) => set("zip", v)} error={errors.zip} inputMode="numeric" maxLength={5} data-testid="w4-zip" />
                </div>
              </FieldGroup>
            </StepSection>
            <StepActions onContinue={wizard.next} onCancel={onCancel} />
          </>
        ) : null}

        {wizard.step?.id === "filing" ? (
          <>
            <StepSection title="Step 1(c): Filing status" description="Check the box that matches how you file your federal tax return.">
              <div role="radiogroup" aria-label="Filing status" className="flex flex-col gap-3">
                {W4_FILING_STATUSES.map((status) => (
                  <RadioOption
                    key={status}
                    name="w4-filing-status"
                    value={status}
                    checked={form.filingStatus === status}
                    onChange={(v) => set("filingStatus", v as W4FilingStatus)}
                    label={W4_FILING_STATUS_LABELS[status]}
                    data-testid={`w4-filing-${status}`}
                  />
                ))}
              </div>
              {errors.filingStatus ? <p role="alert" className="text-sm text-destructive">{errors.filingStatus}</p> : null}
            </StepSection>
            <StepActions onBack={wizard.back} onContinue={wizard.next} />
          </>
        ) : null}

        {wizard.step?.id === "jobs" ? (
          <>
            <StepSection
              title="Step 2: Multiple jobs or spouse works"
              description="Complete this step only if you hold more than one job at a time, or you are married filing jointly and your spouse also works."
            >
              <CheckboxField
                label="There are only two jobs total (yours and your spouse's, or two of yours)"
                description="Checking this box is the simplest and most accurate-enough option when pay at the two jobs is similar. Leave it unchecked if this does not apply to you."
                checked={form.multipleJobs}
                onChange={(v) => set("multipleJobs", v)}
                disabled={exempt}
                error={errors.multipleJobs}
                data-testid="w4-multiple-jobs"
              />
            </StepSection>
            <StepActions onBack={wizard.back} onContinue={wizard.next} />
          </>
        ) : null}

        {wizard.step?.id === "dependents" ? (
          <>
            <StepSection
              title="Step 3: Claim dependents"
              description="Only if your income will be $200,000 or less ($400,000 or less if married filing jointly)."
            >
              <FieldGroup>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <TextField
                    label="Qualifying children under age 17"
                    value={form.qualifyingChildren}
                    onChange={(v) => set("qualifyingChildren", v)}
                    error={errors.qualifyingChildren}
                    inputMode="numeric"
                    maxLength={2}
                    placeholder="0"
                    disabled={exempt}
                    description={`× $2,200 = $${formatDollars(amounts.childrenCents)}`}
                    data-testid="w4-children"
                  />
                  <TextField
                    label="Other dependents"
                    value={form.otherDependents}
                    onChange={(v) => set("otherDependents", v)}
                    error={errors.otherDependents}
                    inputMode="numeric"
                    maxLength={2}
                    placeholder="0"
                    disabled={exempt}
                    description={`× $500 = $${formatDollars(amounts.otherCents)}`}
                    data-testid="w4-other-dependents"
                  />
                </div>
                <p className="text-sm font-medium tabular-nums" data-testid="w4-dependents-total">
                  Total credits: ${formatDollars(amounts.totalCents)}
                </p>
              </FieldGroup>
            </StepSection>
            <StepActions onBack={wizard.back} onContinue={wizard.next} />
          </>
        ) : null}

        {wizard.step?.id === "adjustments" ? (
          <>
            <StepSection title="Step 4: Other adjustments" description="All optional.">
              <FieldGroup>
                <DollarsField label="(a) Other income not from jobs" value={form.otherIncome} onChange={(v) => set("otherIncome", v)} error={errors.otherIncomeCents} disabled={exempt} description="Such as interest and dividends. Leave blank if none." data-testid="w4-other-income" />
                <DollarsField label="(b) Deductions" value={form.deductions} onChange={(v) => set("deductions", v)} error={errors.deductionsCents} disabled={exempt} description="Only if you expect to claim deductions other than the standard deduction." data-testid="w4-deductions" />
                <DollarsField label="(c) Extra withholding each pay period" value={form.extraWithholding} onChange={(v) => set("extraWithholding", v)} error={errors.extraWithholdingCents} disabled={exempt} data-testid="w4-extra-withholding" />
                <CheckboxField
                  label="I claim exemption from withholding"
                  description="Only if you had no federal income tax liability last year and expect none this year. Steps 2 to 4 must then be empty."
                  checked={form.exempt}
                  onChange={(v) =>
                    setForm((prev) =>
                      v
                        ? { ...prev, exempt: true, multipleJobs: false, qualifyingChildren: "", otherDependents: "", otherIncome: "", deductions: "", extraWithholding: "" }
                        : { ...prev, exempt: false }
                    )
                  }
                  data-testid="w4-exempt"
                />
              </FieldGroup>
            </StepSection>
            <StepActions onBack={wizard.back} onContinue={wizard.next} continueLabel="Review" />
          </>
        ) : null}
      </div>

      {wizard.isReview ? (
        <ReviewAndSign
          summary={<W4Summary data={data} totalCents={amounts.totalCents} />}
          loadDocument={() => renderPreview(data)}
          documentTitle="Form W-4 (2026)"
          signer={signerFrom(names, "Employee")}
          onBack={wizard.back}
          onSign={({ signature, fieldValues }) => onSubmit({ data, signature, fieldValues })}
        />
      ) : null}
    </div>
  )
}

function W4Summary({ data, totalCents }: { data: W4Data; totalCents: number }) {
  const name = [data.firstName, data.middleInitial, data.lastName].filter(Boolean).join(" ")
  return (
    <>
      <SummaryRow label="Name">{name}</SummaryRow>
      <SummaryRow label="Social Security number">
        <span data-testid="w4-summary-ssn">{maskSsn(formatSsn(data.ssn))}</span>
      </SummaryRow>
      <SummaryRow label="Address">{`${data.address}, ${data.city}, ${stateName(data.state)} ${data.zip}`}</SummaryRow>
      <SummaryRow label="Filing status">{W4_FILING_STATUS_LABELS[data.filingStatus]}</SummaryRow>
      <SummaryRow label="Multiple jobs (Step 2)">{data.multipleJobs ? "Two jobs total" : "No"}</SummaryRow>
      <SummaryRow label="Dependent credits (Step 3)">${formatDollars(totalCents)}</SummaryRow>
      <SummaryRow label="Other income (4a)">${formatDollars(data.otherIncomeCents)}</SummaryRow>
      <SummaryRow label="Deductions (4b)">${formatDollars(data.deductionsCents)}</SummaryRow>
      <SummaryRow label="Extra withholding (4c)">${formatDollars(data.extraWithholdingCents)}</SummaryRow>
      <SummaryRow label="Exempt from withholding">{data.exemptFromWithholding ? "Exempt" : "No"}</SummaryRow>
    </>
  )
}
