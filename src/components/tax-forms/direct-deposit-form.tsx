"use client"

import { useState } from "react"

import { SummaryRow } from "@/components/summary-card"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { OptionSelect } from "@/components/ui/option-select"
import {
  DEPOSIT_ACCOUNT_TYPES,
  DIRECT_DEPOSIT_STEPS,
  formatDollars,
  maskAccountNumber,
  validateDirectDeposit,
  type DepositAccountType,
  type DepositAllocation,
  type DirectDepositData,
  type DirectDepositDraft,
} from "@/domain/forms"

import { DollarsField, MaskedField, RadioOption, TextField } from "./fields"
import { centsToDollars, dollarsToCents } from "./money"
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

const ACCOUNT_TYPE_OPTIONS = DEPOSIT_ACCOUNT_TYPES.map((t) => ({ value: t, label: t === "checking" ? "Checking" : "Savings" }))

type Form = {
  bankName: string
  accountHolderName: string
  accountType: DepositAccountType | ""
  routingNumber: string
  accountNumber: string
  allocation: DepositAllocation | ""
  fixedAmount: string
}

function toDraft(f: Form): DirectDepositDraft {
  return {
    bankName: f.bankName,
    accountHolderName: f.accountHolderName,
    accountType: f.accountType === "" ? undefined : f.accountType,
    routingNumber: f.routingNumber,
    accountNumber: f.accountNumber,
    allocation: f.allocation === "" ? undefined : f.allocation,
    fixedAmountCents: f.allocation === "fixed_amount" ? dollarsToCents(f.fixedAmount) : 0,
  }
}

/**
 * Direct deposit authorization in two steps (bank, amount) plus review and signature. The routing
 * number is checked with the ABA checksum; the account number is hidden while typed and masked in the
 * review summary (the generated PDF is the only place it appears in full).
 */
