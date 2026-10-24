/**
 * URL state of the Finance portal lists. Parsing never throws: anything unrecognised falls back to
 * the default, and the serialiser leaves defaults out so the plain list URL stays clean.
 */
import type { InvoiceSortKey, InvoiceStatusFilterValue } from "@/server/billing-queries"

import { DEFAULT_PAGE_SIZE, isPageSize, type PageSize } from "./pagination"

type RawParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

function validDay(value: string | undefined): string | null {
  if (!value || !DAY.test(value)) return null
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value
}

function positiveInt(value: string | undefined): number {
  const n = Number.parseInt(value ?? "", 10)
  return Number.isFinite(n) && n > 1 ? n : 1
}

export type SortDir = "asc" | "desc"

/** Mirrors the server's lists (type-checked), so client components never import the server module. */
export const INVOICE_STATUS_VALUES = ["all", "due", "overdue", "processing", "paid", "void"] as const satisfies readonly InvoiceStatusFilterValue[]
export const INVOICE_SORT_VALUES = ["issueDate", "dueDate", "number", "person", "total", "status"] as const satisfies readonly InvoiceSortKey[]

export type FinanceInvoicesQuery = {
  q: string
  status: InvoiceStatusFilterValue
  kind: "payroll" | "deposit" | null
  /** Company id. */
  company: string | null
  /** Issue date range, `YYYY-MM-DD`, inclusive. */
  from: string | null
  to: string | null
  /** `null` is the default order: newest issue date first. */
  sort: InvoiceSortKey | null
  dir: SortDir
  page: number
  size: PageSize
}

export const DEFAULT_INVOICES_QUERY: FinanceInvoicesQuery = {
  q: "",
  status: "all",
  kind: null,
  company: null,
  from: null,
  to: null,
  sort: null,
  dir: "desc",
  page: 1,
  size: DEFAULT_PAGE_SIZE,
}

export function parseInvoicesQuery(params: RawParams): FinanceInvoicesQuery {
  const status = first(params.status)
  const kind = first(params.kind)
  const company = first(params.company)
  const sort = first(params.sort)
  const size = Number.parseInt(first(params.size) ?? "", 10)
  const from = validDay(first(params.from))
  const to = validDay(first(params.to))
  return {
    q: (first(params.q) ?? "").trim().slice(0, 100),
    status: (INVOICE_STATUS_VALUES as readonly string[]).includes(status ?? "")
      ? (status as InvoiceStatusFilterValue)
      : "all",
    kind: kind === "payroll" || kind === "deposit" ? kind : null,
    company: company && /^[\w-]{1,64}$/.test(company) ? company : null,
    from,
    to: from && to && to < from ? from : to,
    sort: (INVOICE_SORT_VALUES as readonly string[]).includes(sort ?? "") ? (sort as InvoiceSortKey) : null,
    dir: first(params.dir) === "asc" ? "asc" : "desc",
    page: positiveInt(first(params.page)),
    size: isPageSize(size) ? size : DEFAULT_PAGE_SIZE,
  }
}

export function invoicesSearch(query: FinanceInvoicesQuery): string {
  const p = new URLSearchParams()
  if (query.q) p.set("q", query.q)
  if (query.status !== "all") p.set("status", query.status)
  if (query.kind) p.set("kind", query.kind)
  if (query.company) p.set("company", query.company)
  if (query.from) p.set("from", query.from)
  if (query.to) p.set("to", query.to)
  if (query.sort) {
    p.set("sort", query.sort)
    p.set("dir", query.dir)
  }
  if (query.page > 1) p.set("page", String(query.page))
  if (query.size !== DEFAULT_PAGE_SIZE) p.set("size", String(query.size))
  const text = p.toString()
  return text ? `?${text}` : ""
}

/** A change resets to page 1 unless it is itself a page change. */
export function withInvoicesChange(query: FinanceInvoicesQuery, change: Partial<FinanceInvoicesQuery>): FinanceInvoicesQuery {
  const next = { ...query, ...change }
  return "page" in change ? next : { ...next, page: 1 }
}

export function hasInvoiceFilters(query: FinanceInvoicesQuery): boolean {
  return Boolean(query.q || query.status !== "all" || query.kind || query.company || query.from || query.to)
}

/** none → asc → desc → none (C6); the first click on a column sorts ascending. */
export function cycleInvoiceSort(query: FinanceInvoicesQuery, key: InvoiceSortKey): Pick<FinanceInvoicesQuery, "sort" | "dir"> {
  if (query.sort !== key) return { sort: key, dir: "asc" }
  if (query.dir === "asc") return { sort: key, dir: "desc" }
  return { sort: null, dir: "desc" }
}

export const PAYMENT_TABS = ["initiated", "settled", "failed"] as const
export type PaymentTab = (typeof PAYMENT_TABS)[number]

export type FinancePaymentsQuery = { tab: PaymentTab; page: number; size: PageSize }

export function parsePaymentsQuery(params: RawParams): FinancePaymentsQuery {
  const tab = first(params.tab)
  const size = Number.parseInt(first(params.size) ?? "", 10)
  return {
    tab: (PAYMENT_TABS as readonly string[]).includes(tab ?? "") ? (tab as PaymentTab) : "initiated",
    page: positiveInt(first(params.page)),
    size: isPageSize(size) ? size : DEFAULT_PAGE_SIZE,
  }
}

export function paymentsSearch(query: FinancePaymentsQuery): string {
  const p = new URLSearchParams()
  if (query.tab !== "initiated") p.set("tab", query.tab)
  if (query.page > 1) p.set("page", String(query.page))
  if (query.size !== DEFAULT_PAGE_SIZE) p.set("size", String(query.size))
  const text = p.toString()
  return text ? `?${text}` : ""
}

/** The domain's payment status behind each tab (`settled` is `succeeded` in the database). */
export const PAYMENT_TAB_STATUS = { initiated: "initiated", settled: "succeeded", failed: "failed" } as const
