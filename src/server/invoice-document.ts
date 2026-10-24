/**
 * Loads one invoice with everything the invoice document prints (docs/client-finance.md §2b): the
 * invoice and its lines as stored, who it is for (legal name, job title, work state, start date,
 * last day), the billed company, its payments and the void reason.
 *
 * The client invoice drawer, the client PDF and the Finance portal all read through here, so they
 * print the same facts and the same totals.
 *
 * ACCESS: this module only scopes the read; it does not check who is asking. `scope.companyId` is
 * the session's client company for a client (an invoice of another company is then `null`, the
 * same as one that does not exist), and `null` ONLY for a caller that has just passed
 * `requireRole("finance")`. Never pass a company id taken from a request.
 */

import { and, desc, eq } from "drizzle-orm"

import type { AppDatabase } from "@/db"
import {
  clientCompanies,
  formSubmissions,
  hireRequests,
  invoices,
  onboardingCases,
  roles,
  users,
} from "@/db"
import { employmentEndDate } from "@/domain/billing"
import type { Invoice, Payment } from "@/domain/billing"
import { businessDayOf } from "@/domain/business-time"
import {
  toInvoiceDetail,
  type InvoiceDetail,
  type InvoicePartyView,
  type InvoicePersonView,
} from "@/lib/finance-view"
import { stateName } from "@/lib/us-states"
import { NORTHWIND_ENTITY } from "@/server/documents/agreement-template"
import type { InvoicePdfInput } from "@/server/documents/invoice-pdf"

import { lastWorkingDayOf, loadInvoice, loadPaymentsForInvoices } from "./billing-core"

type Reader = Pick<AppDatabase, "select" | "selectDistinct">

export type InvoiceDocumentScope = {
  /** The client company to restrict to; `null` only after a Finance role check. */
  companyId: string | null
}

export type InvoiceDocumentSource = {
  invoice: Invoice
  caseId: string
  /** The person's account name (what lists show). */
  accountName: string
  person: InvoicePersonView
  issuer: InvoicePartyView
  client: InvoicePartyView
  /** Payments touching the invoice, whole (all their allocations). */
  payments: Payment[]
  /** The stored reason when the invoice is void. */
  voidReason: string | null
}

export const NORTHWIND_PARTY: InvoicePartyView = {
  name: NORTHWIND_ENTITY.legalName,
  addressLines: [NORTHWIND_ENTITY.address],
}

function legalNameOf(db: Reader, caseId: string): string | null {
  const saved = db
    .select({ dataJson: formSubmissions.dataJson })
    .from(formSubmissions)
    .where(and(eq(formSubmissions.caseId, caseId), eq(formSubmissions.formType, "personal_details")))
    .orderBy(desc(formSubmissions.createdAt))
    .get()
  if (!saved) return null
  try {
    const name = (JSON.parse(saved.dataJson) as { legalName?: unknown }).legalName
    return typeof name === "string" && name.trim() !== "" ? name.trim() : null
  } catch {
    return null
  }
}

export function loadInvoiceDocumentSource(
  db: Reader,
  invoiceId: string,
  scope: InvoiceDocumentScope,
): InvoiceDocumentSource | null {
  if (invoiceId === "") return null
  const conditions = [eq(invoices.id, invoiceId)]
  if (scope.companyId !== null) conditions.push(eq(invoices.companyId, scope.companyId))
  const entry = db
    .select({
      invoice: invoices,
      caseId: onboardingCases.id,
      lifecycle: onboardingCases.lifecycle,
      accountName: users.displayName,
      companyName: clientCompanies.name,
      title: roles.name,
      stateCode: hireRequests.stateCode,
      termEndDate: hireRequests.endDate,
    })
    .from(invoices)
    .innerJoin(hireRequests, eq(hireRequests.id, invoices.hireId))
    .innerJoin(onboardingCases, eq(onboardingCases.hireRequestId, invoices.hireId))
    .innerJoin(users, eq(users.id, onboardingCases.workerUserId))
    .innerJoin(clientCompanies, eq(clientCompanies.id, invoices.companyId))
    .leftJoin(roles, eq(roles.id, hireRequests.roleId))
    .where(and(...conditions))
    .get()
  if (!entry) return null
  const invoice = loadInvoice(db, invoiceId)
  if (!invoice) return null

  const lastWorkingDay = lastWorkingDayOf(db, entry.caseId, entry.lifecycle)
  const endDate = employmentEndDate({ termEndDate: entry.termEndDate, lastWorkingDay })
  return {
    invoice,
    caseId: entry.caseId,
    accountName: entry.accountName,
    person: {
      name: legalNameOf(db, entry.caseId) ?? entry.accountName,
      title: entry.title ?? null,
      workState: entry.stateCode ? stateName(entry.stateCode) : null,
      endDate,
      endKind: endDate === null ? null : lastWorkingDay !== null && lastWorkingDay === endDate ? "terminated" : "fixed_term",
    },
    issuer: NORTHWIND_PARTY,
    // Companies store no postal address yet; the block prints the name alone.
    client: { name: entry.companyName, addressLines: [] },
    payments: loadPaymentsForInvoices(db, [invoiceId]),
    voidReason: entry.invoice.voidReason,
  }
}

export function invoiceDetailFromSource(source: InvoiceDocumentSource, now: Date): InvoiceDetail {
  return toInvoiceDetail({
    invoice: source.invoice,
    payments: source.payments,
    today: businessDayOf(now),
    personName: source.accountName,
    personTitle: source.person.title,
    caseId: source.caseId,
    context: {
      issuer: source.issuer,
      client: source.client,
      person: source.person,
      voidReason: source.voidReason,
    },
  })
}

/** The full invoice view for the drawer and `InvoiceDocument`. `null` when out of scope. */
export function loadInvoiceDocument(
  db: Reader,
  invoiceId: string,
  scope: InvoiceDocumentScope,
  now: Date = new Date(),
): InvoiceDetail | null {
  const source = loadInvoiceDocumentSource(db, invoiceId, scope)
  return source ? invoiceDetailFromSource(source, now) : null
}

/** What `generateInvoicePdf` needs, from the same source as the page. */
export function invoicePdfInputFromSource(source: InvoiceDocumentSource, now: Date): InvoicePdfInput {
  const { person } = source
  return {
    invoice: source.invoice,
    client: source.client,
    person: {
      name: person.name,
      ...(person.title ? { roleTitle: person.title } : {}),
      ...(person.workState ? { workState: person.workState } : {}),
      ...(person.endDate && person.endKind ? { endDate: person.endDate, endKind: person.endKind } : {}),
    },
    payments: source.payments,
    ...(source.voidReason !== null ? { voidReason: source.voidReason } : {}),
    today: businessDayOf(now),
    now,
  }
}
