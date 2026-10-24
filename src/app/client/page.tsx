import { Suspense } from "react"

import { requirePortalUser } from "@/auth"
import { ClientHomeSkeleton } from "@/components/client-home/client-home-skeleton"
import { ClientTodo } from "@/components/client-home/client-todo"
import { GlanceCards } from "@/components/client-home/glance-cards"
import { PageHeader } from "@/components/page-header"
import { TaskNotice } from "@/components/tasks/task-notice"
import { getDb } from "@/db"
import { glanceCards } from "@/lib/client-home"
import { loadClientHome } from "@/server/client-home"
import { financeQueries } from "@/server/finance-queries"

import { StartHireButton } from "./start-hire-button"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default function ClientHomePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Home" actions={<StartHireButton />} />
      <Suspense fallback={<ClientHomeSkeleton />}>
        <TaskNotice portal="client" searchParams={searchParams} />
        <ClientHome />
      </Suspense>
    </div>
  )
}

async function ClientHome() {
  const user = await requirePortalUser("client_hr")
  const now = new Date()
  const home = await loadClientHome({ db: getDb(), finance: financeQueries }, user, now)
  return (
    <div className="flex flex-col gap-8">
      <GlanceCards cards={glanceCards({ people: home.people, invoices: home.invoices })} />
      <ClientTodo view={home.todo} nowIso={now.toISOString()} />
    </div>
  )
}
