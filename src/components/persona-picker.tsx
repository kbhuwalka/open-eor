import type { ReactNode } from "react"

import { EmployeeSearchField, type EmployeeSearchActions } from "@/components/employee-picker"
import { NorthwindLogo } from "@/components/northwind-logo"
import { PersonaTile } from "@/components/persona-tile"
import { personaTile, recentEmployeeTile } from "@/lib/persona-tiles"
import type { PickerPersonas, RecentEmployee } from "@/server/personas"

export type PersonaPickerActions = EmployeeSearchActions & {
  /** Signs in as any existing user and redirects to their portal home. */
  pickPersona: (userId: string) => Promise<void>
}

/**
 * The `/pick` page body (ui-guidelines C14): a page header, then three rows — Clients (one tile per
 * client HR user, titled by company), Northwind (the specialist and Finance) and Employees (the
 * employee search, plus the employees who started most recently). Every tile is a one-click form.
 */
export function PersonaPicker({
  personas,
  employeeCount,
  recentEmployees,
  now,
  actions,
}: {
  personas: PickerPersonas
  employeeCount: number
  recentEmployees: RecentEmployee[]
  now: Date
  actions: PersonaPickerActions
}) {
  return (
    <PickerFrame>
      <PersonaSection id="clients" title="Clients" count={personas.clients.length}>
        <TileGrid empty="No client users yet.">
          {personas.clients.map((persona) => (
            <li key={persona.id}>
              <PersonaTile
                tile={personaTile(persona)}
                personaId={persona.id}
                action={actions.pickPersona.bind(null, persona.id)}
              />
            </li>
          ))}
        </TileGrid>
      </PersonaSection>
      <PersonaSection id="northwind" title="Northwind" count={personas.northwind.length}>
        <TileGrid empty="No Northwind staff yet.">
          {personas.northwind.map((persona) => (
            <li key={persona.id}>
              <PersonaTile
                tile={personaTile(persona)}
                personaId={persona.id}
                action={actions.pickPersona.bind(null, persona.id)}
              />
            </li>
          ))}
        </TileGrid>
      </PersonaSection>
      <PersonaSection id="employees" title="Employees" count={employeeCount}>
        <EmployeeSearchField
          count={employeeCount}
          actions={{ search: actions.search, pickEmployee: actions.pickEmployee }}
        />
        {recentEmployees.length > 0 ? (
          <div className="mt-2 flex flex-col gap-2">
            <h3 id="recent-employees-heading" className="text-xs text-muted-foreground">
              Recently started
            </h3>
            <ul aria-labelledby="recent-employees-heading" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {recentEmployees.map((employee) => (
                <li key={employee.id}>
                  <PersonaTile
                    tile={recentEmployeeTile(employee, now)}
                    personaId={employee.id}
                    action={actions.pickEmployee.bind(null, employee.id)}
                  />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </PersonaSection>
    </PickerFrame>
  )
}

/** Header and width of `/pick`; also the frame of its loading skeleton. */
export function PickerFrame({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-12 sm:py-16">
      <header className="flex flex-col gap-6">
        <div className="flex items-center gap-2.5">
          <NorthwindLogo />
          <span className="text-base font-semibold tracking-tight">Northwind</span>
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Choose who you&apos;re signing in as</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            This is a demo session: pick a person to open their portal. There is no password.
          </p>
        </div>
      </header>
      {children}
    </main>
  )
}

function PersonaSection({
  id,
  title,
  count,
  children,
}: {
  id: string
  title: string
  count: number
  children: ReactNode
}) {
  return (
    <section aria-labelledby={`${id}-heading`} data-testid={`persona-section-${id}`} className="flex flex-col gap-3">
      <h2 id={`${id}-heading`} className="flex items-baseline gap-2 text-sm font-medium">
        {title}
        <span className="font-normal text-muted-foreground tabular-nums">
          {count.toLocaleString("en-US")}
        </span>
      </h2>
      {children}
    </section>
  )
}

function TileGrid({ empty, children }: { empty: string; children: ReactNode[] }) {
  if (children.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>
  return <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</ul>
}
