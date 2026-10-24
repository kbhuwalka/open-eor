import { Suspense, type ReactNode } from "react"
import Link from "next/link"
import { notFound } from "next/navigation"

import { PageHeader } from "@/components/page-header"
import type { PayHrefs } from "@/components/pay/hrefs"
import { PayDashboardView } from "@/components/pay/pay-dashboard-view"
import { PayDashboardSkeleton, PayslipDetailSkeleton } from "@/components/pay/pay-skeletons"
import { PayslipDetailView } from "@/components/pay/payslip-detail-view"
import { ThemeRoot } from "@/components/theme-root"
import { Separator } from "@/components/ui/separator"
import { parseYearParam, resolvePayYear } from "@/lib/payslip-view"
import { US_STATES } from "@/lib/us-states"

import { buildPayFixtures, FIXTURE_NOW, SAMPLE_USER_ID, type PayFixtureScenario } from "./fixtures"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const SCENARIOS: { id: PayFixtureScenario; label: string }[] = [
  { id: "full", label: "Pay history" },
  { id: "new-hire", label: "Before first pay date" },
  { id: "no-schedule", label: "No pay schedule" },
]
const STATES = ["CA", "TX", "NY"]

/**
 * Dev-only review page for the employee pay dashboard. Every slip is computed by the real payroll
 * domain (`./fixtures`); nothing is stored. The clock is pinned to `FIXTURE_NOW`. Returns 404 in
 * production, like the other `/dev` pages.
 */
export default function DevPayPage({ searchParams }: { searchParams: SearchParams }) {
  if (process.env.NODE_ENV === "production") notFound()
  return (
    <Suspense fallback={<main className="p-8 text-sm text-muted-foreground">Loading…</main>}>
      <DevPay searchParams={searchParams} />
    </Suspense>
  )
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function href(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value)
  const text = query.toString()
  return text ? `/dev/pay?${text}` : "/dev/pay"
}

function Panel({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-4" data-testid={`dev-${id}`}>
      <h2 id={`${id}-title`} className="text-lg font-medium">
        {title}
      </h2>
      <div className="rounded-lg border border-border bg-card p-6">{children}</div>
    </section>
  )
}

function Choice({ to, active, children }: { to: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={to}
      aria-current={active ? "true" : undefined}
      className={active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}
    >
      {children}
    </Link>
  )
}

async function DevPay({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const scenario = SCENARIOS.find((s) => s.id === first(params.scenario))?.id ?? "full"
  const requestedState = first(params.state)
  const state = requestedState && US_STATES.some((s) => s.code === requestedState) ? requestedState : "CA"

  const { source, now } = buildPayFixtures({ scenario, state })
  const summary = await source.getPayDashboard(SAMPLE_USER_ID, { now })
  const year = resolvePayYear(parseYearParam(params.year), summary.availableYears, summary.taxYear)
  const payslips = await source.listPayslips(SAMPLE_USER_ID, { year }, { now })
  const slipId = first(params.slip) ?? payslips[0]?.id
  const detail = slipId ? await source.getPayslipDetail(SAMPLE_USER_ID, slipId, { now }) : null

  const keep = { scenario: scenario === "full" ? undefined : scenario, state: state === "CA" ? undefined : state }
  const hrefs: PayHrefs = {
    slip: (id) => `${href({ ...keep, year: String(year), slip: id })}#detail`,
    pdf: (id) => `/worker/pay/${encodeURIComponent(id)}/pdf`,
    list: href(keep),
  }

  return (
    <ThemeRoot>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-10">
        <PageHeader
          title="Pay review"
          description={`Review of the employee pay dashboard, as of ${FIXTURE_NOW.toISOString().slice(0, 10)}. Slips are computed by the payroll domain for a sample salaried employee.`}
        />
        <div className="flex flex-col gap-2 text-sm" data-testid="dev-controls">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <span className="text-muted-foreground">Scenario</span>
            {SCENARIOS.map((s) => (
              <Choice key={s.id} to={href({ state: keep.state, scenario: s.id === "full" ? undefined : s.id })} active={s.id === scenario}>
                {s.label}
              </Choice>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <span className="text-muted-foreground">Work state</span>
            {STATES.map((code) => (
              <Choice key={code} to={href({ scenario: keep.scenario, state: code === "CA" ? undefined : code })} active={code === state}>
                {code}
              </Choice>
            ))}
          </div>
        </div>

        <Panel id="dashboard" title="Dashboard (/worker/pay)">
          <div className="flex flex-col gap-6">
            <PageHeader title="Pay" description="Your pay slips, withholdings and year-to-date totals." />
            <PayDashboardView summary={summary} payslips={payslips} selectedYear={year} hrefs={hrefs} />
          </div>
        </Panel>

        {detail ? (
          <div id="detail" className="scroll-mt-6">
            <Panel id="detail-view" title="Pay slip detail (/worker/pay/[payslipId])">
              <PayslipDetailView detail={detail} hrefs={hrefs} />
            </Panel>
          </div>
        ) : null}

        <Separator />
        <Panel id="skeletons" title="Loading states">
          <div className="flex flex-col gap-10">
            <PayDashboardSkeleton />
            <PayslipDetailSkeleton />
          </div>
        </Panel>
      </div>
    </ThemeRoot>
  )
}
