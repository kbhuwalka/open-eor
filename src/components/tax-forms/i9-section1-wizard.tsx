"use client"

import { useState } from "react"

import { SummaryRow } from "@/components/summary-card"
import { FieldGroup } from "@/components/ui/field"
import {
  I9_ATTESTATION_LABELS,
  I9_ATTESTATION_STATUSES,
  I9_EDITION,
  I9_SECTION1_STEPS,
  formatSsn,
  formatUsPhone,
  isoToUs,
  maskSsn,
  validateI9Section1,
  type I9AttestationStatus,
  type I9Section1Data,
  type I9Section1Draft,
} from "@/domain/forms"
import { stateName } from "@/lib/us-states"

import { CheckboxField, MaskedField, RadioOption, StateField, TextField, TypedDateField, typedDateToIso } from "./fields"
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
  lastName: string
  firstName: string
  middleInitial: string
  otherLastNames: string
  address: string
  aptNumber: string
  city: string
  state: string
  zip: string
  dateOfBirth: string
  ssn: string
  email: string
  phone: string
  status: I9AttestationStatus | ""
  uscisNumber: string
  i94Number: string
  foreignPassportNumber: string
  foreignPassportCountry: string
  workAuthExpiresOn: string
  usedPreparer: boolean
  pLastName: string
  pFirstName: string
  pMiddleInitial: string
  pAddress: string
  pCity: string
  pState: string
  pZip: string
}

function toForm(initial: I9Section1Draft | undefined): Form {
  return {
    lastName: initial?.lastName ?? "",
    firstName: initial?.firstName ?? "",
    middleInitial: initial?.middleInitial ?? "",
    otherLastNames: initial?.otherLastNames ?? "",
    address: initial?.address ?? "",
    aptNumber: initial?.aptNumber ?? "",
    city: initial?.city ?? "",
    state: initial?.state ?? "",
    zip: initial?.zip ?? "",
    dateOfBirth: initial?.dateOfBirth ? isoToUs(initial.dateOfBirth) : "",
    ssn: initial?.ssn ?? "",
    email: initial?.email ?? "",
    phone: initial?.phone ?? "",
    status: initial?.attestation?.status ?? "",
    uscisNumber: initial?.attestation?.uscisNumber ?? "",
    i94Number: initial?.attestation?.i94Number ?? "",
    foreignPassportNumber: initial?.attestation?.foreignPassportNumber ?? "",
    foreignPassportCountry: initial?.attestation?.foreignPassportCountry ?? "",
    workAuthExpiresOn: initial?.attestation?.workAuthExpiresOn ? isoToUs(initial.attestation.workAuthExpiresOn) : "",
    usedPreparer: Boolean(initial?.preparer),
    pLastName: initial?.preparer?.lastName ?? "",
    pFirstName: initial?.preparer?.firstName ?? "",
    pMiddleInitial: initial?.preparer?.middleInitial ?? "",
    pAddress: initial?.preparer?.address ?? "",
    pCity: initial?.preparer?.city ?? "",
    pState: initial?.preparer?.state ?? "",
    pZip: initial?.preparer?.zip ?? "",
  }
}

function toDraft(f: Form): I9Section1Draft {
  const lpr = f.status === "lawful_permanent_resident"
  const alien = f.status === "authorized_alien"
  return {
    lastName: f.lastName,
    firstName: f.firstName,
    middleInitial: f.middleInitial,
    otherLastNames: f.otherLastNames,
    address: f.address,
    aptNumber: f.aptNumber,
    city: f.city,
    state: f.state,
    zip: f.zip,
    dateOfBirth: typedDateToIso(f.dateOfBirth),
    ssn: f.ssn,
    email: f.email,
    phone: f.phone,
    attestation: {
      status: f.status === "" ? undefined : f.status,
      uscisNumber: lpr || alien ? f.uscisNumber : "",
      i94Number: alien ? f.i94Number : "",
      foreignPassportNumber: alien ? f.foreignPassportNumber : "",
      foreignPassportCountry: alien ? f.foreignPassportCountry : "",
      workAuthExpiresOn: alien ? typedDateToIso(f.workAuthExpiresOn) : "",
    },
    preparer: f.usedPreparer
      ? {
          lastName: f.pLastName,
          firstName: f.pFirstName,
          middleInitial: f.pMiddleInitial,
          address: f.pAddress,
          city: f.pCity,
          state: f.pState,
          zip: f.pZip,
        }
      : null,
  }
}

