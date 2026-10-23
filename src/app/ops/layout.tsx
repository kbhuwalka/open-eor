import { Suspense, type ReactNode } from "react"

import { requirePortalUser } from "@/auth"
import { PortalShell } from "@/components/portal-shell"

async function OpsGuard({ children }: { children: ReactNode }) {
  const user = await requirePortalUser("eor_ops")
  return (
    <PortalShell title="Ops portal" user={user}>
      {children}
    </PortalShell>
  )
}

export default function OpsLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <main className="p-8 text-sm text-muted-foreground">Loading…</main>
      }
    >
      <OpsGuard>{children}</OpsGuard>
    </Suspense>
  )
}