export function DirectDepositForm({
  initial,
  signerName,
  renderPreview,
  onSubmit,
  onCancel,
  allowSplit = true,
}: {
  /** `false` drops the Amount step: the whole net pay goes to this account (no split between accounts). */
  allowSplit?: boolean
  initial?: DirectDepositDraft
  /** Name(s) the signature has to match; defaults to the account holder name. */
  signerName?: string | readonly string[]
  renderPreview: RenderPreview<DirectDepositData>
  onSubmit: (submission: SignedSubmission<DirectDepositData>) => void | Promise<void>
  onCancel?: () => void
}) {
  const [form, setForm] = useState<Form>(() => ({
    bankName: initial?.bankName ?? "",
    accountHolderName: initial?.accountHolderName ?? "",
    accountType: initial?.accountType ?? "",
    routingNumber: initial?.routingNumber ?? "",
    accountNumber: initial?.accountNumber ?? "",
    allocation: initial?.allocation ?? "entire_net_pay",
    fixedAmount: centsToDollars(initial?.fixedAmountCents),
  }))
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((prev) => ({ ...prev, [key]: value }))
  const draft = toDraft(form)
  const steps = allowSplit ? DIRECT_DEPOSIT_STEPS : DIRECT_DEPOSIT_STEPS.slice(0, 1)
  const wizard = useWizard(steps, () => validateDirectDeposit(draft))
  const { errors, bindContainer } = wizard

  const data: DirectDepositData = {
    bankName: form.bankName.trim(),
    accountHolderName: form.accountHolderName.trim(),
    routingNumber: form.routingNumber.trim(),
    accountNumber: form.accountNumber.trim(),
    accountType: form.accountType === "" ? "checking" : form.accountType,
    allocation: form.allocation === "" ? "entire_net_pay" : form.allocation,
    fixedAmountCents: form.allocation === "fixed_amount" ? dollarsToCents(form.fixedAmount) : 0,
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6" data-testid="direct-deposit-form">
      <StepIndicator steps={[...steps, { id: "review", label: "Review and sign" }]} current={wizard.index} />

      <div ref={bindContainer} className="flex flex-col gap-6">
        {wizard.step?.id === "bank" ? (
          <>
            <StepSection title="Bank account" description="Where your net pay should be deposited.">
              <FieldGroup>
                <TextField label="Bank name" required value={form.bankName} onChange={(v) => set("bankName", v)} error={errors.bankName} data-testid="dd-bank-name" />
                <TextField label="Name on account" required value={form.accountHolderName} onChange={(v) => set("accountHolderName", v)} error={errors.accountHolderName} data-testid="dd-holder" />
                <Field data-invalid={errors.accountType ? true : undefined}>
                  <FieldLabel htmlFor="dd-account-type">Account type *</FieldLabel>
                  <OptionSelect
                    id="dd-account-type"
                    options={ACCOUNT_TYPE_OPTIONS}
                    value={form.accountType}
                    onValueChange={(v) => set("accountType", v as DepositAccountType | "")}
                    placeholder="Select an account type…"
                    invalid={Boolean(errors.accountType)}
                    data-testid="dd-account-type"
                  />
                  <FieldError>{errors.accountType}</FieldError>
                </Field>
                <MaskedField
                  label="Routing number (ABA)"
                  required
                  value={form.routingNumber}
                  onChange={(v) => set("routingNumber", v.replace(/\D/g, ""))}
                  error={errors.routingNumber}
                  maxLength={9}
                  revealLabel="routing number"
                  description="Nine digits, printed on the bottom left of a check."
                  data-testid="dd-routing"
                />
                <MaskedField
                  label="Account number"
                  required
                  value={form.accountNumber}
                  onChange={(v) => set("accountNumber", v.replace(/\D/g, ""))}
                  error={errors.accountNumber}
                  maxLength={17}
                  revealLabel="account number"
                  data-testid="dd-account"
                />
              </FieldGroup>
            </StepSection>
            <StepActions onContinue={wizard.next} continueLabel={allowSplit ? "Continue" : "Review"} onCancel={onCancel} />
          </>
        ) : null}

        {wizard.step?.id === "allocation" ? (
          <>
            <StepSection title="Amount">
              <div role="radiogroup" aria-label="Deposit amount" className="flex flex-col gap-3">
                <RadioOption name="dd-allocation" value="entire_net_pay" checked={form.allocation === "entire_net_pay"} onChange={() => set("allocation", "entire_net_pay")} label="My entire net pay" data-testid="dd-allocation-entire" />
                <RadioOption name="dd-allocation" value="fixed_amount" checked={form.allocation === "fixed_amount"} onChange={() => set("allocation", "fixed_amount")} label="A fixed amount each pay period" description="The rest goes to your default method of payment." data-testid="dd-allocation-fixed" />
              </div>
              {errors.allocation ? <p role="alert" className="text-sm text-destructive">{errors.allocation}</p> : null}
              {form.allocation === "fixed_amount" ? (
                <DollarsField label="Amount per pay period" required value={form.fixedAmount} onChange={(v) => set("fixedAmount", v)} error={errors.fixedAmountCents} data-testid="dd-fixed-amount" />
              ) : null}
            </StepSection>
            <StepActions onBack={wizard.back} onContinue={wizard.next} continueLabel="Review" />
          </>
        ) : null}
      </div>

      {wizard.isReview ? (
        <ReviewAndSign
          summary={
            <>
              <SummaryRow label="Bank">{data.bankName}</SummaryRow>
              <SummaryRow label="Name on account">{data.accountHolderName}</SummaryRow>
              <SummaryRow label="Account type">{data.accountType === "checking" ? "Checking" : "Savings"}</SummaryRow>
              <SummaryRow label="Routing number">{data.routingNumber}</SummaryRow>
              <SummaryRow label="Account number">
                <span data-testid="dd-summary-account">{maskAccountNumber(data.accountNumber)}</span>
              </SummaryRow>
              <SummaryRow label="Amount">
                {data.allocation === "entire_net_pay" ? "Entire net pay" : `$${formatDollars(data.fixedAmountCents)} per pay period`}
              </SummaryRow>
            </>
          }
          loadDocument={() => renderPreview(data)}
          documentTitle="Direct Deposit Authorization"
          signer={signerFrom(signerName ?? data.accountHolderName, "Employee")}
          onBack={wizard.back}
          onSign={({ signature, fieldValues }) => onSubmit({ data, signature, fieldValues })}
        />
      ) : null}
    </div>
  )
}
