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
          count: openTaskCount(getDb(), user),
        },
        { label: "People", icon: "people", href: "/onboarding/people", prefix: true },
      ]}
    >
      {children}
    </PortalLayout>
  )
}
