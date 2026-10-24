import { Suspense } from "react"

import { requirePortalUser } from "@/auth"
import { EmployeeHome } from "@/components/employee-tasks/employee-home"
import { EmployeeHomeSkeleton } from "@/components/employee-tasks/employee-skeletons"
import { EmptyState } from "@/components/empty-state"
import { PageHeader } from "@/components/page-header"
import { TaskNotice } from "@/components/tasks/task-notice"
import { getDb } from "@/db"
import { loadEmployeeHome } from "@/server/employee-home"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default function WorkerPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="flex w-full max-w-2xl flex-col gap-6">
      <Suspense fallback={<EmployeeHomeSkeleton />}>
        <TaskNotice portal="worker" searchParams={searchParams} />
        <Home />
      </Suspense>
    </div>
  )
}

async function Home() {
  const user = await requirePortalUser("worker")
  const now = new Date()
  const data = await loadEmployeeHome(getDb(), user.id, now)
  if (!data) {
    return (
      <>
        <PageHeader title={`Welcome, ${user.displayName.split(" ")[0]}`} />
        <EmptyState message="You have no employment set up yet. Your employer's onboarding starts once they invite you." />
      </>
    )
  }
  return <EmployeeHome data={data} nowIso={now.toISOString()} />
}
