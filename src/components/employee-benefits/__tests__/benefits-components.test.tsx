import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const action = vi.hoisted(() => ({ changeContributionAction: vi.fn() }))
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }))

vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/worker/benefits" }))
vi.mock("@/app/worker/benefits/actions", () => action)

import { US_2026 } from "@/domain/cost-rates"
import type { BenefitsPageData } from "@/server/employee-benefits"

import { BenefitsView } from "../benefits-view"
import { ContributionForm } from "../contribution-form"

afterEach(cleanup)
beforeEach(() => {
  action.changeContributionAction.mockReset()
  router.refresh.mockReset()
})

const period = { index: 12, start: "2026-11-02", end: "2026-11-15", payDate: "2026-11-20" }

function pageData(patch: Partial<BenefitsPageData> = {}): BenefitsPageData {
  return {
    employerName: "Acme Co",
    package: "premium",
    packageLabel: "Premium",
    decisionHref: null,
    elected: true,
    health: { tier: "employee_spouse", label: "Employee + spouse", employeeCents: 21_000, employerCents: 39_000, totalCents: 60_000 },
    retirement: {
      currentPct: 4,
      pending: null,
      matchRatePct: 100,
      matchCapPct: 4,
      defaultPct: 4,
      maxPct: US_2026.retirement401k.maxDeferralPct,
      annualLimitCents: US_2026.retirement401k.annualElectiveDeferralLimitCents,
      compensationLimitCents: US_2026.retirement401k.annualCompensationLimitCents,
      grossPerPeriodCents: 520_000,
      wageCents: 6500,
      wageUnit: "hourly",
      currentPeriod: { index: 11, start: "2026-10-19", end: "2026-11-01", payDate: "2026-11-06" },
      schedule: [{ version: 1, effectiveFrom: null, deferralPct: 4 }],
      startDate: "2026-03-02",
      perPaycheck: { deferralCents: 20_800, matchCents: 20_800 },
    },
    change: { allowed: true, reason: null, period, taxYear: 2026 },
    history: [
      { version: 1, status: "in_force", decidedAt: "2026-03-05T15:00:00.000Z", decidedBy: "You", source: "onboarding", healthLabel: "Employee + spouse", retirementDeferralPct: 4, effectiveFrom: null },
    ],
    ...patch,
  }
}

describe("BenefitsView", () => {
  it("shows the health tier read-only with the Northwind note, and the 401(k) with its match and the IRS limit", () => {
    render(<BenefitsView data={pageData()} />)
    const health = screen.getByTestId("benefits-health")
    expect(within(health).getByTestId("benefits-health-plan")).toHaveTextContent("Employee + spouse")
    expect(within(health).queryByRole("radio")).toBeNull()
    expect(within(health).queryByRole("button")).toBeNull()
    expect(screen.getByTestId("benefits-health-note")).toHaveTextContent(/go through Northwind/)

    expect(screen.getByTestId("benefits-current-pct")).toHaveTextContent("4% of each paycheck")
    expect(screen.getByTestId("benefits-irs-limit")).toHaveTextContent("$24,500")
    expect(screen.getByText("100% of what you contribute, up to 4% of your pay")).toBeInTheDocument()
  })

  it("says a waived health plan is waived", () => {
    render(<BenefitsView data={pageData({ health: null })} />)
    expect(screen.getByTestId("benefits-health-plan")).toHaveTextContent("Waived")
  })

  it("lists the history newest first with who and when, and marks a pending change", () => {
    const data = pageData({
      retirement: { ...pageData().retirement, pending: { pct: 8, effectiveFrom: "2026-11-02", period } },
      history: [
        { version: 2, status: "pending", decidedAt: "2026-10-24T10:00:00.000Z", decidedBy: "You", source: "employee_change", healthLabel: "Employee + spouse", retirementDeferralPct: 8, effectiveFrom: "2026-11-02" },
        { version: 1, status: "in_force", decidedAt: "2026-03-05T15:00:00.000Z", decidedBy: "Northwind", source: "onboarding", healthLabel: null, retirementDeferralPct: 4, effectiveFrom: null },
      ],
    })
    render(<BenefitsView data={data} />)
    expect(screen.getByTestId("benefits-pending")).toHaveTextContent("8% of each paycheck")
    const entries = screen.getAllByTestId("benefits-history-entry")
    expect(entries).toHaveLength(2)
    expect(entries[0]).toHaveTextContent("8% 401(k), Employee + spouse")
    expect(entries[0]).toHaveTextContent("Starts later")
    expect(entries[0]).toHaveTextContent("From the pay period starting Nov 2, 2026")
    expect(entries[0]).toHaveTextContent("Changed by You on Oct 24, 2026")
    expect(entries[1]).toHaveTextContent("4% 401(k), health waived")
    expect(entries[1]).toHaveTextContent("From your first day")
    expect(entries[1]).toHaveTextContent("Chosen by Northwind on Mar 5, 2026")
  })

  it("sends someone who has not chosen yet to their first decision", () => {
    render(<BenefitsView data={pageData({ elected: false, decisionHref: "/worker/tasks/task_9", health: null, history: [] })} />)
    expect(screen.getByRole("link", { name: "Choose your benefits" })).toHaveAttribute("href", "/worker/tasks/task_9")
    expect(screen.queryByTestId("contribution-form")).toBeNull()
  })
})

