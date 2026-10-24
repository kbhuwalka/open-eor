import { Suspense } from "react"
import { notFound } from "next/navigation"

import { requirePortalUser } from "@/auth"
import { BenefitsView } from "@/components/employee-benefits/benefits-view"
import { BenefitsSkeleton } from "@/components/employee-tasks/employee-skeletons"
import { PageHeader } from "@/components/page-header"
import { getDb } from "@/db"
import { loadBenefitsPage } from "@/server/employee-benefits"

export default function WorkerBenefitsPage() {
  return (
    <div className="flex w-full max-w-2xl flex-col gap-6">
      <PageHeader title="Benefits" description="Your health coverage and 401(k), and when a change to your contribution takes effect." />
      <Suspense fallback={<BenefitsSkeleton />}>
        <Benefits />
      </Suspense>
    </div>
  )
}

async function Benefits() {
  const user = await requirePortalUser("worker")
  const data = loadBenefitsPage(getDb(), user.id, new Date())
  if (!data) notFound()
  return <BenefitsView data={data} />
}
