"use client"

import { useActionState, useId, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { BenefitPackageFieldset } from "@/components/forms/benefit-package-fieldset"
import { CompFieldset, useCompValue, type CompValue } from "@/components/forms/comp-fieldset"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
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
import { DatePicker } from "@/components/ui/date-picker"
import { OptionSelect } from "@/components/ui/option-select"
import { SummaryCard, SummaryRow } from "@/components/summary-card"
import { QuoteBreakdown } from "@/components/quote-breakdown"
import type { BenefitPackage } from "@/domain/types"
import { US_2026 } from "@/domain/cost-rates"
import { addDaysIso } from "@/domain/employment-term"
import { buildQuote } from "@/domain/quote"
import { effectiveHourlyCents, resolveWageFloor } from "@/domain/wage"
import { formatSigningDate } from "@/components/signing"
import { stateName, US_STATES } from "@/lib/us-states"
import type { SignedAgreementSummary } from "@/server/master-agreement"
import type { AgreementSummary, RoleRow } from "@/server/queries"

import { createPerson, signMasterAgreementAction } from "../../actions"
import { AgreementSignButton } from "../../agreement-sign-button"
import { NewRoleDialog, type CreatedRole } from "./new-role-dialog"

const TERM_OPTIONS = [
  { value: "indefinite", label: "Indefinite" },
  { value: "fixed", label: "Fixed term" },
]

const LOCATION_OPTIONS = US_STATES.map((st) => ({ value: st.code, label: st.name, hint: st.code }))

export function NewPersonForm({
  roles: initialRoles,
  agreement,
  signedAgreement,
  earliestStart,
}: {
  roles: RoleRow[]
  agreement: AgreementSummary
  /** The stored signed document, when the agreement was signed through the signing dialog. */
  signedAgreement: SignedAgreementSummary | null
  /** First selectable desired start date (ISO), 5 business days out. */
  earliestStart: string
}) {
  const id = useId()
  const [state, action, pending] = useActionState(createPerson, null)

  const [step, setStep] = useState<"details" | "quote">("details")
  const [attempted, setAttempted] = useState(false)
  const [seenState, setSeenState] = useState(state)
  const router = useRouter()
  const [signedNow, setSignedNow] = useState<SignedAgreementSummary | null>(null)
  const [signedElsewhere, setSignedElsewhere] = useState(false)

  const [roles, setRoles] = useState<RoleRow[]>(initialRoles)
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [email, setEmail] = useState("")
  const [stateCode, setStateCode] = useState("")
  const [roleId, setRoleId] = useState<string>("")
  const [pkg, setPkg] = useState<BenefitPackage>("standard")
  const [comp, setComp] = useCompValue({ wage: "", wageUnit: "annual" })
  const [startDate, setStartDate] = useState("")
  const [termKind, setTermKind] = useState("indefinite")
  const [endDate, setEndDate] = useState("")
  const fixedTerm = termKind === "fixed"
  const earliestEnd = addDaysIso(startDate || earliestStart, 1)

  // A rejected submit that points at a field sends the user back to fix it.
  if (state !== seenState) {
    setSeenState(state)
    if (state && !state.ok && typeof state.details?.field === "string" && state.details.field !== "agreement") {
      setStep("details")
    }
  }

  const cents = Math.round(Number(comp.wage) * 100)
  const hasWage = Number.isFinite(cents) && cents > 0

  const clientError = attempted
    ? validateDetails({ firstName, lastName, email, stateCode, roleId, startDate, fixedTerm, endDate, comp, cents, hasWage, earliestStart })
    : null
  const roleName = roles.find((r) => r.id === roleId)?.name ?? ""
  const serverError = state && !state.ok ? state : null
  const serverField =
    serverError && typeof serverError.details?.field === "string" ? serverError.details.field : undefined
  const errorField = clientError?.field ?? serverField
  const errorMessage = clientError?.message ?? serverError?.message
  const fieldError = (field: string) => (errorField === field ? errorMessage : undefined)
  const generalError = !clientError && serverError && !serverField ? serverError.message : undefined

  const signed = signedNow ?? signedAgreement
  const agreementSigned = agreement.status === "signed" || signed !== null || signedElsewhere
  const signedOn = signed?.signedAt ?? agreement.signedAt

  function onRoleCreated(created: CreatedRole) {
    setRoles((prev) =>
      [...prev, { id: created.id, name: created.name, peopleCount: 0, createdAt: new Date().toISOString() }].sort(
        (a, b) => a.name.localeCompare(b.name)
      )
    )
    setRoleId(created.id)
  }

  function reviewQuote() {
    setAttempted(true)
    const problem = validateDetails({
      firstName, lastName, email, stateCode, roleId, startDate, fixedTerm, endDate, comp, cents, hasWage, earliestStart,
    })
    if (problem) return
    setStep("quote")
    window.scrollTo({ top: 0 })
  }

  const quote = hasWage
    ? buildQuote({
        wageCents: cents,
        wageUnit: comp.wageUnit,
        stateCode,
        package: pkg,
        markupPct: agreement.markupPct,
        ...(fixedTerm && startDate && endDate > startDate ? { term: { startDate, endDate } } : {}),
      })
    : null

  return (
    <form action={action} className="max-w-2xl">
      <input type="hidden" name="workerType" value="w2_employee" />

      <div className="flex flex-col gap-8" hidden={step !== "details"}>
        {generalError && step === "details" ? (
          <Alert variant="destructive" role="alert">
            <AlertTitle>Could not create the order</AlertTitle>
            <AlertDescription>{generalError}</AlertDescription>
          </Alert>
        ) : null}

        <FieldSet>
          <FieldLegend variant="label">Personal details</FieldLegend>
          <FieldGroup>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field data-invalid={errorField === "firstName" || undefined}>
                <FieldLabel htmlFor={`${id}-first`}>First name *</FieldLabel>
                <Input
                  id={`${id}-first`}
                  name="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  autoComplete="off"
                  error={errorField === "firstName"}
                  data-testid="first-name-input"
                />
                <FieldError>{fieldError("firstName")}</FieldError>
              </Field>
              <Field data-invalid={errorField === "lastName" || undefined}>
                <FieldLabel htmlFor={`${id}-last`}>Last name *</FieldLabel>
                <Input
                  id={`${id}-last`}
                  name="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  autoComplete="off"
                  error={errorField === "lastName"}
                  data-testid="last-name-input"
                />
                <FieldError>{fieldError("lastName")}</FieldError>
              </Field>
            </div>

            <Field data-invalid={errorField === "email" || undefined}>
              <FieldLabel htmlFor={`${id}-email`}>Email *</FieldLabel>
              <Input
                id={`${id}-email`}
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
                error={errorField === "email"}
                data-testid="email-input"
              />
              <FieldError>{fieldError("email")}</FieldError>
            </Field>

            <Field data-invalid={errorField === "stateCode" || undefined}>
              <FieldLabel htmlFor={`${id}-state`}>Work location *</FieldLabel>
              <OptionSelect
                id={`${id}-state`}
                name="stateCode"
                options={LOCATION_OPTIONS}
                value={stateCode}
                onValueChange={setStateCode}
                placeholder="Select a location…"
                invalid={errorField === "stateCode"}
                data-testid="state-trigger"
              />
              <FieldError>{fieldError("stateCode")}</FieldError>
            </Field>
          </FieldGroup>
        </FieldSet>

        <FieldSet>
          <FieldLegend variant="label">Role</FieldLegend>
          <FieldGroup>
            <Field data-invalid={errorField === "roleId" || undefined}>
              <FieldLabel htmlFor={`${id}-role`}>Job role *</FieldLabel>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <OptionSelect
                    id={`${id}-role`}
                    name="roleId"
                    options={roles.map((r) => ({ value: r.id, label: r.name }))}
                    value={roleId}
                    onValueChange={setRoleId}
                    placeholder={roles.length > 0 ? "Select a role…" : "Create a role to continue"}
                    disabled={roles.length === 0}
                    invalid={errorField === "roleId"}
                    data-testid="role-trigger"
                  />
                </div>
                <NewRoleDialog onCreated={onRoleCreated} variant="outline" label="New role" />
              </div>
              <FieldError>{fieldError("roleId")}</FieldError>
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field data-invalid={errorField === "startDate" || undefined}>
                <FieldLabel htmlFor={`${id}-start`}>Desired start date *</FieldLabel>
                <DatePicker
                  id={`${id}-start`}
                  name="startDate"
                  value={startDate}
                  min={earliestStart}
                  onValueChange={setStartDate}
                  placeholder="Select desired start date…"
                  invalid={errorField === "startDate"}
                  data-testid="start-date-input"
                />
                <FieldError>{fieldError("startDate")}</FieldError>
              </Field>

              <Field data-invalid={errorField === "employmentTerm" || undefined}>
                <FieldLabel htmlFor={`${id}-term`}>Employment term *</FieldLabel>
                <OptionSelect
                  id={`${id}-term`}
                  name="employmentTerm"
                  options={TERM_OPTIONS}
                  value={termKind}
                  onValueChange={(next) => setTermKind(next || "indefinite")}
                  invalid={errorField === "employmentTerm"}
                  data-testid="term-trigger"
                />
                <FieldError>{fieldError("employmentTerm")}</FieldError>
              </Field>

              {fixedTerm ? (
                <Field data-invalid={errorField === "endDate" || undefined}>
                  <FieldLabel htmlFor={`${id}-end`}>End date *</FieldLabel>
                  <DatePicker
                    id={`${id}-end`}
                    name="endDate"
                    value={endDate}
                    min={earliestEnd}
                    onValueChange={setEndDate}
                    placeholder="Select end date…"
                    invalid={errorField === "endDate"}
                    data-testid="end-date-input"
                  />
                  <FieldError>{fieldError("endDate")}</FieldError>
                </Field>
              ) : null}
            </div>

          </FieldGroup>
        </FieldSet>

        <CompFieldset
          value={comp}
          onChange={setComp}
          stateCode={stateCode}
          errorField={errorField}
          errorMessage={errorMessage}
        />

        <BenefitPackageFieldset value={pkg} onChange={setPkg} errorMessage={fieldError("package")} />

        <div className="flex items-center gap-2">
          <Button type="button" onClick={reviewQuote} data-testid="review-quote">
            Review quote
          </Button>
          <Button variant="ghost" render={<Link href="/client/people" />} nativeButton={false}>
            Cancel
          </Button>
        </div>
      </div>

      {step === "quote" ? (
        <div className="flex flex-col gap-8" data-testid="quote-step">
          {generalError ? (
            <Alert variant="destructive" role="alert">
              <AlertTitle>Could not create the order</AlertTitle>
              <AlertDescription>{generalError}</AlertDescription>
            </Alert>
          ) : null}

          <FieldSet>
            <FieldLegend variant="label">Order details</FieldLegend>
            <SummaryCard data-testid="order-details">
              <SummaryRow label="Person">{`${firstName.trim()} ${lastName.trim()}`}</SummaryRow>
              <SummaryRow label="Email">{email.trim()}</SummaryRow>
              <SummaryRow label="Role">{roleName}</SummaryRow>
              <SummaryRow label="Work location">{stateName(stateCode)}</SummaryRow>
              <SummaryRow label="Desired start date">{formatStart(startDate)}</SummaryRow>
              <SummaryRow label="End date">{fixedTerm ? formatStart(endDate) : "Indefinite"}</SummaryRow>
              <SummaryRow label="Benefits">{US_2026.packages[pkg].label}</SummaryRow>
            </SummaryCard>
          </FieldSet>

          <FieldSet>
            <FieldLegend variant="label">Quote</FieldLegend>
            {quote ? (
              <QuoteBreakdown
                quote={quote}
                benefits="pending"
                unit={comp.wageUnit}
                packageLabel={US_2026.packages[pkg].label}
                deposit
              />
            ) : null}
            <p className="text-xs text-muted-foreground">
              The quote, including the service fee and rates, is frozen into this order when it is created.
            </p>
          </FieldSet>

          <FieldSet>
            <FieldLegend variant="label">Agreement</FieldLegend>
            <SummaryCard data-testid="agreement-card">
              <SummaryRow label="Northwind EOR agreement">
                {agreementSigned ? (
                  <span data-testid="agreement-signed">
                    {signedOn ? `Signed ${formatSigningDate(new Date(signedOn))}` : "Signed"}
                    {signed ? ` by ${signed.signerName}` : ""}
                    {signed ? (
                      <>
                        {" · "}
                        <a
                          href={`/api/company-documents/${signed.documentId}`}
                          className="text-primary hover:underline"
                          data-testid="agreement-download"
                        >
                          Download
                        </a>
                      </>
                    ) : null}
                  </span>
                ) : (
                  <AgreementSignButton
                    sign={signMasterAgreementAction}
                    onSigned={(result) => {
                      if (result) {
                        setSignedNow({
                          documentId: result.documentId,
                          signedAt: result.signedAt,
                          signerName: result.signerName,
                        })
                      } else {
                        setSignedElsewhere(true)
                        router.refresh()
                      }
                    }}
                  />
                )}
              </SummaryRow>
            </SummaryCard>
            {agreementSigned ? null : (
              <FieldDescription>
                Northwind becomes the employer of record. The service fee is{" "}
                <span className="font-medium text-foreground">{agreement.markupPct}% of wage</span>. Signing once
                covers everyone you hire through Northwind.
              </FieldDescription>
            )}
            <FieldError>{fieldError("agreement")}</FieldError>
          </FieldSet>

          <div className="flex items-center gap-2">
            <Button type="submit" disabled={pending || !agreementSigned} data-testid="submit-person">
              {pending ? "Creating…" : "Create order"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setStep("details")} disabled={pending}>
              Edit details
            </Button>
          </div>
        </div>
      ) : null}
    </form>
  )
}

type DetailsInput = {
  firstName: string
  lastName: string
  email: string
  stateCode: string
  roleId: string
  startDate: string
  fixedTerm: boolean
  endDate: string
  comp: CompValue
  cents: number
  hasWage: boolean
  earliestStart: string
}

type DetailsProblem = { field: string; message: string }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** First problem in form order, or null. The server re-checks everything. */
function validateDetails(v: DetailsInput): DetailsProblem | null {
  if (!v.firstName.trim()) return { field: "firstName", message: "Enter a first name." }
  if (!v.lastName.trim()) return { field: "lastName", message: "Enter a last name." }
  if (!EMAIL.test(v.email.trim())) return { field: "email", message: "Enter a valid email address." }
  if (!v.stateCode) return { field: "stateCode", message: "Choose a work location." }
  if (!v.roleId) return { field: "roleId", message: "Choose a role." }
  if (!v.startDate) return { field: "startDate", message: "Choose a desired start date." }
  if (v.startDate < v.earliestStart) {
    return { field: "startDate", message: "Desired start dates need at least 5 business days of notice." }
  }
  if (v.fixedTerm) {
    if (!v.endDate) return { field: "endDate", message: "Choose an end date." }
    if (v.endDate <= v.startDate) {
      return { field: "endDate", message: "The end date must be after the start date." }
    }
  }
  if (!v.hasWage) return { field: "wage", message: "Enter the amount." }
  const floor = resolveWageFloor(v.stateCode)
  if (effectiveHourlyCents(v.cents, v.comp.wageUnit) < floor.effectiveHourlyCents) {
    return { field: "wage", message: "This amount is below the minimum wage for the work location." }
  }
  return null
}

function formatStart(iso: string): string {
  if (!iso) return ""
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}
