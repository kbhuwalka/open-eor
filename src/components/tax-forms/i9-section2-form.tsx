"use client"

import { useId, useState, type ReactNode } from "react"
import { Plus, X } from "lucide-react"

import { SummaryRow } from "@/components/summary-card"
import { Button } from "@/components/ui/button"
import { FieldGroup } from "@/components/ui/field"
import {
  I9_DOCUMENT_TITLES,
  I9_EDITION,
  formatBusinessAddress,
  isoToUs,
  validateI9Section2,
  type FieldErrors,
  type I9Document,
  type I9Section2Data,
  type I9Section2Draft,
} from "@/domain/forms"

import { CheckboxField, DateField, RadioOption, StateField, TextField, TypedDateField, typedDateToIso } from "./fields"
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

type DocForm = { title: string; issuingAuthority: string; number: string; expires: string }
type Mode = "list_a" | "list_b_c"

const EMPTY_DOC: DocForm = { title: "", issuingAuthority: "", number: "", expires: "" }
const MAX_LIST_A = 3

const docToForm = (d: Partial<I9Document> | null | undefined): DocForm =>
  d
    ? { title: d.title ?? "", issuingAuthority: d.issuingAuthority ?? "", number: d.number ?? "", expires: d.expiresOn ? isoToUs(d.expiresOn) : "" }
    : EMPTY_DOC

const formToDoc = (d: DocForm): Partial<I9Document> => ({
  title: d.title,
  issuingAuthority: d.issuingAuthority,
  number: d.number,
  expiresOn: typedDateToIso(d.expires),
})

const DOC_KEYS = ["title", "issuingAuthority", "number", "expiresOn"] as const
const docFields = (prefix: string) => DOC_KEYS.map((k) => `${prefix}.${k}`)

const STEPS = [
  {
    id: "documents",
    label: "Documents",
    fields: [
      "documents",
      "listA",
      ...Array.from({ length: MAX_LIST_A }, (_, i) => docFields(`listA.${i}`)).flat(),
      ...docFields("listB"),
      ...docFields("listC"),
    ],
  },
  {
    id: "employer",
    label: "Employer",
    fields: [
      "firstDayOfEmployment",
      "employerRepFirstName",
      "employerRepLastName",
      "employerRepTitle",
      "businessName",
      "businessAddress.street",
      "businessAddress.city",
      "businessAddress.state",
      "businessAddress.zip",
      "additionalInformation",
    ],
  },
] as const

type Form = {
  mode: Mode
  listA: DocForm[]
  listB: DocForm
  listC: DocForm
  alternativeProcedure: boolean
  additionalInformation: string
  firstDayOfEmployment: string
  repFirstName: string
  repLastName: string
  repTitle: string
  businessName: string
  street: string
  city: string
  state: string
  zip: string
}

function toForm(initial: I9Section2Draft | undefined): Form {
  const hasBC = Boolean(initial?.listB || initial?.listC) && !(initial?.listA?.length ?? 0)
  return {
    mode: hasBC ? "list_b_c" : "list_a",
    listA: initial?.listA?.length ? initial.listA.map(docToForm) : [EMPTY_DOC],
    listB: docToForm(initial?.listB),
    listC: docToForm(initial?.listC),
    alternativeProcedure: initial?.alternativeProcedure ?? false,
    additionalInformation: initial?.additionalInformation ?? "",
    firstDayOfEmployment: initial?.firstDayOfEmployment ?? "",
    repFirstName: initial?.employerRepFirstName ?? "",
    repLastName: initial?.employerRepLastName ?? "",
    repTitle: initial?.employerRepTitle ?? "",
    businessName: initial?.businessName ?? "",
    street: initial?.businessAddress?.street ?? "",
    city: initial?.businessAddress?.city ?? "",
    state: initial?.businessAddress?.state ?? "",
    zip: initial?.businessAddress?.zip ?? "",
  }
}

