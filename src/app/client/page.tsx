import { Suspense } from "react"
import Link from "next/link"
import { Plus } from "lucide-react"

import { requirePortalUser } from "@/auth"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { AttentionPanel } from "@/components/tasks/attention-panel"
import { TaskNotice } from "@/components/tasks/task-notice"
import { Skeleton } from "@/components/ui/skeleton"
import { getDb } from "@/db"
import { parsePeopleQuery } from "@/lib/people-query"
import { listPeople } from "@/server/queries"
import { attentionFor } from "@/server/task-inbox"

import { PeopleList } from "./people-list"

/** More than the three the panel shows at first, so "View all" can expand without another request. */
const ATTENTION_LOAD_LIMIT = 25

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default function ClientPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="People" actions={<StartHireButton />} />
      <Suspense fallback={<PeopleSkeleton />}>
        <TaskNotice portal="client" searchParams={searchParams} />
        <Attention />
        <People searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

function StartHireButton({ variant = "default" as const }: { variant?: "default" | "outline" }) {
  return (
    <Button
      variant={variant}
      render={<Link href="/client/people/new" />}
      nativeButton={false}
      data-testid="start-hire"
    >
      <Plus data-icon="inline-start" />
      Start a hire
    </Button>
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

/** The client's own open tasks (accept the agreement, pay the deposit); nothing when there are none. */
async function Attention() {
  const user = await requirePortalUser("client_hr")
  const now = new Date()
  const { rows, total } = attentionFor(getDb(), user, now, ATTENTION_LOAD_LIMIT)
  return <AttentionPanel rows={rows} total={total} nowIso={now.toISOString()} />
}

async function People({ searchParams }: { searchParams: SearchParams }) {
  const [user, params] = await Promise.all([requirePortalUser("client_hr"), searchParams])
  const query = parsePeopleQuery(params)
  const data = listPeople(getDb(), user.clientCompanyId ?? "", query)
  return (
    <PeopleList
      data={data}
      query={query}
      emptyAction={<StartHireButton variant="outline" />}
    />
  )
}
