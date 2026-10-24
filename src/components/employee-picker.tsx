"use client"

import * as React from "react"
import { SearchIcon, UsersIcon } from "lucide-react"

import { searchEmployeesAction } from "@/app/pick/actions"
import { pickEmployee } from "@/auth/actions"
import { EmployeeSearchDialog } from "@/components/employee-search-dialog"
import { PersonaTileFace } from "@/components/persona-tile"

/**
 * Signs in as the chosen employee through the server action; the action validates that the id is an
 * existing `worker` and redirects to `/worker`.
 */
function useEmployeeSignIn() {
  const [open, setOpen] = React.useState(false)
  const [pending, startTransition] = React.useTransition()
  const select = React.useCallback(
    (employee: { id: string }) => {
      startTransition(async () => {
        await pickEmployee(employee.id)
      })
    },
    []
  )
  return { open, setOpen, pending, select }
}

/** The single "Employees" tile on `/pick`: opens the employee search instead of signing in directly. */
export function EmployeesTile({ count }: { count: number }) {
  const { open, setOpen, pending, select } = useEmployeeSignIn()
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="group flex w-full cursor-pointer flex-col items-center gap-3 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <PersonaTileFace
          role="worker"
          title="Employees"
          subtitle={`${count.toLocaleString("en-US")} ${count === 1 ? "employee" : "employees"}`}
        >
          <UsersIcon className="size-12" strokeWidth={1.5} />
        </PersonaTileFace>
      </button>
      <EmployeeSearchDialog
        open={open}
        onOpenChange={setOpen}
        search={searchEmployeesAction}
        onSelect={select}
        pending={pending}
      />
    </>
  )
}

/** Sidebar action for employees: open the same search and switch straight to another employee. */
export function SwitchEmployeeButton() {
  const { open, setOpen, pending, select } = useEmployeeSignIn()
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <SearchIcon aria-hidden className="size-4 shrink-0" />
        Switch employee
      </button>
      <EmployeeSearchDialog
        open={open}
        onOpenChange={setOpen}
        search={searchEmployeesAction}
        onSelect={select}
        pending={pending}
        description="Search by name, email or company, then pick who to continue as."
      />
    </>
  )
}
