"use client"

import { useId } from "react"

import { MaskedField, TextField, TypedDateField, typedDateToIso } from "@/components/tax-forms/fields"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { OptionSelect } from "@/components/ui/option-select"
import {
  IDENTITY_DOCUMENT_TYPES,
  identityDocumentType,
  isoToUs,
  type FieldErrors,
  type IdentityDocumentDraft,
  type IdentityListKind,
} from "@/domain/forms"
import type { UploadDetailsView } from "@/lib/employee-screen-data"

/** What the employee is typing; the expiry as typed (`MM/DD/YYYY`). */
export type IdentityDocumentForm = {
  title: string
  issuingAuthority: string
  number: string
  expiry: string
}

/** A replacement starts from the earlier entry, except the number, which never comes back to the browser. */
export function identityDocumentForm(previous: UploadDetailsView | null): IdentityDocumentForm {
  return {
    title: previous?.title ?? "",
    issuingAuthority: previous?.issuingAuthority ?? "",
    number: "",
    expiry: previous?.expiresOn ? isoToUs(previous.expiresOn) : "",
  }
}

export function identityDocumentDraft(form: IdentityDocumentForm): IdentityDocumentDraft {
  return {
    title: form.title,
    issuingAuthority: form.issuingAuthority,
    number: form.number,
    expiresOn: typedDateToIso(form.expiry),
  }
}

/**
 * The details Section 2 needs, read off the document: which document it is (from the I-9 list for
 * this slot), who issued it when the title does not say, its number and its expiration date.
 */
export function IdentityDocumentFields({
  kind,
  form,
  errors,
  onChange,
}: {
  kind: IdentityListKind
  form: IdentityDocumentForm
  errors: FieldErrors
  onChange: (next: IdentityDocumentForm) => void
}) {
  const titleId = useId()
  const type = form.title ? identityDocumentType(kind, form.title) : null
  const set = <K extends keyof IdentityDocumentForm>(key: K, value: IdentityDocumentForm[K]) => onChange({ ...form, [key]: value })
  const options = IDENTITY_DOCUMENT_TYPES[kind].map((t) => ({ value: t.title, label: t.title }))

  return (
    <div className="grid gap-4 sm:grid-cols-2" data-testid={`details-${kind}`}>
      <Field data-invalid={errors.title ? true : undefined} className="sm:col-span-2">
        <FieldLabel htmlFor={titleId}>Document *</FieldLabel>
        <OptionSelect
          id={titleId}
          options={options}
          value={form.title}
          onValueChange={(title) => {
            const next = identityDocumentType(kind, title)
            onChange({ ...form, title, expiry: next?.expiry === "none" ? "" : form.expiry })
          }}
          placeholder="Choose the document…"
          invalid={Boolean(errors.title)}
          data-testid={`doc-title-${kind}`}
        />
        <FieldError>{errors.title}</FieldError>
      </Field>
      {type?.authority === null ? (
        <TextField
          label="Issued by"
          required
          value={form.issuingAuthority}
          onChange={(value) => set("issuingAuthority", value)}
          maxLength={60}
          placeholder="State, country or agency"
          error={errors.issuingAuthority}
          data-testid={`doc-authority-${kind}`}
        />
      ) : null}
      <MaskedField
        label="Document number"
        required
        value={form.number}
        onChange={(value) => set("number", value)}
        inputMode="text"
        maxLength={40}
        revealLabel="document number"
        error={errors.number}
        data-testid={`doc-number-${kind}`}
      />
      {type?.expiry !== "none" ? (
        <TypedDateField
          label="Expiration date"
          required={type?.expiry === "required"}
          value={form.expiry}
          onChange={(value) => set("expiry", value)}
          description={type?.expiry === "optional" ? "Leave blank if it has none." : undefined}
          error={errors.expiresOn}
          data-testid={`doc-expiry-${kind}`}
        />
      ) : null}
    </div>
  )
}
