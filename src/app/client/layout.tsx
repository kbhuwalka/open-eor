import { Suspense, type ReactNode } from "react"

import { requirePortalUser } from "@/auth"
import { PortalShell } from "@/components/portal-shell"

async function ClientGuard({ children }: { children: ReactNode }) {
  const user = await requirePortalUser("client_hr")
  return (
    <PortalShell title="Client portal" user={user}>
      {children}
    </PortalShell>
  )
}

export default function ClientLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <main className="p-8 text-sm text-muted-foreground">Loading…</main>
      }
    >
      <ClientGuard>{children}</ClientGuard>
    </Suspense>
  )
}
