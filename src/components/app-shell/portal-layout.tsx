import { Suspense, type ReactNode } from "react"

import { requirePortalUser } from "@/auth"
import { PortalShell, type NavItem } from "@/components/portal-shell"
import { ThemeRoot } from "@/components/theme-root"
import { getDb } from "@/db"
import type { UserRole } from "@/domain/types"
import { listPickerPersonas, personaOf } from "@/server/personas"

/**
 * Shared body for the four portal layouts: guard, theme, shell, nav.
 * `nav` may depend on the session user (e.g. count badges).
 */
export function PortalLayout({
  role,
  nav,
  children,
}: {
  role: UserRole
  nav: NavItem[] | ((user: Awaited<ReturnType<typeof requirePortalUser>>) => NavItem[])
  children: ReactNode
}) {
  return (
    <Suspense
      fallback={
        <main className="p-8 text-sm text-muted-foreground">Loading…</main>
      }
    >
      <Guard role={role} nav={nav}>
        {children}
      </Guard>
    </Suspense>
  )
}

async function Guard({
  role,
  nav,
  children,
}: {
  role: UserRole
  nav: NavItem[] | ((user: Awaited<ReturnType<typeof requirePortalUser>>) => NavItem[])
  children: ReactNode
}) {
  const user = await requirePortalUser(role)
  const items = typeof nav === "function" ? nav(user) : nav
  const db = getDb()
  return (
    <ThemeRoot>
      <PortalShell persona={personaOf(db, user)} personas={listPickerPersonas(db)} nav={items}>
        {children}
      </PortalShell>
    </ThemeRoot>
  )
}
