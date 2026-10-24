import { Suspense } from "react"

import { requirePortalUser } from "@/auth"
import { PageHeader } from "@/components/page-header"
import { PeopleList } from "@/components/people/people-list"
import { Skeleton } from "@/components/ui/skeleton"
import { getDb } from "@/db"
import { parsePeopleQuery } from "@/lib/people-query"
import { listPeople } from "@/server/queries"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default function PeoplePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="People" />
      <Suspense fallback={<PeopleSkeleton />}>
        <People searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

function PeopleSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-72 w-full" />
    </div>
  )
}

async function People({ searchParams }: { searchParams: SearchParams }) {
  const [, params] = await Promise.all([requirePortalUser("onboarding_specialist"), searchParams])
  // The team does not work by location: a stale `?location=` or `sort=location` in a link is dropped.
  const parsed = parsePeopleQuery(params)
  const query = { ...parsed, location: null, sort: parsed.sort === "location" ? null : parsed.sort }
  return (
    <PeopleList
      portal="onboarding"
      data={listPeople(getDb(), null, query)}
      query={query}
      emptyMessage="No one yet. People appear here as clients place orders."
    />
  )
}
