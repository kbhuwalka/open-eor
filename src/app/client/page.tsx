import { Suspense } from "react"

import { requirePortalUser } from "@/auth"
import { PortalShell } from "@/components/portal-shell"

async function ClientPortal() {
  const user = await requirePortalUser("client_hr")
  return (
    <PortalShell title="Client portal" user={user}>
      <p className="text-sm text-muted-foreground">
        Role templates, agreement, and hire flows land in a later Issue. This
        shell confirms your session and role guard.
      </p>
    </PortalShell>
  )
}

export default function ClientPage() {
  return (
    <Suspense
      fallback={
        <main className="p-8 text-sm text-muted-foreground">Loading…</main>
      }
    >
      <ClientPortal />
    </Suspense>
  )
}
