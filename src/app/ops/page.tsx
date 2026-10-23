import { Suspense } from "react"

import { requirePortalUser } from "@/auth"
import { PortalShell } from "@/components/portal-shell"

async function OpsPortal() {
  const user = await requirePortalUser("eor_ops")
  return (
    <PortalShell title="Ops portal" user={user}>
      <p className="text-sm text-muted-foreground">
        Setup, release, and reopen flows land in a later Issue. Ops cannot
        approve work-auth — enforced server-side when those actions exist.
      </p>
    </PortalShell>
  )
}

export default function OpsPage() {
  return (
    <Suspense
      fallback={
        <main className="p-8 text-sm text-muted-foreground">Loading…</main>
      }
    >
      <OpsPortal />
    </Suspense>
  )
}
