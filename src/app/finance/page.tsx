import { cache, Suspense } from "react"

import { requirePortalUser } from "@/auth"
import { HomeBilledCard, HomeWhoOwesCard } from "@/components/finance-portal/home/home-charts"
import { HomeTiles } from "@/components/finance-portal/home/home-tiles"
import { WaitingOnYou } from "@/components/finance-portal/home/waiting-on-you"
import { HomeChartsSkeleton, HomeTilesSkeleton, WaitingSkeleton } from "@/components/finance-portal/skeletons"
import { PageHeader } from "@/components/page-header"
import { getDb } from "@/db"
import { businessDayOf } from "@/domain/business-time"
import { DEFAULT_CHART_PERIODS } from "@/lib/finance-chart-view"
import { homeDateLabel, WAITING_LIMIT } from "@/lib/finance-home-view"
import { billedVsCollectedByPeriod, clientAgeing, oldestWaitingPayments } from "@/server/finance-insights"
import { financeOverview } from "@/server/finance-portal-queries"

/** One session, clock and database per request, shared by the Home's sections. */
const homeRequest = cache(async () => {
  const user = await requirePortalUser("finance")
  return { user, db: getDb(), now: new Date() }
})

/** The book's ageing is read by the Overdue tile and by "Who owes us": once per request. */
const homeAgeing = cache(async () => {
  const { db, user, now } = await homeRequest()
  return clientAgeing(db, user, now)
})

export default function FinanceHomePage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Finance"
        description={
          <Suspense fallback={<span aria-hidden className="inline-block h-4 w-28 animate-pulse rounded-md bg-muted align-middle" />}>
            <HomeDate />
          </Suspense>
        }
      />
      <Suspense fallback={<HomeTilesSkeleton />}>
        <Tiles />
      </Suspense>
      <Suspense fallback={<HomeChartsSkeleton />}>
        <Charts />
      </Suspense>
      <Suspense fallback={<WaitingSkeleton />}>
        <Waiting />
      </Suspense>
    </div>
  )
}

async function HomeDate() {
  const { now } = await homeRequest()
  return <span data-testid="home-date">{homeDateLabel(businessDayOf(now))}</span>
}

async function Tiles() {
  const [{ db, user, now }, ageing] = await Promise.all([homeRequest(), homeAgeing()])
  return <HomeTiles overview={financeOverview(db, user, now, { book: ageing.bookAgeing })} />
}

async function Charts() {
  const [{ db, user, now }, ageing] = await Promise.all([homeRequest(), homeAgeing()])
  const billed = billedVsCollectedByPeriod(db, user, now, DEFAULT_CHART_PERIODS)
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <HomeBilledCard billed={billed} className="lg:col-span-3" />
      <HomeWhoOwesCard ageing={ageing} className="lg:col-span-2" />
    </div>
  )
}

async function Waiting() {
  const { db, user, now } = await homeRequest()
  return <WaitingOnYou waiting={oldestWaitingPayments(db, user, now, WAITING_LIMIT)} today={businessDayOf(now)} />
}
