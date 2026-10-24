/**
 * URL state of the Finance portal lists. Parsing never throws: anything unrecognised falls back to
 * the default, and the serialiser leaves defaults out so the plain list URL stays clean. Which
 * record the drawer shows (`?open=`) is read separately (`parseOpenParam`) and never kept here, so
 * changing a filter never reopens a drawer.
 */
import type { InvoiceStatusFilterValue } from "@/server/billing-queries"

import { formatIsoDay } from "./finance-format"
import { INVOICE_KIND_LABEL } from "./finance-view"
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

function sizeOf(value: string | undefined): PageSize {
  const n = Number.parseInt(value ?? "", 10)
  return isPageSize(n) ? n : DEFAULT_PAGE_SIZE
}

const searchText = (value: string | undefined) => (value ?? "").trim().slice(0, 100)

const companyId = (value: string | undefined) => (value && /^[\w-]{1,64}$/.test(value) ? value : null)

function serialise(p: URLSearchParams): string {
  const text = p.toString()
  return text ? `?${text}` : ""
}

/** `search` (a list URL's query, with or without `?`) plus `open=<id>`: the href of a row that opens the drawer. */
export function withOpenParam(search: string, id: string): string {
  const p = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
  p.set("open", id)
  return `?${p.toString()}`
}

// ── Invoices ────────────────────────────────────────────────────────

/** Mirrors the server's list (type-checked), so client components never import the server module. */
export const INVOICE_STATUS_VALUES = ["all", "due", "overdue", "processing", "paid", "void"] as const satisfies readonly InvoiceStatusFilterValue[]

export const INVOICE_STATUS_FILTER_LABEL: Record<InvoiceStatusFilterValue, string> = {
  all: "All statuses",
  due: "Unpaid",
  overdue: "Overdue",
  processing: "Processing",
  paid: "Paid",
  void: "Void",
}

/**
 * The Invoices list has one fixed order (newest issue first, `financeInvoicesPage`) and no sort
 * parameter: an old `?sort=` is ignored and never written back.
 */
export type FinanceInvoicesQuery = {
  q: string
  /** `all` hides void invoices; `void` is the only way to list them. */
  status: InvoiceStatusFilterValue
  kind: "payroll" | "deposit" | null
  /** Company id. */
  client: string | null
  /** Issue date range, `YYYY-MM-DD`, inclusive. */
  from: string | null
  to: string | null
  page: number
  size: PageSize
}

export const DEFAULT_INVOICES_QUERY: FinanceInvoicesQuery = {
  q: "",
  status: "all",
  kind: null,
  client: null,
  from: null,
  to: null,
  page: 1,
  size: DEFAULT_PAGE_SIZE,
}

/** `company` is read as `client` (old links written as `?company=<id>&status=due`); only `client` is written. */
export function parseInvoicesQuery(params: RawParams): FinanceInvoicesQuery {
  const status = first(params.status)
  const kind = first(params.kind)
  const from = validDay(first(params.from))
  const to = validDay(first(params.to))
  return {
    q: searchText(first(params.q)),
    status: (INVOICE_STATUS_VALUES as readonly string[]).includes(status ?? "") ? (status as InvoiceStatusFilterValue) : "all",
    kind: kind === "payroll" || kind === "deposit" ? kind : null,
    client: companyId(first(params.client)) ?? companyId(first(params.company)),
    from,
    to: from && to && to < from ? from : to,
    page: positiveInt(first(params.page)),
    size: sizeOf(first(params.size)),
  }
}

export function invoicesSearch(query: FinanceInvoicesQuery): string {
  const p = new URLSearchParams()
  if (query.q) p.set("q", query.q)
  if (query.status !== "all") p.set("status", query.status)
  if (query.kind) p.set("kind", query.kind)
  if (query.client) p.set("client", query.client)
  if (query.from) p.set("from", query.from)
  if (query.to) p.set("to", query.to)
  if (query.page > 1) p.set("page", String(query.page))
  if (query.size !== DEFAULT_PAGE_SIZE) p.set("size", String(query.size))
  return serialise(p)
}

/** A change resets to page 1 unless it is itself a page change. */
export function withInvoicesChange(query: FinanceInvoicesQuery, change: Partial<FinanceInvoicesQuery>): FinanceInvoicesQuery {
  const next = { ...query, ...change }
  return "page" in change ? next : { ...next, page: 1 }
}

