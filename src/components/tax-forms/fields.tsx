"use client"

import { useId, useState, type ReactNode } from "react"
import { Eye, EyeOff } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect, type Option } from "@/components/ui/option-select"
import { usToIso } from "@/domain/forms"
import { US_STATES } from "@/lib/us-states"

type CommonProps = {
  label: string
  required?: boolean
  error?: string
  description?: ReactNode
  "data-testid"?: string
}

const labelText = (label: string, required?: boolean) => (required ? `${label} *` : label)

export function TextField({
  label,
  required,
  error,
  description,
  value,
  onChange,
  type = "text",
  inputMode,
  maxLength,
  autoComplete = "off",
  list,
  placeholder,
  disabled,
  "data-testid": testId,
}: CommonProps & {
  value: string
  onChange: (value: string) => void
  type?: string
  inputMode?: "text" | "numeric" | "decimal" | "tel" | "email"
  maxLength?: number
  autoComplete?: string
  list?: string
  placeholder?: string
  disabled?: boolean
}) {
  const id = useId()
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{labelText(label, required)}</FieldLabel>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode={inputMode}
        maxLength={maxLength}
        autoComplete={autoComplete}
        list={list}
        placeholder={placeholder}
        disabled={disabled}
        error={Boolean(error)}
        aria-describedby={description ? `${id}-desc` : undefined}
        data-testid={testId}
      />
      {description ? <FieldDescription id={`${id}-desc`}>{description}</FieldDescription> : null}
      <FieldError>{error}</FieldError>
    </Field>
  )
}

/**
 * Sensitive number (SSN, account number): hidden while typing, with a show/hide toggle. The value is
 * only ever held in component state and passed to `onChange`; it is never written anywhere else.
 */
export function MaskedField({
  label,
  required,
  error,
  description,
  value,
  onChange,
  inputMode = "numeric",
  maxLength,
  revealLabel,
  "data-testid": testId,
}: CommonProps & {
  value: string
  onChange: (value: string) => void
  inputMode?: "numeric" | "text"
  maxLength?: number
  /** Noun for the toggle's accessible name, e.g. "Social Security number". */
  revealLabel: string
}) {
  const id = useId()
  const [shown, setShown] = useState(false)
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{labelText(label, required)}</FieldLabel>
      <div className="flex items-start gap-2">
        <Input
          id={id}
          type={shown ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode={inputMode}
          maxLength={maxLength}
          autoComplete="off"
          spellCheck={false}
          error={Boolean(error)}
          aria-describedby={description ? `${id}-desc` : undefined}
          data-sensitive
          data-testid={testId}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={`${shown ? "Hide" : "Show"} ${revealLabel}`}
          aria-pressed={shown}
          onClick={() => setShown((v) => !v)}
        >
          {shown ? <EyeOff /> : <Eye />}
        </Button>
      </div>
      {description ? <FieldDescription id={`${id}-desc`}>{description}</FieldDescription> : null}
      <FieldError>{error}</FieldError>
    </Field>
  )
}

export function DollarsField({
  label,
  required,
  error,
  description,
  value,
  onChange,
  disabled,
  "data-testid": testId,
}: CommonProps & { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const id = useId()
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{labelText(label, required)}</FieldLabel>
      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">$</span>
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          disabled={disabled}
          error={Boolean(error)}
          className="pl-7 tabular-nums"
          aria-describedby={description ? `${id}-desc` : undefined}
          data-testid={testId}
        />
      </div>
      {description ? <FieldDescription id={`${id}-desc`}>{description}</FieldDescription> : null}
      <FieldError>{error}</FieldError>
    </Field>
  )
}

const STATE_OPTIONS: Option[] = US_STATES.map((s) => ({ value: s.code, label: s.name, hint: s.code }))

