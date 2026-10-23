import { Suspense, type ReactNode } from "react"

import { requirePortalUser } from "@/auth"
import { PortalShell } from "@/components/portal-shell"

async function ReviewGuard({ children }: { children: ReactNode }) {
  const user = await requirePortalUser("eor_reviewer")
  return (
    <PortalShell title="Reviewer portal" user={user}>
      {children}
    </PortalShell>
  )
}

export default function ReviewLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <main className="p-8 text-sm text-muted-foreground">Loading…</main>
      }
    >
      <ReviewGuard>{children}</ReviewGuard>
    </Suspense>
  )
}