/** A draft that passed `validateI9Section1`, with every optional blank filled. */
function toData(d: I9Section1Draft): I9Section1Data {
  const a = d.attestation ?? {}
  const p = d.preparer
  const trim = (v: string | undefined) => (v ?? "").trim()
  return {
    lastName: trim(d.lastName),
    firstName: trim(d.firstName),
    middleInitial: trim(d.middleInitial),
    otherLastNames: trim(d.otherLastNames),
    address: trim(d.address),
    aptNumber: trim(d.aptNumber),
    city: trim(d.city),
    state: d.state ?? "",
    zip: trim(d.zip),
    dateOfBirth: d.dateOfBirth ?? "",
    ssn: trim(d.ssn) ? formatSsn(trim(d.ssn)) : "",
    email: trim(d.email),
    phone: trim(d.phone) ? formatUsPhone(trim(d.phone)) : "",
    attestation: {
      status: a.status ?? "citizen",
      uscisNumber: trim(a.uscisNumber),
      i94Number: trim(a.i94Number),
      foreignPassportNumber: trim(a.foreignPassportNumber),
      foreignPassportCountry: trim(a.foreignPassportCountry),
      workAuthExpiresOn: a.workAuthExpiresOn ?? "",
    },
    preparer: p
      ? {
          lastName: trim(p.lastName),
          firstName: trim(p.firstName),
          middleInitial: trim(p.middleInitial),
          address: trim(p.address),
          city: trim(p.city),
          state: p.state ?? "",
          zip: trim(p.zip),
        }
      : null,
  }
}

/**
 * Form I-9 Section 1 (employee) in three steps plus review and signature. Step validation uses
 * `validateI9Section1`; the attestation step shows the A-Number, I-94 and passport fields the chosen
 * status calls for.
 */
