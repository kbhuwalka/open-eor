import { describe, expect, it } from "vitest"

import { CLIENT_FINANCE_PATH } from "@/lib/client-nav"
import { formatCents } from "@/lib/format"
import { parsePeopleQuery } from "@/lib/people-query"

import { AT_RISK_PEOPLE_HREF, glanceCards, ONBOARDING_PEOPLE_HREF, type GlanceCard } from "../cards"
import type { InvoicesToPay } from "../invoices"

const cards = (people = { onboarding: 36, atRisk: 2 }, invoices: InvoicesToPay | null = null) => {
  const [onboarding, atRisk, invoicesCard] = glanceCards({ people, invoices })
  return { onboarding, atRisk, invoices: invoicesCard }
}

const due = (patch: Partial<InvoicesToPay> = {}): InvoicesToPay => ({
  count: 15,
  totalCents: 78_168_76,
  overdueCents: 0,
  overdueCount: 0,
  ...patch,
})

const queryOf = (href: string) => parsePeopleQuery(Object.fromEntries(new URL(href, "http://x").searchParams))

describe("glanceCards", () => {
  it("orders the cards Onboarding, At risk, Invoices due", () => {
    expect(glanceCards({ people: { onboarding: 1, atRisk: 0 }, invoices: null }).map((card: GlanceCard) => card.label)).toEqual([
      "Onboarding",
      "At risk",
      "Invoices due",
    ])
  })

  it("links Onboarding and At risk to the People list filtered to exactly those people", () => {
    expect(ONBOARDING_PEOPLE_HREF).toBe("/client/people?status=onboarding")
    expect(AT_RISK_PEOPLE_HREF).toBe("/client/people?atRisk=1")
    expect(queryOf(ONBOARDING_PEOPLE_HREF)).toMatchObject({ status: "onboarding", atRisk: false })
    expect(queryOf(AT_RISK_PEOPLE_HREF)).toMatchObject({ status: null, atRisk: true })
    const { onboarding, atRisk } = cards()
    expect(onboarding.href).toBe(ONBOARDING_PEOPLE_HREF)
    expect(atRisk.href).toBe(AT_RISK_PEOPLE_HREF)
  })

  it("names each card's link with its figure and label", () => {
    const { onboarding, atRisk } = cards()
    expect(onboarding).toMatchObject({ figure: "36", context: null, linkName: "36 Onboarding, view people", tone: "default" })
    expect(atRisk).toMatchObject({ figure: "2", context: null, linkName: "2 At risk, view people" })
  })

  it("puts the at-risk count in the danger tone only above zero", () => {
    expect(cards({ onboarding: 3, atRisk: 1 }).atRisk).toMatchObject({ tone: "danger", context: null })
    expect(cards({ onboarding: 3, atRisk: 0 }).atRisk).toMatchObject({ tone: "muted", figure: "0", context: null })
  })

  it("mutes a zero onboarding count, and the people cards carry no second line", () => {
    expect(cards({ onboarding: 0, atRisk: 0 }).onboarding).toMatchObject({ tone: "muted", figure: "0", context: null })
    expect(cards({ onboarding: 1, atRisk: 1 }).onboarding.context).toBeNull()
  })

  it("never shows a View affordance on the people cards", () => {
    const { onboarding, atRisk } = cards()
    expect([onboarding.view, atRisk.view]).toEqual([false, false])
  })
})

describe("the Invoices card", () => {
  it("shows the total once, the count, and the overdue part in the danger tone", () => {
    const card = cards(undefined, due({ overdueCents: 12_000_00, overdueCount: 3 })).invoices
    expect(card).toMatchObject({
      label: "Invoices due",
      figure: formatCents(78_168_76),
      tone: "default",
      context: "15 invoices",
      alert: `${formatCents(12_000_00)} overdue`,
      href: CLIENT_FINANCE_PATH,
      view: true,
    })
    expect(card.linkName).toBe(`${formatCents(78_168_76)} Invoices due, 15 invoices, ${formatCents(12_000_00)} overdue, view invoices`)
  })

  it("says all overdue instead of repeating the amount", () => {
    const card = cards(undefined, due({ overdueCents: 78_168_76, overdueCount: 15 })).invoices
    expect(card.alert).toBe("all overdue")
    expect(card.linkName).not.toContain(`${formatCents(78_168_76)} overdue`)
  })

  it("has no alert when nothing is overdue, and words one invoice", () => {
    const card = cards(undefined, due({ count: 1, totalCents: 4_00 })).invoices
    expect(card).toMatchObject({ context: "1 invoice", alert: null, figure: formatCents(4_00) })
  })

  it("is a quiet $0.00 with Nothing due and no View when nothing is payable, still linking to Finance", () => {
    expect(cards(undefined, null).invoices).toMatchObject({
      figure: formatCents(0),
      tone: "muted",
      context: "Nothing due",
      alert: null,
      view: false,
      href: CLIENT_FINANCE_PATH,
    })
  })
})
