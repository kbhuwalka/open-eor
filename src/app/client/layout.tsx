import type { ReactNode } from "react"

import { PortalLayout } from "@/components/app-shell/portal-layout"
import { getDb } from "@/db"
import { openTaskCount } from "@/server/task-inbox"

export default function ClientLayout({ children }: { children: ReactNode }) {
  return (
    <PortalLayout
      role="client_hr"
      nav={(user) => [
        {
          label: "People",
          icon: "people",
          href: "/client",
          also: ["/client/people", "/client/tasks"],
          count: openTaskCount(getDb(), user),
        },
        { label: "Finance", icon: "finance", href: "/client/finance" },
        { label: "Cost calculator", icon: "calculator", href: "/client/calculator" },
      ]}
    >
      {children}
    </PortalLayout>
  )
}