export function StateField({
  label = "State",
  required = true,
  error,
  value,
  onChange,
  "data-testid": testId,
}: Omit<CommonProps, "label"> & { label?: string; value: string; onChange: (value: string) => void }) {
  const id = useId()
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{labelText(label, required)}</FieldLabel>
      <OptionSelect
        id={id}
        options={STATE_OPTIONS}
        value={value}
        onValueChange={onChange}
        placeholder="Select a state…"
        invalid={Boolean(error)}
        data-testid={testId}
      />
      <FieldError>{error}</FieldError>
    </Field>
  )
}

export function DateField({
  label,
  required,
  error,
  value,
  onChange,
  min,
  max,
  placeholder,
  "data-testid": testId,
}: CommonProps & {
  value: string
  onChange: (value: string) => void
  min?: string
  max?: string
  placeholder?: string
}) {
  const id = useId()
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{labelText(label, required)}</FieldLabel>
      <DatePicker
        id={id}
        value={value}
        onValueChange={onChange}
        min={min}
        max={max}
        placeholder={placeholder}
        invalid={Boolean(error)}
        data-testid={testId}
      />
      <FieldError>{error}</FieldError>
    </Field>
  )
}

/** `MM/DD/YYYY` while typing: keeps digits only and inserts the slashes. */
export function maskUsDate(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 8)
  if (d.length <= 2) return d
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`
}

/** ISO from typed `MM/DD/YYYY`; "" when empty; the typed text itself when incomplete or not a real day, so validators reject it. */
export function typedDateToIso(text: string): string {
  if (text.trim() === "") return ""
  return usToIso(text) ?? text
}

/** Date typed as MM/DD/YYYY (birth dates and document expirations are far from today, so a calendar is slow). */
export function TypedDateField({
  label,
  required,
  error,
  description,
  value,
  onChange,
  "data-testid": testId,
}: CommonProps & { value: string; onChange: (value: string) => void }) {
  const id = useId()
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{labelText(label, required)}</FieldLabel>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(maskUsDate(e.target.value))}
        inputMode="numeric"
        autoComplete="off"
        placeholder="MM/DD/YYYY"
        maxLength={10}
        error={Boolean(error)}
        className="tabular-nums"
        aria-describedby={description ? `${id}-desc` : undefined}
        data-testid={testId}
      />
      {description ? <FieldDescription id={`${id}-desc`}>{description}</FieldDescription> : null}
      <FieldError>{error}</FieldError>
    </Field>
  )
}

export function CheckboxField({
  label,
  description,
  checked,
  onChange,
  disabled,
  error,
  "data-testid": testId,
}: Omit<CommonProps, "required"> & { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  const id = useId()
  return (
    <Field
      orientation="horizontal"
      data-invalid={error ? true : undefined}
      className="items-start rounded-lg border border-border px-4 py-3"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-invalid={error ? true : undefined}
        className="mt-0.5 size-4 shrink-0 accent-primary"
        data-testid={testId}
      />
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor={id} className="font-medium">
          {label}
        </FieldLabel>
        {description ? <FieldDescription>{description}</FieldDescription> : null}
        <FieldError>{error}</FieldError>
      </div>
    </Field>
  )
}

export function RadioOption({
  name,
  value,
  checked,
  onChange,
  label,
  description,
  "data-testid": testId,
}: {
  name: string
  value: string
  checked: boolean
  onChange: (value: string) => void
  label: string
  description?: ReactNode
  "data-testid"?: string
}) {
  const id = useId()
  return (
    <Field
      orientation="horizontal"
      className="items-start rounded-lg border border-border px-4 py-3 has-[:checked]:border-primary/30 has-[:checked]:bg-primary/5"
    >
      <input
        id={id}
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
        className="mt-0.5 size-4 shrink-0 accent-primary"
        data-testid={testId}
      />
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor={id} className="font-medium">
          {label}
        </FieldLabel>
        {description ? <FieldDescription>{description}</FieldDescription> : null}
      </div>
    </Field>
  )
}