function toDraft(f: Form): I9Section2Draft {
  const a = f.mode === "list_a"
  return {
    listA: a ? f.listA.map(formToDoc) : [],
    listB: a ? null : (formToDoc(f.listB) as I9Document),
    listC: a ? null : (formToDoc(f.listC) as I9Document),
    alternativeProcedure: f.alternativeProcedure,
    additionalInformation: f.additionalInformation,
    firstDayOfEmployment: f.firstDayOfEmployment,
    employerRepFirstName: f.repFirstName,
    employerRepLastName: f.repLastName,
    employerRepTitle: f.repTitle,
    businessName: f.businessName,
    businessAddress: { street: f.street, city: f.city, state: f.state, zip: f.zip },
  }
}

function toData(d: I9Section2Draft): I9Section2Data {
  const trim = (v: string | undefined) => (v ?? "").trim()
  const doc = (x: Partial<I9Document>): I9Document => ({
    title: trim(x.title),
    issuingAuthority: trim(x.issuingAuthority),
    number: trim(x.number),
    expiresOn: x.expiresOn ?? "",
  })
  return {
    listA: (d.listA ?? []).map(doc),
    listB: d.listB ? doc(d.listB) : null,
    listC: d.listC ? doc(d.listC) : null,
    additionalInformation: trim(d.additionalInformation),
    alternativeProcedure: d.alternativeProcedure ?? false,
    firstDayOfEmployment: d.firstDayOfEmployment ?? "",
    employerRepFirstName: trim(d.employerRepFirstName),
    employerRepLastName: trim(d.employerRepLastName),
    employerRepTitle: trim(d.employerRepTitle),
    businessName: trim(d.businessName),
    businessAddress: {
      street: trim(d.businessAddress?.street),
      city: trim(d.businessAddress?.city),
      state: d.businessAddress?.state ?? "",
      zip: trim(d.businessAddress?.zip),
    },
  }
}

