import type { ReactNode } from "react"

import { PortalLayout } from "@/components/app-shell/portal-layout"
import type { NavItem } from "@/components/portal-shell"
import { getDb } from "@/db"
import { openTaskCount } from "@/server/task-inbox"

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <PortalLayout
      role="onboarding_specialist"
      nav={(user): NavItem[] => [
        {
          label: "Home",
          icon: "home",
          href: "/onboarding",
          also: ["/onboarding/tasks"],
          count: openTaskCount(getDb(), user),
        },
        { label: "Cases", icon: "people", href: "/onboarding/cases", prefix: true },
        { label: "Clients", icon: "finance", href: "/onboarding/clients", prefix: true },
      ]}
    >
      {children}
    </PortalLayout>
  )
}
