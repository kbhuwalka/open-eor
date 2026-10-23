import { Suspense } from "react"

import { requirePortalUser } from "@/auth"
import { PortalShell } from "@/components/portal-shell"

async function ReviewPortal() {
  const user = await requirePortalUser("eor_reviewer")
  return (
    <PortalShell title="Review portal" user={user}>
      <p className="text-sm text-muted-foreground">
        Queue, document review, and decide flows land in a later Issue. Seeded
        case <span className="font-mono text-xs">case_pending_1</span> is in{" "}
        <span className="font-mono text-xs">pending_review</span>.
      </p>
    </PortalShell>
  )
}

export default function ReviewPage() {
  return (
    <Suspense
      fallback={
        <main className="p-8 text-sm text-muted-foreground">Loading…</main>
      }
    >
      <ReviewPortal />
    </Suspense>
  )
}