function DocumentFields({
  legend,
  prefix,
  list,
  value,
  onChange,
  errors,
  onRemove,
}: {
  legend: string
  prefix: string
  list: keyof typeof I9_DOCUMENT_TITLES
  value: DocForm
  onChange: (next: DocForm) => void
  errors: FieldErrors
  onRemove?: () => void
}) {
  const id = useId()
  const set = (patch: Partial<DocForm>) => onChange({ ...value, ...patch })
  return (
    <StepSection title={legend}>
      <FieldGroup>
        <TextField
          label="Document title"
          required
          value={value.title}
          onChange={(v) => set({ title: v })}
          error={errors[`${prefix}.title`]}
          list={`${id}-titles`}
          data-testid={`${prefix}-title`}
        />
        <datalist id={`${id}-titles`}>
          {I9_DOCUMENT_TITLES[list].map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <TextField label="Issuing authority" required value={value.issuingAuthority} onChange={(v) => set({ issuingAuthority: v })} error={errors[`${prefix}.issuingAuthority`]} data-testid={`${prefix}-authority`} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField label="Document number" value={value.number} onChange={(v) => set({ number: v })} error={errors[`${prefix}.number`]} data-testid={`${prefix}-number`} />
          <TypedDateField label="Expiration date" value={value.expires} onChange={(v) => set({ expires: v })} error={errors[`${prefix}.expiresOn`]} description="Leave blank if none." data-testid={`${prefix}-expires`} />
        </div>
        {onRemove ? (
          <div>
            <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
              <X data-icon="inline-start" />
              Remove document
            </Button>
          </div>
        ) : null}
      </FieldGroup>
    </StepSection>
  )
}

/**
 * Form I-9 Section 2 (employer review): the reviewer records the documents the employee presented,
 * then the employer details, then signs. `uploadedDocuments` is a slot for the employee's uploaded
 * files so the reviewer can read them while typing. Validation is `validateI9Section2`, including the
 * List A xor (List B and List C) rule.
 */
export function I9Section2Form({
  initial,
  employeeName,
  uploadedDocuments,
  signerName,
  today,
  renderPreview,
  onSubmit,
  onCancel,
}: {
  initial?: I9Section2Draft
  /** Shown in the heading so the reviewer knows whose form this is. */
  employeeName?: string
  /** Slot above the document fields, typically the employee's uploaded documents. */
  uploadedDocuments?: ReactNode
  /** Name(s) the signature has to match; defaults to the representative's first and last name. */
  signerName?: string | readonly string[]
  today?: string
  renderPreview: RenderPreview<I9Section2Data>
  onSubmit: (submission: SignedSubmission<I9Section2Data>) => void | Promise<void>
  onCancel?: () => void
}) {
  const [form, setForm] = useState<Form>(() => toForm(initial))
  const [fallbackToday] = useState(() => new Date().toISOString().slice(0, 10))
  const asOf = today ?? fallbackToday
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((prev) => ({ ...prev, [key]: value }))
  const draft = toDraft(form)
  const wizard = useWizard(STEPS, () => validateI9Section2(draft, { today: asOf }))
  const { errors, bindContainer } = wizard
  const data = toData(draft)
  const names = signerName ?? `${data.employerRepFirstName} ${data.employerRepLastName}`

  const setListA = (index: number, next: DocForm) =>
    setForm((prev) => ({ ...prev, listA: prev.listA.map((d, i) => (i === index ? next : d)) }))

  return (
    <div className="flex max-w-2xl flex-col gap-6" data-testid="i9-section2-form">
      <StepIndicator steps={[...STEPS, { id: "review", label: "Review and sign" }]} current={wizard.index} />

      <div ref={bindContainer} className="flex flex-col gap-6">
        {wizard.step?.id === "documents" ? (
          <>
            <StepSection
              title={employeeName ? `Section 2: documents for ${employeeName}` : "Section 2: documents"}
              description={`Form I-9 (edition ${I9_EDITION}). Examine the original documents the employee presented.`}
            >
              {uploadedDocuments ? (
                <div className="rounded-lg border border-border px-4 py-3 text-sm" data-testid="uploaded-documents">
                  {uploadedDocuments}
                </div>
              ) : null}
              <div role="radiogroup" aria-label="Document lists" className="flex flex-col gap-3">
                <RadioOption name="i9-list-mode" value="list_a" checked={form.mode === "list_a"} onChange={() => set("mode", "list_a")} label="List A document" description="One document that establishes both identity and employment authorization." data-testid="i9-mode-a" />
                <RadioOption name="i9-list-mode" value="list_b_c" checked={form.mode === "list_b_c"} onChange={() => set("mode", "list_b_c")} label="List B and List C documents" description="One document that establishes identity and one that establishes employment authorization." data-testid="i9-mode-bc" />
              </div>
              {errors.documents ? <p role="alert" className="text-sm text-destructive">{errors.documents}</p> : null}
              {errors.listA ? <p role="alert" className="text-sm text-destructive">{errors.listA}</p> : null}
            </StepSection>

            <div className="flex flex-col gap-6">
              {form.mode === "list_a" ? (
                <>
                  {form.listA.map((doc, i) => (
                    <DocumentFields
                      key={i}
                      legend={form.listA.length > 1 ? `List A document ${i + 1}` : "List A document"}
                      prefix={`listA.${i}`}
                      list="listA"
                      value={doc}
                      onChange={(next) => setListA(i, next)}
                      errors={errors}
                      onRemove={i > 0 ? () => setForm((prev) => ({ ...prev, listA: prev.listA.filter((_, j) => j !== i) })) : undefined}
                    />
                  ))}
                  {form.listA.length < MAX_LIST_A ? (
                    <div>
                      <Button type="button" variant="outline" size="sm" onClick={() => setForm((prev) => ({ ...prev, listA: [...prev.listA, EMPTY_DOC] }))}>
                        <Plus data-icon="inline-start" />
                        Add another List A document
                      </Button>
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <DocumentFields legend="List B document (identity)" prefix="listB" list="listB" value={form.listB} onChange={(next) => set("listB", next)} errors={errors} />
                  <DocumentFields legend="List C document (employment authorization)" prefix="listC" list="listC" value={form.listC} onChange={(next) => set("listC", next)} errors={errors} />
                </>
              )}
            </div>
            <StepActions onContinue={wizard.next} onCancel={onCancel} />
          </>
        ) : null}

        {wizard.step?.id === "employer" ? (
          <>
            <StepSection title="Employer certification" description="Complete after the employee's first day of employment is known.">
              <FieldGroup>
                <DateField label="First day of employment" required value={form.firstDayOfEmployment} onChange={(v) => set("firstDayOfEmployment", v)} error={errors.firstDayOfEmployment} placeholder="Select first day…" data-testid="i9-first-day" />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <TextField label="Representative first name" required value={form.repFirstName} onChange={(v) => set("repFirstName", v)} error={errors.employerRepFirstName} data-testid="i9-rep-first-name" />
                  <TextField label="Representative last name" required value={form.repLastName} onChange={(v) => set("repLastName", v)} error={errors.employerRepLastName} data-testid="i9-rep-last-name" />
                </div>
                <TextField label="Title of representative" required value={form.repTitle} onChange={(v) => set("repTitle", v)} error={errors.employerRepTitle} data-testid="i9-rep-title" />
                <TextField label="Employer business or organization name" required value={form.businessName} onChange={(v) => set("businessName", v)} error={errors.businessName} data-testid="i9-business-name" />
                <TextField label="Business street address" required value={form.street} onChange={(v) => set("street", v)} error={errors["businessAddress.street"]} data-testid="i9-business-street" />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1fr_8rem]">
                  <TextField label="City" required value={form.city} onChange={(v) => set("city", v)} error={errors["businessAddress.city"]} data-testid="i9-business-city" />
                  <StateField value={form.state} onChange={(v) => set("state", v)} error={errors["businessAddress.state"]} data-testid="i9-business-state" />
                  <TextField label="ZIP code" required value={form.zip} onChange={(v) => set("zip", v)} error={errors["businessAddress.zip"]} inputMode="numeric" maxLength={5} data-testid="i9-business-zip" />
                </div>
                <TextField label="Additional information" value={form.additionalInformation} onChange={(v) => set("additionalInformation", v)} error={errors.additionalInformation} data-testid="i9-additional-info" />
                <CheckboxField
                  label="I used an alternative procedure authorized by DHS to examine documents"
                  checked={form.alternativeProcedure}
                  onChange={(v) => set("alternativeProcedure", v)}
                  data-testid="i9-alt-procedure"
                />
              </FieldGroup>
            </StepSection>
            <StepActions onBack={wizard.back} onContinue={wizard.next} continueLabel="Review" />
          </>
        ) : null}
      </div>

      {wizard.isReview ? (
        <ReviewAndSign
          summary={<Section2Summary data={data} />}
          loadDocument={() => renderPreview(data)}
          documentTitle="Form I-9, Section 2"
          signer={signerFrom(names, "Employer representative")}
          onBack={wizard.back}
          onSign={({ signature, fieldValues }) => onSubmit({ data, signature, fieldValues })}
        />
      ) : null}
    </div>
  )
}

function docLine(d: I9Document): string {
  return [d.title, d.issuingAuthority, d.number && `No. ${d.number}`, d.expiresOn && `Exp. ${isoToUs(d.expiresOn)}`]
    .filter(Boolean)
    .join(" · ")
}

function Section2Summary({ data }: { data: I9Section2Data }) {
  return (
    <>
      {data.listA.map((d, i) => (
        <SummaryRow key={i} label={data.listA.length > 1 ? `List A, document ${i + 1}` : "List A"}>
          {docLine(d)}
        </SummaryRow>
      ))}
      {data.listB ? <SummaryRow label="List B">{docLine(data.listB)}</SummaryRow> : null}
      {data.listC ? <SummaryRow label="List C">{docLine(data.listC)}</SummaryRow> : null}
      <SummaryRow label="First day of employment">{isoToUs(data.firstDayOfEmployment)}</SummaryRow>
      <SummaryRow label="Representative">{`${data.employerRepFirstName} ${data.employerRepLastName}, ${data.employerRepTitle}`}</SummaryRow>
      <SummaryRow label="Business">{`${data.businessName}, ${formatBusinessAddress(data.businessAddress)}`}</SummaryRow>
      {data.alternativeProcedure ? <SummaryRow label="Alternative procedure">Used</SummaryRow> : null}
    </>
  )
}
