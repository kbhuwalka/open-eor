"use client"

import { useCallback, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { cn } from "cn"
import { SlidersHorizontal } from "lucide-react"

import { loadFinanceInvoiceAction, loadFinancePaymentAction } from "@/app/finance/actions"
import { UrlPagination } from "@/components/data-table/url-pagination"
import { useListCursor } from "@/components/dense-list"
import { EmptyState } from "@/components/empty-state"
import { InvoicesTable } from "@/components/finance-portal/invoices-table"
import { FilterChips, RefetchBar, SearchField } from "@/components/finance-portal/list-controls"
import { StaffDrawer } from "@/components/finance-portal/staff-drawer"
import { useFinanceRecords, type RecordLoaders } from "@/components/finance-portal/use-finance-records"
import { useLinkedView } from "@/components/finance-portal/use-linked-view"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Label } from "@/components/ui/label"
import { OptionSelect, type Option } from "@/components/ui/option-select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  CLEARED_INVOICE_FILTERS,
  hasInvoiceFilters,
  INVOICE_STATUS_FILTER_LABEL,
  INVOICE_STATUS_VALUES,
  invoiceFilterChips,
  invoicesSearch,
  moreFilterCount,
  withInvoicesChange,
  withOpenParam,
  type FinanceInvoicesQuery,
} from "@/lib/finance-portal-query"
import { invoicesSummaryText, openView, type StaffInvoiceRow } from "@/lib/finance-staff-view"
import { INVOICE_KIND_LABEL } from "@/lib/finance-view"
import type { InvoiceStatusFilterValue } from "@/server/billing-queries"
import type { FinanceInvoicesPage } from "@/server/finance-lists"

const ALL = "all"

const LOADERS: RecordLoaders = { loadPayment: loadFinancePaymentAction, loadInvoice: loadFinanceInvoiceAction }

const STATUS_OPTIONS: Option[] = INVOICE_STATUS_VALUES.map((value) => ({ value, label: INVOICE_STATUS_FILTER_LABEL[value] }))
const KIND_OPTIONS: Option[] = [
  { value: ALL, label: "All kinds" },
  { value: "payroll", label: INVOICE_KIND_LABEL.payroll },
  { value: "deposit", label: INVOICE_KIND_LABEL.deposit },
]

export type InvoicesScreenProps = {
  data: FinanceInvoicesPage
  query: FinanceInvoicesQuery
  companies: readonly { id: string; name: string }[]
  /** The invoice of `?open=`, loaded by the page whatever the filters; `null` when absent or unknown. */
  linked: StaffInvoiceRow | null
}

/**
 * The Finance Invoices screen (docs/finance-portal.md §2.0, ui-guidelines C30): one row of search,
 * Status, Client and a "More" popover for kind and issue dates, removable chips, the exact summary
 * of what matches, and a C6 table, newest first, whose rows open the one drawer. Void invoices show
 * only under the Void status. All list state is in the URL and paginated on the server; the drawer
 * is not.
 */
