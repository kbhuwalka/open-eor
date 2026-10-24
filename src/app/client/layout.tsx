import type { ReactNode } from "react"

import { PortalLayout } from "@/components/app-shell/portal-layout"
import { getDb } from "@/db"
import { clientNav } from "@/lib/client-nav"
import { openTaskCount } from "@/server/task-inbox"

export default function ClientLayout({ children }: { children: ReactNode }) {
  return (
    <PortalLayout role="client_hr" nav={(user) => clientNav(openTaskCount(getDb(), user))}>
      {children}
    </PortalLayout>
  )
}