export const CLEARED_INVOICE_FILTERS = { q: "", status: "all", kind: null, client: null, from: null, to: null } as const satisfies Partial<FinanceInvoicesQuery>

export function hasInvoiceFilters(query: FinanceInvoicesQuery): boolean {
  return Boolean(query.q || query.status !== "all" || query.kind || query.client || query.from || query.to)
}

/** How many of the "More" popover's filters (kind, issue dates) are on, for its trigger. */
export function moreFilterCount(query: FinanceInvoicesQuery): number {
  return (query.kind ? 1 : 0) + (query.from || query.to ? 1 : 0)
}

export type FilterChip = { key: string; label: string; clear: Partial<FinanceInvoicesQuery> }

/**
 * One removable chip per active filter, in the order of the controls. The search text has none:
 * the search field already shows it.
 */
export function invoiceFilterChips(query: FinanceInvoicesQuery, companies: readonly { id: string; name: string }[]): FilterChip[] {
  const chips: FilterChip[] = []
  if (query.status !== "all") chips.push({ key: "status", label: INVOICE_STATUS_FILTER_LABEL[query.status], clear: { status: "all" } })
  if (query.client) {
    const name = companies.find((company) => company.id === query.client)?.name ?? "Unknown client"
    chips.push({ key: "client", label: name, clear: { client: null } })
  }
  if (query.kind) chips.push({ key: "kind", label: INVOICE_KIND_LABEL[query.kind], clear: { kind: null } })
  if (query.from || query.to) {
    const label =
      query.from && query.to
        ? `Issued ${formatIsoDay(query.from)} to ${formatIsoDay(query.to)}`
        : query.from
          ? `Issued from ${formatIsoDay(query.from)}`
          : `Issued until ${formatIsoDay(query.to as string)}`
    chips.push({ key: "issued", label, clear: { from: null, to: null } })
  }
  return chips
}

// ── Payments ────────────────────────────────────────────────────────

export const PAYMENT_TABS = ["to_settle", "settled", "failed"] as const
export type PaymentTab = (typeof PAYMENT_TABS)[number]

export const PAYMENT_TAB_LABEL: Record<PaymentTab, string> = { to_settle: "To settle", settled: "Settled", failed: "Failed" }

/** The domain's payment status behind each tab (`settled` is `succeeded` in the database). */
export const PAYMENT_TAB_STATUS = { to_settle: "initiated", settled: "succeeded", failed: "failed" } as const satisfies Record<PaymentTab, string>

export type FinancePaymentsQuery = {
  tab: PaymentTab
  /** Client name or invoice number. */
  q: string
  /** Company id. */
  client: string | null
  page: number
  size: PageSize
}

export const DEFAULT_PAYMENTS_QUERY: FinancePaymentsQuery = { tab: "to_settle", q: "", client: null, page: 1, size: DEFAULT_PAGE_SIZE }

export function parsePaymentsQuery(params: RawParams): FinancePaymentsQuery {
  const tab = first(params.tab)
  return {
    tab: (PAYMENT_TABS as readonly string[]).includes(tab ?? "") ? (tab as PaymentTab) : "to_settle",
    q: searchText(first(params.q)),
    client: companyId(first(params.client)),
    page: positiveInt(first(params.page)),
    size: sizeOf(first(params.size)),
  }
}

export function paymentsSearch(query: FinancePaymentsQuery): string {
  const p = new URLSearchParams()
  if (query.tab !== "to_settle") p.set("tab", query.tab)
  if (query.q) p.set("q", query.q)
  if (query.client) p.set("client", query.client)
  if (query.page > 1) p.set("page", String(query.page))
  if (query.size !== DEFAULT_PAGE_SIZE) p.set("size", String(query.size))
  return serialise(p)
}

/** A change resets to page 1 unless it is itself a page change. */
export function withPaymentsChange(query: FinancePaymentsQuery, change: Partial<FinancePaymentsQuery>): FinancePaymentsQuery {
  const next = { ...query, ...change }
  return "page" in change ? next : { ...next, page: 1 }
}

export function hasPaymentFilters(query: FinancePaymentsQuery): boolean {
  return Boolean(query.q || query.client)
}