export function InvoicesScreen({ data, query, companies, linked }: InvoicesScreenProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const linkedView = linked ? openView("invoice", linked.id, data.ids.includes(linked.id) ? data.ids : [linked.id]) : null
  const [view, setView] = useLinkedView(linkedView)
  const records = useFinanceRecords({ view, payments: [], invoices: linked ? [...data.rows, linked] : data.rows, loaders: LOADERS })
  const [cursor, setCursor] = useState<string | null>(null)

  function go(next: FinanceInvoicesQuery) {
    startTransition(() => router.replace(`/finance/invoices${invoicesSearch(next)}`, { scroll: false }))
  }
  const change = (patch: Partial<FinanceInvoicesQuery>) => go(withInvoicesChange(query, patch))

  const { invalidate } = records
  const refresh = useCallback(() => {
    invalidate()
    router.refresh()
  }, [invalidate, router])

  const search = invoicesSearch(query)
  const openRow = useCallback(
    (id: string) => {
      setCursor(id)
      setView(openView("invoice", id, data.ids))
    },
    [data.ids, setView],
  )
  useListCursor({ ids: data.rows.map((row) => row.id), cursor, onCursor: setCursor, onOpen: openRow, enabled: view === null })

  const companyOptions: Option[] = [{ value: ALL, label: "All clients" }, ...companies.map((c) => ({ value: c.id, label: c.name }))]
  const chips = invoiceFilterChips(query, companies)
  const filtered = hasInvoiceFilters(query)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3" role="search" data-testid="invoice-filters">
        <div className="flex flex-wrap items-center gap-3 lg:flex-nowrap">
          <SearchField
            value={query.q}
            onSearch={(q) => change({ q })}
            placeholder="Search person or invoice number"
            label="Search invoices"
            testId="invoice-search"
          />
          <div className="w-36 shrink-0">
            <OptionSelect
              options={STATUS_OPTIONS}
              value={query.status}
              onValueChange={(value) => change({ status: value as InvoiceStatusFilterValue })}
              data-testid="status-filter"
            />
          </div>
          <div className="w-44 shrink-0">
            <OptionSelect
              options={companyOptions}
              value={query.client ?? ALL}
              onValueChange={(value) => change({ client: value === ALL ? null : value })}
              data-testid="client-filter"
            />
          </div>
          <MoreFilters query={query} onChange={change} />
        </div>
        {filtered ? (
          <FilterChips
            chips={chips.map((chip) => ({ key: chip.key, label: chip.label, remove: { run: () => change(chip.clear) } }))}
            clear={{ run: () => change(CLEARED_INVOICE_FILTERS) }}
          />
        ) : null}
      </div>

      {data.total > 0 ? (
        <p className="text-xs text-muted-foreground tabular-nums" data-testid="invoice-summary">
          {invoicesSummaryText(data.summary)}
        </p>
      ) : null}

      <section aria-label="Invoices" aria-busy={pending} className="relative flex flex-col gap-4" data-testid="invoices-list">
        <RefetchBar pending={pending} testId="invoices-refetching" />
        <div className={cn("transition-opacity", pending && "opacity-60")}>
          {data.total === 0 ? (
            <div data-testid="no-invoices">
              {filtered ? (
                <EmptyState
                  message="No invoices match these filters."
                  action={
                    <Button variant="outline" size="sm" onClick={() => change(CLEARED_INVOICE_FILTERS)}>
                      Clear
                    </Button>
                  }
                />
              ) : (
                <EmptyState message="No invoices yet. Run billing to issue the first ones." />
              )}
            </div>
          ) : (
            <InvoicesTable
              rows={data.rows}
              today={data.today}
              cursor={cursor}
              hrefOf={(id) => `/finance/invoices${withOpenParam(search, id)}`}
              onOpen={openRow}
            />
          )}
        </div>
        <UrlPagination page={data.page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} />
      </section>

      <StaffDrawer view={view} onViewChange={setView} records={records} onChanged={refresh} />
    </div>
  )
}

/** Kind and the issue date range, behind one "More" button that counts what is on. */
function MoreFilters({ query, onChange }: { query: FinanceInvoicesQuery; onChange: (patch: Partial<FinanceInvoicesQuery>) => void }) {
  const count = moreFilterCount(query)
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" className="shrink-0" data-testid="more-filters" />}>
        <SlidersHorizontal data-icon="inline-start" />
        More
        {count > 0 ? <span className="text-muted-foreground tabular-nums">({count})</span> : null}
      </PopoverTrigger>
      <PopoverContent className="flex w-80 flex-col gap-4" aria-label="More filters" data-testid="more-filters-popover">
        <div className="flex flex-col gap-2">
          <Label>Kind</Label>
          <OptionSelect
            options={KIND_OPTIONS}
            value={query.kind ?? ALL}
            onValueChange={(value) => onChange({ kind: value === ALL ? null : (value as "payroll" | "deposit") })}
            data-testid="kind-filter"
          />
        </div>
        <div className="flex flex-col gap-2" role="group" aria-label="Issue date range">
          <Label>Issued</Label>
          <div className="grid grid-cols-2 gap-2">
            <DatePicker
              value={query.from ?? ""}
              max={query.to ?? undefined}
              placeholder="From"
              onValueChange={(value) => onChange({ from: value || null })}
              data-testid="from-filter"
            />
            <DatePicker
              value={query.to ?? ""}
              min={query.from ?? undefined}
              placeholder="To"
              onValueChange={(value) => onChange({ to: value || null })}
              data-testid="to-filter"
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
