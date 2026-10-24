import type { ReactNode } from "react"

import { searchEmployeesAction } from "@/app/pick/actions"
import { clearPersona, pickEmployee, pickPersona } from "@/auth/actions"
import { SidebarNav, type NavItem } from "@/components/app-shell/sidebar-nav"
import { SidebarShell } from "@/components/app-shell/sidebar-shell"
import { NorthwindLogo } from "@/components/northwind-logo"
import { PersonaSwitcher } from "@/components/persona-switcher"
import type { Persona, PickerPersonas } from "@/server/personas"

export type { NavItem }

/**
 * Portal chrome for all four roles: sidebar (logo and name, nav, persona block). Pages render their
 * own PageHeader; there is no top bar on desktop. `persona` is the signed-in user and `personas` the
 * picker's groups, which the persona switcher offers with the same sign-in actions as `/pick`.
 */
export function PortalShell({
  persona,
  personas,
  nav,
  children,
}: {
  persona: Persona
  personas: PickerPersonas
  nav: NavItem[]
  children?: ReactNode
}) {
  const sidebar = (
    <>
      <div className="flex h-16 items-center gap-2.5 px-5">
        <NorthwindLogo />
        <span className="text-base font-semibold tracking-tight">Northwind</span>
      </div>
      <SidebarNav items={nav} />
      <PersonaSwitcher
        current={persona}
        personas={personas}
        actions={{ pickPersona, pickEmployee, clearPersona, search: searchEmployeesAction }}
      />
    </>
  )

  return (
    <SidebarShell sidebar={sidebar}>
      {children}
    </SidebarShell>
  )
}
