import { Suspense } from "react"

import { requirePortalUser } from "@/auth"
import { EmptyState } from "@/components/empty-state"
import { PageHeader } from "@/components/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { getDb } from "@/db"
import { agreementFor } from "@/server/queries"

import { CostCalculator } from "./cost-calculator"

export default function CalculatorPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Calculator />
    </Suspense>
  )
}

async function Calculator() {
  const user = await requirePortalUser("client_hr")
  const agreement = agreementFor(getDb(), user.clientCompanyId ?? "")

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Cost calculator"
        description="Estimate what a hire costs before you start one. It uses the same rates and rules as your quote and invoices."
      />
      {agreement ? (
        <CostCalculator markupPct={agreement.markupPct} />
      ) : (
        <EmptyState message="Your company has no EOR agreement on file. Contact Northwind." />
      )}
    </div>
  )
}
