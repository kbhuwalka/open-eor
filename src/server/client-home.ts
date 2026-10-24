/**
 * Read model of the client Home (`/client`, ui-guidelines C28): the glance cards and To do in one
 * load. The wording, the grouping and the invoice arithmetic are the pure functions in
 * `src/lib/client-home/`; this module only loads and scopes.
 *
 * ACL (acl.md §4, I4, I6, I7): everything comes from the session user passed in. "To do" is the
 * user's own inbox (`attentionFor`), and the start dates its rows show are read only for cases of
 * the user's company. The Onboarding and At risk counts are `peopleCounts` for the user's company,
 * the same scope `listPeople` gives the People list, and the invoices go through
 * `FinanceDataSource`, which is scoped by the same company id. Nothing from a task's payload or
 * result leaves this module beyond what the To do rows already carry.
 */
import { and, eq, inArray } from "drizzle-orm"

import type { SessionUser } from "@/auth"
import type { AppDatabase } from "@/db/client"
import { hireRequests, onboardingCases } from "@/db/schema"
import { clientTodoView, invoicesToPay, type ClientTodoView, type InvoicesToPay } from "@/lib/client-home"

import type { FinanceDataSource } from "./finance-queries"
import { peopleCounts, type PeopleCounts } from "./queries"
import { attentionFor } from "./task-inbox"

type Viewer = Pick<SessionUser, "id" | "role" | "clientCompanyId">

/** The company a client user acts for; null for any other role or a client without one. */
function companyOf(user: Viewer): string | null {
  return user.role === "client_hr" && user.clientCompanyId ? user.clientCompanyId : null
}

/** Start dates of the hires behind `caseIds`, only for cases of `companyId`. */
function startDatesOf(db: AppDatabase, companyId: string, caseIds: readonly string[]): Map<string, string | null> {
  if (caseIds.length === 0) return new Map()
  const rows = db
    .select({ caseId: onboardingCases.id, startDate: hireRequests.startDate })
    .from(onboardingCases)
    .innerJoin(hireRequests, eq(hireRequests.id, onboardingCases.hireRequestId))
    .where(and(eq(hireRequests.clientCompanyId, companyId), inArray(onboardingCases.id, [...new Set(caseIds)])))
    .all()
  return new Map(rows.map((row) => [row.caseId, row.startDate]))
}

export type ClientHomeData = {
  todo: ClientTodoView
  people: PeopleCounts
  /** Null when the company has nothing to pay beyond what To do asks for. */
  invoices: InvoicesToPay | null
}

export type ClientHomeDeps = { db: AppDatabase; finance: FinanceDataSource }

/** Everything the Home shows for `user`. The Invoices card leaves out what a To do row already pays. */
export async function loadClientHome({ db, finance }: ClientHomeDeps, user: Viewer, now: Date = new Date()): Promise<ClientHomeData> {
  const { rows, total } = attentionFor(db, user, now)
  const companyId = companyOf(user)
  if (!companyId) {
    return { todo: clientTodoView(rows, total), people: { onboarding: 0, atRisk: 0 }, invoices: null }
  }
  const invoices = await finance.listClientInvoices(companyId)
  const startDates = startDatesOf(
    db,
    companyId,
    rows.map((row) => row.caseId),
  )
  return {
    todo: clientTodoView(rows, total, startDates),
    people: peopleCounts(db, companyId, now),
    invoices: invoicesToPay(invoices, rows),
  }
}
