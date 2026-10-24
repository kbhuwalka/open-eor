import { cache, Suspense } from "react"

import { requirePortalUser } from "@/auth"
import { ClientFilter } from "@/components/finance-portal/client-filter"
import { FinanceTodo } from "@/components/finance-portal/home/finance-todo"
import { HomeBilledCard } from "@/components/finance-portal/home/home-charts"
import { HomeFigures } from "@/components/finance-portal/home/home-figures"
import { HomeChartsSkeleton, HomeFiguresSkeleton, WaitingSkeleton } from "@/components/finance-portal/skeletons"
import { PageHeader } from "@/components/page-header"
import { getDb } from "@/db"
import { businessDayOf } from "@/domain/business-time"
import { DEFAULT_CHART_PERIODS } from "@/lib/finance-chart-view"
import { HOME_PATH, homeDateLabel, parseHomeClient, WAITING_LIMIT } from "@/lib/finance-home-view"
import { ageingTotalsFor, billedVsCollectedByPeriod, clientAgeing, oldestWaitingPayments } from "@/server/finance-insights"
import { financeOverview, listCompanyOptions } from "@/server/finance-portal-queries"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/** One session, clock and database per request, shared by the Home's sections. */
const homeRequest = cache(async () => {
  const user = await requirePortalUser("finance")
  return { user, db: getDb(), now: new Date() }
})

/** The clients to filter by, and the one `?client=` names (an unknown id is ignored, like any other bad value). */
const homeScope = cache(async (searchParams: SearchParams) => {
  const [{ db, user }, params] = await Promise.all([homeRequest(), searchParams])
  const companies = listCompanyOptions(db, user)
  const requested = parseHomeClient(params)
  return { companies, client: companies.some((company) => company.id === requested) ? requested : null }
})

/** The book's ageing is read by the figures line: once per request. */
const homeAgeing = cache(async () => {
  const { db, user, now } = await homeRequest()
  return clientAgeing(db, user, now)
})

/**
 * `/finance`: a figures line, billed vs collected across the page and To do (the payments to
 * settle), all for every client or, with `?client=<companyId>`, for one.
 */
export default function FinanceHomePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Finance"
        description={
          <Suspense fallback={<span aria-hidden className="inline-block h-4 w-28 animate-pulse rounded-md bg-muted align-middle" />}>
            <HomeDate />
          </Suspense>
        }
        actions={
          <Suspense fallback={null}>
            <HomeFilter searchParams={searchParams} />
          </Suspense>
        }
      />
      <Suspense fallback={<HomeFiguresSkeleton />}>
        <Figures searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<HomeChartsSkeleton />}>
        <Chart searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<WaitingSkeleton />}>
        <Todo searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function HomeDate() {
  const { now } = await homeRequest()
  return <span data-testid="home-date">{homeDateLabel(businessDayOf(now))}</span>
}

async function HomeFilter({ searchParams }: { searchParams: SearchParams }) {
  const { companies, client } = await homeScope(searchParams)
  return <ClientFilter companies={companies} value={client} path={HOME_PATH} testId="home-client-filter" />
}

async function Figures({ searchParams }: { searchParams: SearchParams }) {
  const [{ db, user, now }, ageing, { client }] = await Promise.all([homeRequest(), homeAgeing(), homeScope(searchParams)])
  return <HomeFigures overview={financeOverview(db, user, now, { book: ageingTotalsFor(ageing, client), companyId: client })} client={client} />
}

async function Chart({ searchParams }: { searchParams: SearchParams }) {
  const [{ db, user, now }, { client }] = await Promise.all([homeRequest(), homeScope(searchParams)])
  return <HomeBilledCard billed={billedVsCollectedByPeriod(db, user, now, DEFAULT_CHART_PERIODS, client)} />
}

async function Todo({ searchParams }: { searchParams: SearchParams }) {
  const [{ db, user, now }, { client }] = await Promise.all([homeRequest(), homeScope(searchParams)])
  return <FinanceTodo waiting={oldestWaitingPayments(db, user, now, WAITING_LIMIT, client)} today={businessDayOf(now)} client={client} />
}
