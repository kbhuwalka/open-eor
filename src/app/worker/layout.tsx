import type { ReactNode } from "react"

import { PortalLayout } from "@/components/app-shell/portal-layout"
import { getDb } from "@/db"
import { openTaskCount } from "@/server/task-inbox"

export default function WorkerLayout({ children }: { children: ReactNode }) {
  return (
    <PortalLayout
      role="worker"
      nav={(user) => [
        {
          label: "Home",
          icon: "home",
          href: "/worker",
          also: ["/worker/tasks"],
          count: openTaskCount(getDb(), user),
        },
        { label: "Pay", icon: "finance", href: "/worker/pay", prefix: true },
        { label: "Benefits", icon: "benefits", href: "/worker/benefits", prefix: true },
        { label: "Documents", icon: "documents", href: "/worker/documents", prefix: true },
      ]}
    >
      {children}
    </PortalLayout>
  )
}
