"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import { ArrowLeftRight, Check, ChevronsUpDown, SearchIcon } from "lucide-react"

import { useEmployeeSignIn } from "@/components/employee-picker"
import { EmployeeSearchDialog } from "@/components/employee-search-dialog"
import type { PersonaPickerActions } from "@/components/persona-picker"
import { PersonaAvatar } from "@/components/persona-tile"
import { personaTile } from "@/lib/persona-tiles"
import type { Persona, PickerPersonas } from "@/server/personas"

export type PersonaSwitcherActions = PersonaPickerActions & {
  /** Clears the session and returns to `/pick`. */
  clearPersona: () => Promise<void>
}

const rowClass =
  "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors duration-150 ease-out"
const interactiveRowClass = `${rowClass} cursor-pointer hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none`

/**
 * Sidebar persona block. Shows who is signed in (a client user as their company) and opens a
 * popover with the picker's three groups: Clients and Northwind sign in with one click through the
 * same actions as `/pick`, Employees opens the employee search, and "All personas" returns to `/pick`.
 */
export function PersonaSwitcher({
  current,
  personas,
  actions,
}: {
  current: Persona
  personas: PickerPersonas
  actions: PersonaSwitcherActions
}) {
  const [open, setOpen] = React.useState(false)
  const employees = useEmployeeSignIn(actions.pickEmployee)
  const tile = personaTile(current)

  return (
    <div className="border-t border-border p-2">
      <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
        <PopoverPrimitive.Trigger
          render={<button type="button" />}
          aria-label={`Signed in as ${tile.title}, ${tile.subtitle}. Switch persona`}
          className={`${interactiveRowClass} group py-2 hover:bg-muted/60 data-popup-open:bg-muted/60`}
        >
          <PersonaAvatar initials={tile.initials} shape={tile.shape} role={tile.role} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{tile.title}</span>
            <span className="block truncate text-xs text-muted-foreground">{tile.subtitle}</span>
          </span>
          <ChevronsUpDown
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
          />
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Positioner side="top" align="start" sideOffset={6} collisionPadding={8} className="isolate z-50">
            <PopoverPrimitive.Popup
              aria-label="Switch persona"
              className="flex max-h-(--available-height) w-72 origin-(--transform-origin) flex-col overflow-y-auto rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-md outline-none"
            >
              <SwitcherGroup title="Clients" count={personas.clients.length}>
                {personas.clients.map((persona) => (
                  <PersonaRow key={persona.id} persona={persona} current={current} actions={actions} />
                ))}
              </SwitcherGroup>
              <SwitcherGroup title="Northwind" count={personas.northwind.length}>
                {personas.northwind.map((persona) => (
                  <PersonaRow key={persona.id} persona={persona} current={current} actions={actions} />
                ))}
              </SwitcherGroup>
              <SwitcherGroup title="Employees">
                <li>
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    onClick={() => {
                      setOpen(false)
                      employees.setOpen(true)
                    }}
                    className={`${interactiveRowClass} text-sm text-muted-foreground hover:text-foreground`}
                  >
                    <span aria-hidden className="flex size-8 shrink-0 items-center justify-center">
                      <SearchIcon className="size-4" />
                    </span>
                    Search employees
                  </button>
                </li>
              </SwitcherGroup>
              <div className="mt-1.5 border-t border-border pt-1.5">
                <form action={actions.clearPersona}>
                  <button type="submit" className={`${interactiveRowClass} text-sm`}>
                    <span aria-hidden className="flex size-8 shrink-0 items-center justify-center">
                      <ArrowLeftRight className="size-4 text-muted-foreground" />
                    </span>
                    All personas
                  </button>
                </form>
              </div>
            </PopoverPrimitive.Popup>
          </PopoverPrimitive.Positioner>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
      <EmployeeSearchDialog
        open={employees.open}
        onOpenChange={employees.setOpen}
        search={actions.search}
        onSelect={employees.select}
        pending={employees.pending}
        description="Search by name, email or company, then pick who to continue as."
      />
    </div>
  )
}

function SwitcherGroup({
  title,
  count,
  children,
}: {
  title: string
  count?: number
  children: React.ReactNode
}) {
  const id = React.useId()
  return (
    <div className="py-1">
      <p id={id} className="flex items-baseline gap-1.5 px-2 pt-1 pb-1 text-xs font-medium text-muted-foreground">
        {title}
        {count === undefined ? null : <span className="font-normal tabular-nums">{count}</span>}
      </p>
      <ul aria-labelledby={id}>{children}</ul>
    </div>
  )
}

/** One sign-in row; the signed-in persona is shown, marked current, and is not a button. */
function PersonaRow({
  persona,
  current,
  actions,
}: {
  persona: Persona
  current: Persona
  actions: PersonaSwitcherActions
}) {
  const tile = personaTile(persona)
  const face = (
    <>
      <PersonaAvatar initials={tile.initials} shape={tile.shape} role={tile.role} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{tile.title}</span>
        <span className="block truncate text-xs text-muted-foreground">{tile.subtitle}</span>
      </span>
    </>
  )
  if (persona.id === current.id) {
    return (
      <li>
        <div aria-current="true" className={`${rowClass} bg-muted/60`}>
          {face}
          <Check aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="sr-only">(signed in)</span>
        </div>
      </li>
    )
  }
  return (
    <li>
      <form action={actions.pickPersona.bind(null, persona.id)}>
        <button type="submit" data-testid="switch-persona" data-persona-id={persona.id} className={interactiveRowClass}>
          {face}
        </button>
      </form>
    </li>
  )
}
