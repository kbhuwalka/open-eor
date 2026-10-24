import { Suspense } from "react"

import { requirePortalUser } from "@/auth"
import { PageHeader } from "@/components/page-header"
import { SpecialistHome } from "@/components/onboarding-portal/specialist-home"
import { SpecialistHomeGroup, type HomeGroup } from "@/components/onboarding-portal/specialist-home-group"
import { TaskNotice } from "@/components/tasks/task-notice"
import { TaskInboxSkeleton } from "@/components/tasks/task-skeletons"
import { getDb } from "@/db"
import { todayIso } from "@/domain/employment-term"
import { TASK_INBOX_CONFIG } from "@/lib/task-inbox-config"
import { parseTaskInboxQuery, taskInboxSearch } from "@/lib/task-inbox-view"
import { staffHome } from "@/server/task-inbox"
import { loadTaskPage } from "@/server/task-page"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default function OnboardingHomePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Home"
        description="What needs the onboarding team today, most urgent first."
        actions={
          <Suspense fallback={null}>
            <Group searchParams={searchParams} />
          </Suspense>
        }
      />
      <Suspense fallback={<TaskInboxSkeleton />}>
        <TaskNotice portal="onboarding" searchParams={searchParams} />
        <Home searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function Group({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  return <SpecialistHomeGroup group={groupOf(params)} search={taskInboxSearch(parseTaskInboxQuery(params))} />
}

function groupOf(params: Awaited<SearchParams>): HomeGroup {
  return params.group === "task" ? "task" : "urgency"
}

function openParam(params: Awaited<SearchParams>): string | null {
  const raw = Array.isArray(params.open) ? params.open[0] : params.open
  return raw && /^[\w-]{1,80}$/.test(raw) ? raw : null
}

async function Home({ searchParams }: { searchParams: SearchParams }) {
  const [user, params] = await Promise.all([requirePortalUser("onboarding_specialist"), searchParams])
  const query = parseTaskInboxQuery(params)
  const group = groupOf(params)
  const now = new Date()
  const db = getDb()
  const data = staffHome(db, user, query, now)
  const openId = openParam(params)
  const linked = openId && !data.rows.some((row) => row.id === openId) ? loadTaskPage(db, user, "onboarding", openId, now) : null
  return (
    <SpecialistHome
      data={data}
      query={query}
      group={group}
      today={todayIso(now)}
      nowIso={now.toISOString()}
      initialTaskId={openId}
      linkedRow={linked ? { ...linked.row, startDate: linked.caseSummary.startDate } : null}
      emptyMessage={TASK_INBOX_CONFIG.onboarding.emptyMessage}
    />
  )
}
