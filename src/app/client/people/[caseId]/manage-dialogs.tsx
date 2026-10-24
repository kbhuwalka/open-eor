"use client"

import { useId, useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { DatePicker } from "@/components/ui/date-picker"
import { OptionSelect } from "@/components/ui/option-select"
import { Textarea } from "@/components/ui/textarea"
import { addDaysIso, defaultLastWorkingDay, todayIso } from "@/domain/employment-term"
import { formatDay } from "@/lib/format"

import { cancelPersonRequest, reactivatePerson, terminateActivePerson } from "../../actions"

const TERM_OPTIONS = [
  { value: "indefinite", label: "Indefinite" },
  { value: "fixed", label: "Fixed term" },
]

/** T9: cancel onboarding (the person becomes inactive). Danger confirm per ui-guidelines C4. */
export function CancelRequestDialog({ caseId, name }: { caseId: string; name: string }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setNote("")
          setError(null)
        }
      }}
    >
      <DialogTrigger render={<Button variant="outline" />} data-testid="cancel-request">
        Cancel onboarding
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel {name}&apos;s onboarding?</DialogTitle>
          <DialogDescription>
            Northwind stops onboarding and {name} becomes inactive. This cannot be undone; start a
            new hire if plans change.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor={`${id}-note`}>Reason (optional)</FieldLabel>
          <Textarea
            id={`${id}-note`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Role put on hold"
          />
          <FieldDescription>Shared with Northwind, not with the person.</FieldDescription>
          <FieldError>{error}</FieldError>
        </Field>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Keep onboarding</DialogClose>
          <Button
            variant="danger"
            disabled={pending}
            data-testid="confirm-cancel"
            onClick={() =>
              start(async () => {
                const result = await cancelPersonRequest(caseId, note)
                if (result.ok) setOpen(false)
                else setError(result.message)
              })
            }
          >
            {pending ? "Cancelling…" : "Cancel onboarding"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * T10: end an active person's employment with an effective date. A fixed-term person cannot be
 * given a last working day after their end date; ending early is fine.
 */
export function TerminateDialog({
  caseId,
  name,
  endDate,
}: {
  caseId: string
  name: string
  /** Fixed-term end date (ISO), or null when indefinite. */
  endDate: string | null
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [effectiveOn, setEffectiveOn] = useState(() => defaultLastWorkingDay(new Date(), endDate))
  const [note, setNote] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setNote("")
          setError(null)
        }
      }}
    >
      <DialogTrigger render={<Button variant="outline" />} data-testid="terminate">
        Terminate
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Terminate {name}?</DialogTitle>
          <DialogDescription>
            Northwind processes the final payroll and offboarding from the date you choose.
            {endDate
              ? ` ${name}'s fixed term ends ${formatDay(new Date(`${endDate}T00:00:00`))}, so the last working day can be no later.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor={`${id}-date`}>Last working day</FieldLabel>
          <DatePicker
            id={`${id}-date`}
            value={effectiveOn}
            onValueChange={setEffectiveOn}
            min={todayIso(new Date())}
            max={endDate ?? undefined}
            data-testid="terminate-date"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-note`}>Reason (optional)</FieldLabel>
          <Textarea
            id={`${id}-note`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Contract ended"
          />
          <FieldDescription>Shared with Northwind, not with the person.</FieldDescription>
          <FieldError>{error}</FieldError>
        </Field>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Keep active</DialogClose>
          <Button
            variant="danger"
            disabled={pending}
            data-testid="confirm-terminate"
            onClick={() =>
              start(async () => {
                const result = await terminateActivePerson(caseId, { effectiveOn, note })
                if (result.ok) setOpen(false)
                else setError(result.message)
              })
            }
          >
            {pending ? "Terminating…" : "Terminate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * T11: reactivate an inactive profile. The only action on an inactive profile. When the person's
 * fixed term has ended (`needsTerm`), reactivating must choose a new term: indefinite, or a fixed
 * term ending after today.
 */
export function ReactivateDialog({
  caseId,
  name,
  restartsOnboarding,
  needsTerm,
}: {
  caseId: string
  name: string
  /** A cancelled onboarding restarts with Northwind; a terminated person returns to Active. */
  restartsOnboarding: boolean
  /** The end date has passed, so a new term is required. */
  needsTerm: boolean
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [termKind, setTermKind] = useState("")
  const [endDate, setEndDate] = useState("")
  const [pending, start] = useTransition()

  const termChosen = termKind === "indefinite" || (termKind === "fixed" && endDate !== "")
  const ready = !needsTerm || termChosen

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setError(null)
          setTermKind("")
          setEndDate("")
        }
      }}
    >
      <DialogTrigger render={<Button />} data-testid="reactivate">
        Reactivate
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reactivate {name}?</DialogTitle>
          <DialogDescription>
            {restartsOnboarding
              ? `Onboarding starts again with the same role and compensation. ${name} becomes Onboarding and Northwind picks the request back up.`
              : `${name} returns to Active with the same role and compensation as before, and Northwind resumes payroll.`}
            {needsTerm ? " The previous fixed term has ended, so choose a new employment term." : ""}
          </DialogDescription>
        </DialogHeader>
        {needsTerm ? (
          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor={`${id}-term`}>Employment term</FieldLabel>
              <OptionSelect
                id={`${id}-term`}
                options={TERM_OPTIONS}
                value={termKind}
                onValueChange={setTermKind}
                placeholder="Select a term…"
                data-testid="reactivate-term"
              />
            </Field>
            {termKind === "fixed" ? (
              <Field>
                <FieldLabel htmlFor={`${id}-end`}>End date</FieldLabel>
                <DatePicker
                  id={`${id}-end`}
                  value={endDate}
                  onValueChange={setEndDate}
                  min={addDaysIso(todayIso(new Date()), 1)}
                  placeholder="Select end date…"
                  data-testid="reactivate-end-date"
                />
              </Field>
            ) : null}
          </div>
        ) : null}
        <FieldError>{error}</FieldError>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Keep inactive</DialogClose>
          <Button
            disabled={pending || !ready}
            data-testid="confirm-reactivate"
            onClick={() =>
              start(async () => {
                const term = !needsTerm
                  ? undefined
                  : termKind === "fixed"
                    ? ({ kind: "fixed", endDate } as const)
                    : ({ kind: "indefinite" } as const)
                const result = await reactivatePerson(caseId, term)
                if (result.ok) setOpen(false)
                else setError(result.message)
              })
            }
          >
            {pending ? "Reactivating…" : "Reactivate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
