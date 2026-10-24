import { Suspense } from "react"

import { requirePortalUser } from "@/auth"
import { PageHeader } from "@/components/page-header"
import { PeopleList } from "@/components/people/people-list"
import { Skeleton } from "@/components/ui/skeleton"
import { getDb } from "@/db"
import { parsePeopleQuery } from "@/lib/people-query"
import { listPeople } from "@/server/queries"

import { StartHireButton } from "../start-hire-button"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default function PeoplePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="People" actions={<StartHireButton />} />
      <Suspense fallback={<PeopleSkeleton />}>
        <People searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

function PeopleSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy>
      <div className="flex gap-3">
        <Skeleton className="h-10 flex-1" />
        <Skeleton className="h-10 w-44" />
        <Skeleton className="h-10 w-48" />
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <Skeleton className="h-10 w-full rounded-none" />
        <div className="flex flex-col gap-4 p-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex gap-6">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-32" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

async function People({ searchParams }: { searchParams: SearchParams }) {
  const [user, params] = await Promise.all([requirePortalUser("client_hr"), searchParams])
  const query = parsePeopleQuery(params)
  const data = listPeople(getDb(), user.clientCompanyId ?? "", query)
  return <PeopleList data={data} query={query} emptyAction={<StartHireButton variant="outline" />} />
}
