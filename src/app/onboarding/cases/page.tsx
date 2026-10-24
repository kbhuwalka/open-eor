import { Suspense } from "react"
import { notFound } from "next/navigation"

import { requirePortalUser } from "@/auth"
import { CasesTable } from "@/components/onboarding-portal/cases-table"
import { PageHeader } from "@/components/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { getDb } from "@/db"
import { parseCasesQuery } from "@/lib/onboarding-portal/cases-query"
import { casesDirectory } from "@/server/onboarding-portal/directory"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default function CasesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Cases" description="Everyone being onboarded or already on payroll, across all clients. At-risk starts come first." />
      <Suspense fallback={<CasesSkeleton />}>
        <Cases searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

function CasesSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-72 w-full" />
    </div>
  )
}

async function Cases({ searchParams }: { searchParams: SearchParams }) {
  const [user, params] = await Promise.all([requirePortalUser("onboarding_specialist"), searchParams])
  const query = parseCasesQuery(params)
  const now = new Date()
  const data = casesDirectory(getDb(), user, query, now)
  if (!data) notFound()
  return <CasesTable data={data} query={query} nowIso={now.toISOString()} />
}
