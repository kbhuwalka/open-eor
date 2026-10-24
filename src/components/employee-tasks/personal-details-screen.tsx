"use client"

import { useState } from "react"
import { MapPin } from "lucide-react"

import { Button } from "@/components/ui/button"
import { FieldGroup } from "@/components/ui/field"
import { StepSection } from "@/components/tax-forms/wizard"
import { MaskedField, StateField, TextField, TypedDateField, typedDateToIso } from "@/components/tax-forms/fields"
import { hasErrors, validatePersonalDetails, type FieldErrors, type PersonalDetailsData } from "@/domain/forms"
import { todayIso } from "@/domain/employment-term"
import type { EmployeeScreenData } from "@/lib/employee-screen-data"
import { submitPersonalDetailsAction } from "@/app/worker/tasks/actions"

import { CompletedPanel } from "./completed-panel"
import { FormError } from "./form-error"
import { EmployeeTaskFrame } from "./task-frame"
import { useTaskFlow } from "./use-task-flow"

type Data = Extract<EmployeeScreenData, { kind: "personal_details" }>

const LABELS: Record<string, string> = {
  legalName: "Legal name",
  dateOfBirth: "Date of birth",
  ssn: "Social Security number",
  phone: "Phone",
  "address.line1": "Street address",
  "address.line2": "Apartment or suite",
  "address.city": "City",
  "address.state": "State",
  "address.zip": "ZIP code",
  "emergencyContact.name": "Emergency contact name",
  "emergencyContact.relationship": "Relationship",
  "emergencyContact.phone": "Emergency contact phone",
}

type Form = {
  legalName: string
  dateOfBirth: string
  ssn: string
  phone: string
  line1: string
  line2: string
  city: string
  state: string
  zip: string
  emergencyName: string
  emergencyRelationship: string
  emergencyPhone: string
}

function toData(form: Form): PersonalDetailsData {
  return {
    legalName: form.legalName,
    dateOfBirth: typedDateToIso(form.dateOfBirth),
    ssn: form.ssn,
    phone: form.phone,
    address: { line1: form.line1, line2: form.line2, city: form.city, state: form.state, zip: form.zip },
    emergencyContact: { name: form.emergencyName, relationship: form.emergencyRelationship, phone: form.emergencyPhone },
  }
}

/**
 * Your legal name, birth date, SSN, phone, home address and an emergency contact. Errors appear
 * after the first Continue and then follow the draft; the SSN and birth date are stored encrypted
 * and shown masked everywhere afterwards.
 */
export function PersonalDetailsScreen({ data }: { data: Data }) {
  const flow = useTaskFlow()
  const { prefill, order } = data
  const [form, setForm] = useState<Form>(() => ({
    legalName: prefill.legalName,
    dateOfBirth: "",
    ssn: "",
    phone: prefill.phone,
    line1: prefill.address?.line1 ?? "",
    line2: prefill.address?.line2 ?? "",
    city: prefill.address?.city ?? "",
    state: prefill.address?.state ?? "",
    zip: prefill.address?.zip ?? "",
    emergencyName: "",
    emergencyRelationship: "",
    emergencyPhone: "",
  }))
  const [attempted, setAttempted] = useState(false)
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((prev) => ({ ...prev, [key]: value }))

  const all: FieldErrors = validatePersonalDetails(toData(form), { today: todayIso(new Date(data.nowIso)) })
  const shown: FieldErrors = attempted ? all : {}
  const errors: FieldErrors = { ...shown, ...(flow.error?.source === "server" ? flow.error.fields : {}) }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (hasErrors(all)) {
      setAttempted(true)
      flow.fail("Check the highlighted fields.", all)
      return
    }
    flow.run(() => submitPersonalDetailsAction(data.taskId, toData(form)))
  }

  return (
    <EmployeeTaskFrame data={data}>
      {data.completed ? (
        <CompletedPanel data={{ ...data, completed: data.completed }} />
      ) : (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-8" data-testid="personal-details-form">
          <StepSection title="About you" description="Exactly as it appears on your government ID.">
            <FieldGroup>
              <TextField label="Full legal name" required value={form.legalName} onChange={(v) => set("legalName", v)} error={errors.legalName} autoComplete="name" data-testid="pd-name" />
              <TypedDateField label="Date of birth" required value={form.dateOfBirth} onChange={(v) => set("dateOfBirth", v)} error={errors.dateOfBirth} data-testid="pd-dob" />
              <MaskedField
                label="Social Security number"
                required
                value={form.ssn}
                onChange={(v) => set("ssn", v.replace(/[^\d-]/g, ""))}
                error={errors.ssn}
                maxLength={11}
                revealLabel="Social Security number"
                description="Stored encrypted. Used only for payroll and tax filings."
                data-testid="pd-ssn"
              />
            </FieldGroup>
          </StepSection>

          <StepSection title="Contact and address" description="Where we reach you and where your tax forms are mailed.">
            <FieldGroup>
              <TextField label="Mobile phone" required type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={(v) => set("phone", v)} error={errors.phone} data-testid="pd-phone" />
              <TextField label="Street address" required autoComplete="address-line1" value={form.line1} onChange={(v) => set("line1", v)} error={errors["address.line1"]} data-testid="pd-line1" />
              <TextField label="Apartment, suite or unit" autoComplete="address-line2" value={form.line2} onChange={(v) => set("line2", v)} error={errors["address.line2"]} data-testid="pd-line2" />
              <div className="grid gap-5 sm:grid-cols-2">
                <TextField label="City" required autoComplete="address-level2" value={form.city} onChange={(v) => set("city", v)} error={errors["address.city"]} data-testid="pd-city" />
                <StateField value={form.state} onChange={(v) => set("state", v)} error={errors["address.state"]} data-testid="pd-state" />
              </div>
              <TextField label="ZIP code" required inputMode="numeric" autoComplete="postal-code" maxLength={5} value={form.zip} onChange={(v) => set("zip", v.replace(/\D/g, ""))} error={errors["address.zip"]} data-testid="pd-zip" />
            </FieldGroup>
          </StepSection>

          <StepSection title="Emergency contact" description="Optional. Someone we can call if something happens at work.">
            <FieldGroup>
              <TextField label="Contact name" value={form.emergencyName} onChange={(v) => set("emergencyName", v)} error={errors["emergencyContact.name"]} data-testid="pd-ec-name" />
              <div className="grid gap-5 sm:grid-cols-2">
                <TextField label="Relationship" value={form.emergencyRelationship} onChange={(v) => set("emergencyRelationship", v)} error={errors["emergencyContact.relationship"]} data-testid="pd-ec-relationship" />
                <TextField label="Contact phone" type="tel" inputMode="tel" value={form.emergencyPhone} onChange={(v) => set("emergencyPhone", v)} error={errors["emergencyContact.phone"]} data-testid="pd-ec-phone" />
              </div>
            </FieldGroup>
          </StepSection>

          <p className="flex items-start gap-2 text-sm text-muted-foreground" data-testid="pd-work-state">
            <MapPin aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>
              You will work in <span className="font-medium text-foreground">{order.stateName}</span>. Northwind registers you
              with that state and files its payroll taxes. Your home address can be anywhere in the US.
            </span>
          </p>

          <FormError key={flow.error?.seq} message={flow.error?.message ?? null} fields={flow.error?.fields} labels={LABELS} />
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={!data.canAct || flow.pending} data-testid="pd-submit">
              {flow.pending ? "Saving…" : "Save and continue"}
            </Button>
          </div>
        </form>
      )}
    </EmployeeTaskFrame>
  )
}
