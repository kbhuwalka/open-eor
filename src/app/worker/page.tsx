import { Suspense } from "react"

import { requirePortalUser } from "@/auth"
import { PortalShell } from "@/components/portal-shell"

async function WorkerPortal() {
  const user = await requirePortalUser("worker")
  return (
    <PortalShell title="Worker portal" user={user}>
      <p className="text-sm text-muted-foreground">
        Onboarding checklist and uploads land in a later Issue. This shell
        confirms your session and role guard.
      </p>
    </PortalShell>
  )
}

export default function WorkerPage() {
  return (
    <Suspense
      fallback={
        <main className="p-8 text-sm text-muted-foreground">Loading…</main>
      }
    >
      <WorkerPortal />
    </Suspense>
  )
}
