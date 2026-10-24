import type { ReactNode } from "react"

import type { SessionUser } from "@/auth"
import { SidebarNav, type NavItem } from "@/components/app-shell/sidebar-nav"
import { SidebarShell } from "@/components/app-shell/sidebar-shell"
import { NorthwindLogo } from "@/components/northwind-logo"
import { PersonaSwitcher } from "@/components/persona-switcher"

export type { NavItem }

/**
 * Portal chrome for all four roles: sidebar (logo and name, nav, persona block). Pages render their
 * own PageHeader; there is no top bar on desktop.
 */
export function PortalShell({
  user,
  nav,
  children,
}: {
  user: SessionUser
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
      <PersonaSwitcher user={user} />
    </>
  )

  return (
    <SidebarShell sidebar={sidebar}>
      {children}
    </SidebarShell>
  )
}
