"use client"

import * as React from "react"
import { SearchIcon } from "lucide-react"

import { EmployeeSearchDialog } from "@/components/employee-search-dialog"
import { employeeSearchLabel } from "@/lib/persona-tiles"
import type { EmployeeSearchPage } from "@/server/personas"

/** Server Actions behind the employee search: list matches, then sign in as the chosen one. */
export type EmployeeSearchActions = {
  search: (query: string) => Promise<EmployeeSearchPage>
  /** Signs in as an existing `worker` and redirects to `/worker`; any other id fails closed. */
  pickEmployee: (userId: string) => Promise<void>
}

/** Open state of the employee search dialog, and signing in as the row chosen in it. */
export function useEmployeeSignIn(pickEmployee: EmployeeSearchActions["pickEmployee"]) {
  const [open, setOpen] = React.useState(false)
  const [pending, startTransition] = React.useTransition()
  const select = React.useCallback(
    (employee: { id: string }) => {
      startTransition(async () => {
        await pickEmployee(employee.id)
      })
    },
    [pickEmployee]
  )
  return { open, setOpen, pending, select }
}

/**
 * The Employees row on `/pick`: a control that looks like the C9 search field and opens the
 * employee search dialog, where choosing a row signs in as that employee.
 */
export function EmployeeSearchField({
  count,
  actions,
}: {
  count: number
  actions: EmployeeSearchActions
}) {
  const { open, setOpen, pending, select } = useEmployeeSignIn(actions.pickEmployee)
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        data-testid="employee-search"
        onClick={() => setOpen(true)}
        className="flex h-11 w-full cursor-text items-center gap-2.5 rounded-lg border border-input bg-muted px-3 text-left text-sm text-muted-foreground transition-colors duration-150 ease-out hover:border-ring/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <SearchIcon aria-hidden className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{employeeSearchLabel(count)}</span>
      </button>
      <EmployeeSearchDialog
        open={open}
        onOpenChange={setOpen}
        search={actions.search}
        onSelect={select}
        pending={pending}
      />
    </>
  )
}
