import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { glanceCards, type GlanceCardsInput } from "@/lib/client-home"
import { formatCents } from "@/lib/format"

import { GlanceCards } from "../glance-cards"

afterEach(cleanup)

const renderCards = (input: Partial<GlanceCardsInput> = {}) =>
  render(<GlanceCards cards={glanceCards({ people: { onboarding: 36, atRisk: 2 }, invoices: null, ...input })} />)

const card = (id: string) => screen.getAllByTestId("glance-card").find((element) => element.dataset.card === id)!

describe("GlanceCards", () => {
  it("makes each card one link named with its figure and label", () => {
    renderCards()
    const links = screen.getAllByRole("link")
    expect(links).toHaveLength(3)
    expect(screen.getByRole("link", { name: "36 Onboarding, view people" })).toHaveAttribute("href", "/client/people?status=onboarding")
    expect(screen.getByRole("link", { name: "2 At risk, view people" })).toHaveAttribute("href", "/client/people?atRisk=1")
    expect(within(card("onboarding")).getByTestId("glance-figure")).toHaveTextContent("36")
    expect(within(card("onboarding")).queryByTestId("glance-context")).not.toBeInTheDocument()
    expect(within(card("at-risk")).queryByTestId("glance-context")).not.toBeInTheDocument()
    expect(card("at-risk")).not.toHaveTextContent("start dates at risk")
  })

  it("shows the money once, with the count and the overdue part, and a View that is part of the card's link", () => {
    renderCards({ invoices: { count: 15, totalCents: 78_168_76, overdueCents: 9_000_00, overdueCount: 2 } })
    const invoices = card("invoices")
    expect(within(invoices).getByTestId("glance-figure")).toHaveTextContent(formatCents(78_168_76))
    expect(invoices.textContent?.split(formatCents(78_168_76))).toHaveLength(2)
    expect(within(invoices).getByTestId("glance-context")).toHaveTextContent(`15 invoices · ${formatCents(9_000_00)} overdue`)
    const link = within(invoices).getByRole("link")
    expect(link).toHaveAttribute("href", "/client/finance")
    expect(link).toHaveAccessibleName(`${formatCents(78_168_76)} Invoices due, 15 invoices, ${formatCents(9_000_00)} overdue, view invoices`)
    expect(within(invoices).getByTestId("glance-view")).toHaveTextContent("View")
    expect(within(invoices).queryByRole("button")).not.toBeInTheDocument()
    expect(link).not.toContainElement(within(invoices).getByTestId("glance-view"))
  })

  it("says all overdue when everything is", () => {
    renderCards({ invoices: { count: 3, totalCents: 300_00, overdueCents: 300_00, overdueCount: 3 } })
    expect(within(card("invoices")).getByTestId("glance-context")).toHaveTextContent("3 invoices · all overdue")
  })

  it("shows $0.00 and Nothing due without a View when nothing is payable", () => {
    renderCards({ invoices: null })
    const invoices = card("invoices")
    expect(within(invoices).getByTestId("glance-figure")).toHaveTextContent(formatCents(0))
    expect(invoices).toHaveTextContent("Nothing due")
    expect(within(invoices).queryByTestId("glance-view")).not.toBeInTheDocument()
    expect(within(invoices).getByRole("link")).toHaveAttribute("href", "/client/finance")
  })

  it("shows a muted zero at zero, with no second line", () => {
    renderCards({ people: { onboarding: 4, atRisk: 0 } })
    expect(within(card("at-risk")).getByTestId("glance-figure")).toHaveTextContent("0")
    expect(within(card("at-risk")).queryByTestId("glance-context")).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "0 At risk, view people" })).toBeInTheDocument()
  })
})
