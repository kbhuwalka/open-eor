import type { ReactNode } from "react"

import { PortalLayout } from "@/components/app-shell/portal-layout"
import type { NavItem } from "@/components/portal-shell"
import { getDb } from "@/db"
import { listPendingDeposits, paymentStatusCounts } from "@/server/finance-portal-queries"

export default function FinanceLayout({ children }: { children: ReactNode }) {
  return (
    <PortalLayout
      role="finance"
      nav={(user): NavItem[] => {
        const db = getDb()
        return [
          { label: "Home", icon: "home", href: "/finance", also: ["/finance/tasks"] },
          { label: "Payments", icon: "payments", href: "/finance/payments", prefix: true, count: paymentStatusCounts(db, user).initiated },
          { label: "Deposits", icon: "deposits", href: "/finance/deposits", prefix: true, count: listPendingDeposits(db, user).length },
          { label: "Invoices", icon: "invoices", href: "/finance/invoices", prefix: true },
          { label: "Receivables", icon: "receivables", href: "/finance/receivables", prefix: true },
          { label: "Billing run", icon: "billing", href: "/finance/billing", prefix: true },
        ]
      }}
    >
      {children}
    </PortalLayout>
  )
}