export function I9Section1Wizard({
  initial,
  signerName,
  today,
  renderPreview,
  onSubmit,
  onCancel,
}: {
  initial?: I9Section1Draft
  /** Name(s) the signature has to match; defaults to the first and last name entered in step 1. */
  signerName?: string | readonly string[]
  /** `YYYY-MM-DD`, for date-of-birth and expiry checks; defaults to the current day. */
  today?: string
  renderPreview: RenderPreview<I9Section1Data>
  onSubmit: (submission: SignedSubmission<I9Section1Data>) => void | Promise<void>
  onCancel?: () => void
}) {
  const [form, setForm] = useState<Form>(() => toForm(initial))
  const [fallbackToday] = useState(() => new Date().toISOString().slice(0, 10))
  const asOf = today ?? fallbackToday
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((prev) => ({ ...prev, [key]: value }))
  const draft = toDraft(form)
  const wizard = useWizard(I9_SECTION1_STEPS, () => validateI9Section1(draft, { today: asOf }))
  const { errors, bindContainer } = wizard
  const data = toData(draft)
  const names = signerName ?? [
    `${data.firstName} ${data.lastName}`,
    ...(data.middleInitial ? [`${data.firstName} ${data.middleInitial} ${data.lastName}`] : []),
  ]
  const lpr = form.status === "lawful_permanent_resident"
  const alien = form.status === "authorized_alien"

  return (
    <div className="flex max-w-2xl flex-col gap-6" data-testid="i9-section1-wizard">
      <StepIndicator
        steps={[...I9_SECTION1_STEPS, { id: "review", label: "Review and sign" }]}
        current={wizard.index}
      />

      <div ref={bindContainer} className="flex flex-col gap-6">
        {wizard.step?.id === "personal" ? (
          <>
            <StepSection title="Section 1: Employee information" description={`Form I-9 (edition ${I9_EDITION}).`}>
              <FieldGroup>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1fr_5rem]">
                  <TextField label="Last name (family name)" required value={form.lastName} onChange={(v) => set("lastName", v)} error={errors.lastName} autoComplete="family-name" data-testid="i9-last-name" />
                  <TextField label="First name (given name)" required value={form.firstName} onChange={(v) => set("firstName", v)} error={errors.firstName} autoComplete="given-name" data-testid="i9-first-name" />
                  <TextField label="M.I." value={form.middleInitial} onChange={(v) => set("middleInitial", v)} error={errors.middleInitial} maxLength={1} data-testid="i9-middle-initial" />
                </div>
                <TextField label="Other last names used" value={form.otherLastNames} onChange={(v) => set("otherLastNames", v)} error={errors.otherLastNames} description="Leave blank if none." data-testid="i9-other-names" />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_9rem]">
                  <TextField label="Street address" required value={form.address} onChange={(v) => set("address", v)} error={errors.address} autoComplete="street-address" data-testid="i9-address" />
                  <TextField label="Apt. number" value={form.aptNumber} onChange={(v) => set("aptNumber", v)} data-testid="i9-apt" />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1fr_8rem]">
                  <TextField label="City or town" required value={form.city} onChange={(v) => set("city", v)} error={errors.city} data-testid="i9-city" />
                  <StateField value={form.state} onChange={(v) => set("state", v)} error={errors.state} data-testid="i9-state" />
                  <TextField label="ZIP code" required value={form.zip} onChange={(v) => set("zip", v)} error={errors.zip} inputMode="numeric" maxLength={5} data-testid="i9-zip" />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <TypedDateField label="Date of birth" required value={form.dateOfBirth} onChange={(v) => set("dateOfBirth", v)} error={errors.dateOfBirth} data-testid="i9-dob" />
                  <MaskedField
                    label="U.S. Social Security number"
                    value={form.ssn}
                    onChange={(v) => set("ssn", v)}
                    error={errors.ssn}
                    maxLength={11}
                    revealLabel="Social Security number"
                    description="Optional unless your employer uses E-Verify."
                    data-testid="i9-ssn"
                  />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <TextField label="Email address" type="email" inputMode="email" value={form.email} onChange={(v) => set("email", v)} error={errors.email} autoComplete="email" data-testid="i9-email" />
                  <TextField label="Telephone number" type="tel" inputMode="tel" value={form.phone} onChange={(v) => set("phone", v)} error={errors.phone} autoComplete="tel" data-testid="i9-phone" />
                </div>
              </FieldGroup>
            </StepSection>
            <StepActions onContinue={wizard.next} onCancel={onCancel} />
          </>
        ) : null}

        {wizard.step?.id === "attestation" ? (
          <>
            <StepSection title="Citizenship or immigration status" description="I attest, under penalty of perjury, that I am (check one):">
              <div role="radiogroup" aria-label="Citizenship or immigration status" className="flex flex-col gap-3">
                {I9_ATTESTATION_STATUSES.map((status) => (
                  <RadioOption
                    key={status}
                    name="i9-status"
                    value={status}
                    checked={form.status === status}
                    onChange={(v) => set("status", v as I9AttestationStatus)}
                    label={I9_ATTESTATION_LABELS[status]}
                    data-testid={`i9-status-${status}`}
                  />
                ))}
              </div>
              {errors["attestation.status"] ? (
                <p role="alert" className="text-sm text-destructive">{errors["attestation.status"]}</p>
              ) : null}
            </StepSection>

            {lpr ? (
              <StepSection title="Lawful permanent resident details">
                <TextField
                  label="USCIS A-Number"
                  required
                  value={form.uscisNumber}
                  onChange={(v) => set("uscisNumber", v)}
                  error={errors["attestation.uscisNumber"]}
                  maxLength={10}
                  placeholder="A123456789"
                  data-testid="i9-uscis-number"
                />
              </StepSection>
            ) : null}

            {alien ? (
              <StepSection
                title="Alien authorized to work"
                description="Enter at least one of: a USCIS A-Number, a Form I-94 admission number, or a foreign passport number and country."
              >
                <FieldGroup>
                  <TypedDateField
                    label="Work authorization expires on"
                    value={form.workAuthExpiresOn}
                    onChange={(v) => set("workAuthExpiresOn", v)}
                    error={errors["attestation.workAuthExpiresOn"]}
                    description="Leave blank if it has no expiration date."
                    data-testid="i9-work-auth-expires"
                  />
                  <TextField label="USCIS A-Number" value={form.uscisNumber} onChange={(v) => set("uscisNumber", v)} error={errors["attestation.uscisNumber"]} maxLength={10} placeholder="A123456789" data-testid="i9-uscis-number" />
                  <TextField label="Form I-94 admission number" value={form.i94Number} onChange={(v) => set("i94Number", v)} error={errors["attestation.i94Number"]} maxLength={11} data-testid="i9-i94" />
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <TextField label="Foreign passport number" value={form.foreignPassportNumber} onChange={(v) => set("foreignPassportNumber", v)} error={errors["attestation.foreignPassportNumber"]} data-testid="i9-passport-number" />
                    <TextField label="Country of issuance" value={form.foreignPassportCountry} onChange={(v) => set("foreignPassportCountry", v)} error={errors["attestation.foreignPassportCountry"]} data-testid="i9-passport-country" />
                  </div>
                </FieldGroup>
              </StepSection>
            ) : null}
            <StepActions onBack={wizard.back} onContinue={wizard.next} />
          </>
        ) : null}

        {wizard.step?.id === "preparer" ? (
          <>
            <StepSection title="Preparer or translator" description="Supplement A of the I-9. Only needed if someone helped you complete Section 1.">
              <CheckboxField
                label="A preparer or translator helped me complete Section 1"
                checked={form.usedPreparer}
                onChange={(v) => set("usedPreparer", v)}
                data-testid="i9-used-preparer"
              />
              {form.usedPreparer ? (
                <FieldGroup>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1fr_5rem]">
                    <TextField label="Last name" required value={form.pLastName} onChange={(v) => set("pLastName", v)} error={errors["preparer.lastName"]} data-testid="i9-prep-last-name" />
                    <TextField label="First name" required value={form.pFirstName} onChange={(v) => set("pFirstName", v)} error={errors["preparer.firstName"]} data-testid="i9-prep-first-name" />
                    <TextField label="M.I." value={form.pMiddleInitial} onChange={(v) => set("pMiddleInitial", v)} error={errors["preparer.middleInitial"]} maxLength={1} />
                  </div>
                  <TextField label="Street address" required value={form.pAddress} onChange={(v) => set("pAddress", v)} error={errors["preparer.address"]} data-testid="i9-prep-address" />
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1fr_8rem]">
                    <TextField label="City or town" required value={form.pCity} onChange={(v) => set("pCity", v)} error={errors["preparer.city"]} data-testid="i9-prep-city" />
                    <StateField value={form.pState} onChange={(v) => set("pState", v)} error={errors["preparer.state"]} data-testid="i9-prep-state" />
                    <TextField label="ZIP code" required value={form.pZip} onChange={(v) => set("pZip", v)} error={errors["preparer.zip"]} inputMode="numeric" maxLength={5} data-testid="i9-prep-zip" />
                  </div>
                </FieldGroup>
              ) : null}
            </StepSection>
            <StepActions onBack={wizard.back} onContinue={wizard.next} continueLabel="Review" />
          </>
        ) : null}
      </div>

      {wizard.isReview ? (
        <ReviewAndSign
          summary={<I9Section1Summary data={data} />}
          loadDocument={() => renderPreview(data)}
          documentTitle="Form I-9, Section 1"
          signer={signerFrom(names, "Employee")}
          onBack={wizard.back}
          onSign={({ signature, fieldValues }) => onSubmit({ data, signature, fieldValues })}
        />
      ) : null}
    </div>
  )
}

