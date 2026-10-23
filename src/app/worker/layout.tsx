import { Suspense, type ReactNode } from "react"

import { requirePortalUser } from "@/auth"
import { PortalShell } from "@/components/portal-shell"

async function WorkerGuard({ children }: { children: ReactNode }) {
  const user = await requirePortalUser("worker")
  return (
    <PortalShell title="Worker portal" user={user}>
      {children}
    </PortalShell>
  )
}

export default function WorkerLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <main className="p-8 text-sm text-muted-foreground">Loading…</main>
      }
    >
      <WorkerGuard>{children}</WorkerGuard>
    </Suspense>
  )
}