describe("ContributionForm", () => {
  it("states when a save takes effect, from the pay calendar", () => {
    render(<ContributionForm data={pageData()} />)
    expect(screen.getByTestId("contribution-effective")).toHaveTextContent("Takes effect with the pay period starting Nov 2, 2026")
    expect(screen.getByTestId("contribution-effective")).toHaveTextContent("paid Nov 20, 2026")
  })

  it("starts from the saved percent with Save off until it changes, then saves and confirms", async () => {
    action.changeContributionAction.mockResolvedValue({ ok: true, data: { changed: true, deferralPct: 10, previousPct: 4, period } })
    render(<ContributionForm data={pageData()} />)
    const user = userEvent.setup()
    const save = screen.getByTestId("contribution-save")
    expect(screen.getByTestId("deferral-input")).toHaveValue(4)
    expect(save).toBeDisabled()

    await user.clear(screen.getByTestId("deferral-input"))
    await user.type(screen.getByTestId("deferral-input"), "10")
    expect(save).toBeEnabled()
    await user.click(save)

    await waitFor(() => expect(action.changeContributionAction).toHaveBeenCalledWith(10))
    const notice = await screen.findByRole("status")
    expect(notice).toHaveTextContent("Saved. Your contribution is 10% from the pay period starting Nov 2, 2026.")
    expect(router.refresh).toHaveBeenCalled()
  })

  it("shows the server's message and the field's message when a save is refused, and keeps the typed value", async () => {
    action.changeContributionAction.mockResolvedValue({
      ok: false,
      code: "validation",
      message: "Choose a contribution between 0% and 75% of each paycheck.",
      details: { errors: { deferralPct: "Choose a contribution between 0% and 75% of each paycheck." } },
    })
    render(<ContributionForm data={pageData()} />)
    const user = userEvent.setup()
    await user.clear(screen.getByTestId("deferral-input"))
    await user.type(screen.getByTestId("deferral-input"), "6")
    await user.click(screen.getByTestId("contribution-save"))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Choose a contribution between 0% and 75%")
    expect(alert).toHaveTextContent("Contribution:")
    expect(screen.getByTestId("deferral-input")).toHaveValue(6)
    expect(screen.queryByRole("status")).toBeNull()
    expect(router.refresh).not.toHaveBeenCalled()
  })

  it("says so when the percent is already saved on the server", async () => {
    action.changeContributionAction.mockResolvedValue({ ok: true, data: { changed: false, deferralPct: 5, previousPct: 5, period } })
    render(<ContributionForm data={pageData()} />)
    const user = userEvent.setup()
    await user.clear(screen.getByTestId("deferral-input"))
    await user.type(screen.getByTestId("deferral-input"), "5")
    await user.click(screen.getByTestId("contribution-save"))
    expect(await screen.findByRole("status")).toHaveTextContent("Nothing to save: your contribution is already 5%.")
  })

  it("warns when a percent reaches the IRS annual limit, and does not when it stays under it", async () => {
    const high = pageData().retirement
    const early = { index: 6, start: "2026-03-16", end: "2026-03-29", payDate: "2026-04-03" }
    render(
      <ContributionForm
        data={pageData({
          retirement: { ...high, wageCents: 40_000_000, wageUnit: "annual", grossPerPeriodCents: 1_538_462 },
          change: { allowed: true, reason: null, period: early, taxYear: 2026 },
        })}
      />,
    )
    const user = userEvent.setup()
    const limits = screen.getByTestId("contribution-limits")
    expect(limits).toHaveTextContent(/under the IRS limit of \$24,500\b/)
    expect(limits).toHaveTextContent(/Pay above \$360,000 a year/)
    await user.clear(screen.getByTestId("deferral-input"))
    await user.type(screen.getByTestId("deferral-input"), "75")
    expect(limits).toHaveTextContent(/you reach the IRS limit of \$24,500 a year in the pay period ending/)
  })

  it("explains instead of offering a form when a change cannot be made", () => {
    render(<ContributionForm data={pageData({ change: { allowed: false, reason: "Your employment has ended, so your contribution can no longer be changed.", period: null, taxYear: null } })} />)
    expect(screen.getByTestId("contribution-unavailable")).toHaveTextContent("Your employment has ended")
    expect(screen.queryByTestId("contribution-save")).toBeNull()
  })
})