function I9Section1Summary({ data }: { data: I9Section1Data }) {
  const name = [data.firstName, data.middleInitial, data.lastName].filter(Boolean).join(" ")
  const a = data.attestation
  const details = [
    a.uscisNumber && `A-Number ${a.uscisNumber}`,
    a.i94Number && `I-94 ${a.i94Number}`,
    a.foreignPassportNumber && `Passport ${a.foreignPassportNumber} (${a.foreignPassportCountry})`,
    a.workAuthExpiresOn && `Expires ${isoToUs(a.workAuthExpiresOn)}`,
  ].filter(Boolean)
  return (
    <>
      <SummaryRow label="Name">{name}</SummaryRow>
      {data.otherLastNames ? <SummaryRow label="Other last names">{data.otherLastNames}</SummaryRow> : null}
      <SummaryRow label="Address">
        {`${data.address}${data.aptNumber ? ` #${data.aptNumber}` : ""}, ${data.city}, ${stateName(data.state)} ${data.zip}`}
      </SummaryRow>
      <SummaryRow label="Date of birth">{isoToUs(data.dateOfBirth)}</SummaryRow>
      <SummaryRow label="Social Security number">
        <span data-testid="i9-summary-ssn">{data.ssn ? maskSsn(data.ssn) : "Not provided"}</span>
      </SummaryRow>
      <SummaryRow label="Email">{data.email || "Not provided"}</SummaryRow>
      <SummaryRow label="Telephone">{data.phone || "Not provided"}</SummaryRow>
      <SummaryRow label="Status">{I9_ATTESTATION_LABELS[a.status]}</SummaryRow>
      {details.length > 0 ? <SummaryRow label="Details">{details.join(" · ")}</SummaryRow> : null}
      <SummaryRow label="Preparer or translator">
        {data.preparer ? `${data.preparer.firstName} ${data.preparer.lastName}` : "None"}
      </SummaryRow>
    </>
  )
}
