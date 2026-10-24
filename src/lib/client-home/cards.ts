/**
 * The three glance cards at the top of the client Home (ui-guidelines C28): Onboarding, At risk and
 * Invoices due. Pure: the server passes the people counts (`peopleCounts`, the same people the
 * People list shows under `status=onboarding` and `atRisk=1`) and the invoice total
 * (`invoicesToPay`); this decides each card's figure, wording, tone and where it links.
 */
import { CLIENT_FINANCE_PATH, CLIENT_PEOPLE_PATH } from "@/lib/client-nav"
import { formatCents } from "@/lib/format"
import { DEFAULT_PEOPLE_QUERY, peopleSearch, type PeopleQuery } from "@/lib/people-query"

import type { InvoicesToPay } from "./invoices"

export type GlanceCardId = "onboarding" | "at-risk" | "invoices"

export type GlanceCard = {
  id: GlanceCardId
  /** "Onboarding", "At risk", "Invoices due". */
  label: string
  /** The one large figure: a count, or exact dollars and cents. */
  figure: string
  /** `danger` only for an at-risk count above zero; `muted` for a figure that is zero. */
  tone: "default" | "danger" | "muted"
  /** The muted line under the figure, only where the figure alone is not enough: the Invoices card's "15 invoices". */
  context: string | null
  /** Said after the context in the danger tone: "$1,200.00 overdue", "all overdue". */
  alert: string | null
  href: string
  /** The link's accessible name: the figure and label first, then the alert and where it goes. */
  linkName: string
  /** Shows the outline "View" affordance: only the Invoices card, only while something is due. */
  view: boolean
}

export type GlanceCardsInput = {
  people: { onboarding: number; atRisk: number }
  /** Null when nothing is payable beyond what To do asks for. */
  invoices: InvoicesToPay | null
}

const peopleHref = (patch: Partial<PeopleQuery>) => `${CLIENT_PEOPLE_PATH}${peopleSearch({ ...DEFAULT_PEOPLE_QUERY, ...patch })}`

/** `/client/people?status=onboarding`: the people the Onboarding card counts. */
export const ONBOARDING_PEOPLE_HREF = peopleHref({ status: "onboarding" })
/** `/client/people?atRisk=1`: the people the At risk card counts. */
export const AT_RISK_PEOPLE_HREF = peopleHref({ atRisk: true })

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

function onboardingCard(n: number): GlanceCard {
  return {
    id: "onboarding",
    label: "Onboarding",
    figure: String(n),
    tone: n > 0 ? "default" : "muted",
    context: null,
    alert: null,
    href: ONBOARDING_PEOPLE_HREF,
    linkName: `${n} Onboarding, view people`,
    view: false,
  }
}

function atRiskCard(n: number): GlanceCard {
  return {
    id: "at-risk",
    label: "At risk",
    figure: String(n),
    tone: n > 0 ? "danger" : "muted",
    context: null,
    alert: null,
    href: AT_RISK_PEOPLE_HREF,
    linkName: `${n} At risk, view people`,
    view: false,
  }
}

/**
 * The money once, exactly. When nothing is due the card still links to Finance (its payment
 * history), quietly: a muted "$0.00", "Nothing due" and no View affordance. The people cards carry no second line: a label above and a figure are all they say.
 */
function invoicesCard(toPay: InvoicesToPay | null): GlanceCard {
  if (!toPay) {
    return {
      id: "invoices",
      label: "Invoices due",
      figure: formatCents(0),
      tone: "muted",
      context: "Nothing due",
      alert: null,
      href: CLIENT_FINANCE_PATH,
      linkName: `${formatCents(0)} Invoices due, nothing due, view Finance`,
      view: false,
    }
  }
  const alert =
    toPay.overdueCount === 0 ? null : toPay.overdueCount === toPay.count ? "all overdue" : `${formatCents(toPay.overdueCents)} overdue`
  const context = count(toPay.count, "invoice", "invoices")
  const figure = formatCents(toPay.totalCents)
  return {
    id: "invoices",
    label: "Invoices due",
    figure,
    tone: "default",
    context,
    alert,
    href: CLIENT_FINANCE_PATH,
    linkName: [`${figure} Invoices due`, context, alert, "view invoices"].filter(Boolean).join(", "),
    view: true,
  }
}

/** The cards in page order: Onboarding, At risk, Invoices due. */
export function glanceCards({ people, invoices }: GlanceCardsInput): GlanceCard[] {
  return [onboardingCard(people.onboarding), atRiskCard(people.atRisk), invoicesCard(invoices)]
}
