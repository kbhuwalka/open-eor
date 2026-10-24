"use client"

import { useActionState, useId, useState } from "react"
import { Plus } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"
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
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

import { createRole, type CreateRoleState } from "../../actions"

export type CreatedRole = { id: string; name: string }

/**
 * Role creation as a modal (eor-prototype CreateRoleModal). `onCreated` lets a
 * host form pick the new role up without leaving its workflow.
 */
export function NewRoleDialog({
  onCreated,
  variant = "default",
  label = "New role",
}: {
  onCreated?: (role: CreatedRole) => void
  variant?: "default" | "outline"
  label?: string
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [state, action, pending] = useActionState(
    async (prev: CreateRoleState, form: FormData) => {
      const result = await createRole(prev, form)
      if (result?.ok) {
        setOpen(false)
        onCreated?.({ id: result.data.roleId, name: result.data.name })
      }
      return result
    },
    null
  )

  const errorField =
    state && !state.ok && typeof state.details?.field === "string" ? state.details.field : undefined
  const errorMessage = state && !state.ok ? state.message : undefined
  const generalError = state && !state.ok && !errorField ? state.message : undefined

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (next) setName("")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button variant={variant} type="button" />} data-testid="new-role">
        <Plus data-icon="inline-start" />
        {label}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={action} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>New role</DialogTitle>
            <DialogDescription>
              Roles are defined for your company and used when you hire. A person&apos;s title is their role.
            </DialogDescription>
          </DialogHeader>

          {generalError ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{generalError}</AlertDescription>
            </Alert>
          ) : null}

          <FieldGroup>
            <Field data-invalid={errorField === "name" || undefined}>
              <FieldLabel htmlFor={`${id}-name`}>Role name *</FieldLabel>
              <Input
                id={`${id}-name`}
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Software Engineer"
                error={errorField === "name"}
                autoFocus
                data-testid="role-name-input"
              />
              <FieldError>{errorField === "name" ? errorMessage : undefined}</FieldError>
            </Field>
          </FieldGroup>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
            <Button type="submit" disabled={pending} data-testid="save-role">
              {pending ? "Saving…" : "Save role"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
