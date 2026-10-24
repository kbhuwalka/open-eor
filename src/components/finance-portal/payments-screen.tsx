"use client"

import { useCallback, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { cn } from "cn"
import { X } from "lucide-react"

import { loadFinanceInvoiceAction, loadFinancePaymentAction, type BulkSettleResult } from "@/app/finance/actions"
import { UrlPagination } from "@/components/data-table/url-pagination"
import { DenseRow, DenseSection, RowOpener, useListCursor } from "@/components/dense-list"
import { EmptyState } from "@/components/empty-state"
import { RefetchBar, SearchField } from "@/components/finance-portal/list-controls"
import { BulkSettleDialog, PaymentRowMenu, SettleDialog, settleTargetOf } from "@/components/finance-portal/payment-actions"
import { StaffDrawer } from "@/components/finance-portal/staff-drawer"
import { useFinanceRecords, type RecordLoaders } from "@/components/finance-portal/use-finance-records"
import { useLinkedView } from "@/components/finance-portal/use-linked-view"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { OptionSelect, type Option } from "@/components/ui/option-select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatIsoShortDay } from "@/lib/finance-format"
import {
  hasPaymentFilters,
  PAYMENT_TABS,
  PAYMENT_TAB_LABEL,
  paymentsSearch,
  withOpenParam,
  withPaymentsChange,
  type FinancePaymentsQuery,
  type PaymentTab,
} from "@/lib/finance-portal-query"
import { formatWholeDollars, plural, settleWait } from "@/lib/finance-portal-view"
import { openView, paymentRowDetail, settledSections, type StaffPaymentRow } from "@/lib/finance-staff-view"
import { formatCents } from "@/lib/format"
import type { FinancePaymentRecord, FinancePaymentsPage } from "@/server/finance-lists"

const ALL = "all"

const LOADERS: RecordLoaders = { loadPayment: loadFinancePaymentAction, loadInvoice: loadFinanceInvoiceAction }

const EMPTY: Record<PaymentTab, string> = {
  to_settle: "Nothing to settle. Payments clients start wait here until you settle them or mark them failed.",
  settled: "No settled payments yet. Payments you settle are listed here by the month they settled.",
  failed: "No failed payments. Payments you mark failed are listed here with their reason.",
}

export type PaymentsScreenProps = {
  data: FinancePaymentsPage
  query: FinancePaymentsQuery
  companies: readonly { id: string; name: string }[]
  /** The record of `?open=`, loaded by the page whichever tab lists it; `null` when absent or unknown. */
  linked: FinancePaymentRecord | null
}

type BulkOutcome = { settledCount: number; settledCents: number; failed: BulkSettleResult["failed"] }

/**
 * The Finance Payments screen (docs/finance-portal.md §2.0, ui-guidelines C30): To settle, Settled
 * and Failed tabs; one search and a Client filter; C43 dense rows that open the one drawer; Settle on
 * each To settle row and in bulk. All list state is in the URL; the drawer is not.
 */
export function PaymentsScreen({ data, query, companies, linked }: PaymentsScreenProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const linkedView = linked ? openView("payment", linked.payment.id, data.ids.includes(linked.payment.id) ? data.ids : [linked.payment.id]) : null
  const [view, setView] = useLinkedView(linkedView, query.tab === "to_settle" ? {} : { tab: query.tab })
  const records = useFinanceRecords({
    view,
    payments: linked ? [...data.rows, linked.payment] : data.rows,
    invoices: linked ? [...data.invoices, ...linked.invoices] : data.invoices,
    loaders: LOADERS,
  })
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [settling, setSettling] = useState<StaffPaymentRow | null>(null)
  const [bulk, setBulk] = useState(false)
  const [outcome, setOutcome] = useState<BulkOutcome | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [pageKey, setPageKey] = useState(`${query.tab}:${data.page}:${query.q}:${query.client}`)
  const currentKey = `${query.tab}:${data.page}:${query.q}:${query.client}`
  if (pageKey !== currentKey) {
    setPageKey(currentKey)
    setSelected(new Set())
  }

  function go(next: FinancePaymentsQuery) {
    setOutcome(null)
    startTransition(() => router.replace(`/finance/payments${paymentsSearch(next)}`, { scroll: false }))
  }

  const { invalidate } = records
  const refresh = useCallback(() => {
    invalidate()
    router.refresh()
  }, [invalidate, router])

  const search = paymentsSearch(query)
  const rowHref = (id: string) => `/finance/payments${withOpenParam(search, id)}`
  const openRow = useCallback(
    (id: string, intent?: "fail") => {
      setCursor(id)
      setView(openView("payment", id, data.ids, intent))
    },
    [data.ids, setView],
  )
  useListCursor({ ids: data.rows.map((row) => row.id), cursor, onCursor: setCursor, onOpen: openRow, enabled: view === null })

  const toSettle = query.tab === "to_settle"
  const chosen = data.rows.filter((row) => selected.has(row.id))
  const chosenCents = chosen.reduce((total, row) => total + row.amountCents, 0)
  const companyOptions: Option[] = [{ value: ALL, label: "All clients" }, ...companies.map((c) => ({ value: c.id, label: c.name }))]

  function toggle(id: string, checked: boolean) {
    const next = new Set(selected)
    if (checked) next.add(id)
    else next.delete(id)
    setSelected(next)
    setOutcome(null)
  }

  function bulkDone(result: BulkSettleResult) {
    const settled = new Set(result.settled)
    setOutcome({
      settledCount: result.settled.length,
      settledCents: chosen.filter((row) => settled.has(row.id)).reduce((total, row) => total + row.amountCents, 0),
      failed: result.failed,
    })
    setSelected(new Set())
    refresh()
  }

  const rowProps = {
    invoices: data.invoices,
    today: data.today,
    tab: query.tab,
    selecting: selected.size > 0,
    selected,
    cursor,
    hrefOf: rowHref,
    onOpen: openRow,
    onToggle: toggle,
    onSettle: setSettling,
  }

  return (
    <div className="flex flex-col gap-4">
      <Tabs value={query.tab} onValueChange={(tab) => go(withPaymentsChange(query, { tab: tab as PaymentTab }))}>
        <TabsList aria-label="Payment status" data-testid="payment-tabs">
          {PAYMENT_TABS.map((tab) => (
            <TabsTrigger key={tab} value={tab} data-testid={`tab-${tab}`}>
              {PAYMENT_TAB_LABEL[tab]}
              {tab === "to_settle" ? (
                <span className="tabular-nums" data-testid="tab-count-to_settle">
                  ({data.counts.to_settle})
                </span>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-3" role="search" data-testid="payment-filters">
        <SearchField
          value={query.q}
          onSearch={(q) => go(withPaymentsChange(query, { q }))}
          placeholder="Search client or invoice number"
          label="Search payments"
          testId="payment-search"
        />
        <div className="w-52">
          <OptionSelect
            options={companyOptions}
            value={query.client ?? ALL}
            onValueChange={(value) => go(withPaymentsChange(query, { client: value === ALL ? null : value }))}
            data-testid="payment-client-filter"
          />
        </div>
        {hasPaymentFilters(query) ? (
          <Button variant="ghost" onClick={() => go(withPaymentsChange(query, { q: "", client: null }))} data-testid="clear-filters">
            <X data-icon="inline-start" />
            Clear
          </Button>
        ) : null}
      </div>

      <section aria-label={PAYMENT_TAB_LABEL[query.tab]} aria-busy={pending} className="relative flex flex-col gap-4" data-testid="payments-list" data-tab={query.tab}>
        <RefetchBar pending={pending} testId="payments-refetching" />
        <div className={cn("transition-opacity", pending && "opacity-60")}>
          {data.total === 0 ? (
            <div data-testid="no-payments">
              {hasPaymentFilters(query) ? (
                <EmptyState
                  message="No payments match these filters."
                  action={
                    <Button variant="outline" size="sm" onClick={() => go(withPaymentsChange(query, { q: "", client: null }))}>
                      Clear
                    </Button>
                  }
                />
              ) : (
                <EmptyState message={EMPTY[query.tab]} />
              )}
            </div>
          ) : query.tab === "settled" ? (
            <SettledSections payments={data.rows} {...rowProps} />
          ) : (
            <ul className="border-t border-border">
              {data.rows.map((payment) => (
                <PaymentListRow key={payment.id} payment={payment} {...rowProps} />
              ))}
            </ul>
          )}
        </div>
        <UrlPagination page={data.page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} />
      </section>

      {toSettle && (chosen.length > 0 || outcome) ? (
        <div
          className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3"
          data-testid="settle-bar"
        >
          {chosen.length > 0 ? (
            <>
              <span className="text-sm font-medium" aria-live="polite">
                {plural(chosen.length, "payment")} selected
              </span>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={() => setSelected(new Set())} data-testid="clear-selection">
                  Clear
                </Button>
                <Button onClick={() => setBulk(true)} data-testid="settle-selected">
                  Settle {chosen.length} · {formatWholeDollars(chosenCents)}
                </Button>
              </div>
            </>
          ) : outcome ? (
            <>
              <div className="flex flex-col gap-0.5 text-sm" role="status" data-testid="bulk-outcome">
                <span className="font-medium">
                  Settled {plural(outcome.settledCount, "payment")} · {formatCents(outcome.settledCents)}
                </span>
                {outcome.failed.length > 0 ? (
                  <span className="text-status-danger-foreground" data-testid="bulk-not-settled">
                    {plural(outcome.failed.length, "payment")} not settled: {outcome.failed[0].message}
                  </span>
                ) : null}
              </div>
              <Button variant="outline" onClick={() => setOutcome(null)} data-testid="bulk-done">
                Done
              </Button>
            </>
          ) : null}
        </div>
      ) : null}

      <SettleDialog payment={settling ? settleTargetOf(settling) : null} onOpenChange={(open) => !open && setSettling(null)} onDone={refresh} />
      <BulkSettleDialog payments={chosen} open={bulk} onOpenChange={setBulk} onDone={bulkDone} />
      <StaffDrawer view={view} onViewChange={setView} records={records} onChanged={refresh} />
    </div>
  )
}

type RowProps = {
  invoices: FinancePaymentsPage["invoices"]
  today: string
  tab: PaymentTab
  /** Something is selected: every checkbox shows, not only on hover. */
  selecting: boolean
  selected: ReadonlySet<string>
  cursor: string | null
  hrefOf: (id: string) => string
  onOpen: (id: string, intent?: "fail") => void
  onToggle: (id: string, checked: boolean) => void
  onSettle: (payment: StaffPaymentRow) => void
}

function SettledSections({ payments, ...row }: RowProps & { payments: readonly StaffPaymentRow[] }) {
  const sections = settledSections(payments)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  return (
    <div className="flex flex-col gap-6">
      {sections.map((section) => (
        <DenseSection
          key={section.key}
          id={`settled-${section.key}`}
          label={section.label}
          count={section.payments.length}
          open={!collapsed.has(section.key)}
          onToggle={() => toggle(section.key)}
        >
          {section.payments.map((payment) => (
            <PaymentListRow key={payment.id} payment={payment} {...row} />
          ))}
        </DenseSection>
      ))}
    </div>
  )
}

function WhenCell({ payment, today, tab }: { payment: StaffPaymentRow; today: string; tab: PaymentTab }) {
  if (tab === "to_settle") {
    const wait = settleWait(payment.initiatedAt, today)
    return (
      <span
        className={cn("w-32 shrink-0 text-right text-sm tabular-nums", wait.late ? "text-status-danger-foreground" : "text-muted-foreground")}
        data-testid="payment-wait"
        data-late={wait.late || undefined}
      >
        {wait.label}
      </span>
    )
  }
  const at = tab === "settled" ? payment.settledAt : payment.failedAt
  return (
    <span className="w-32 shrink-0 text-right text-sm text-muted-foreground tabular-nums" data-testid="payment-when">
      {at ? formatIsoShortDay(at) : ""}
    </span>
  )
}

function PaymentListRow({
  payment,
  invoices,
  today,
  tab,
  selecting,
  selected,
  cursor,
  hrefOf,
  onOpen,
  onToggle,
  onSettle,
}: RowProps & { payment: StaffPaymentRow }) {
  const toSettle = tab === "to_settle"
  const checked = selected.has(payment.id)
  const amount = formatCents(payment.amountCents)
  return (
    <DenseRow
      cursor={cursor === payment.id}
      className="group h-12"
      data-testid="payment-row"
      data-payment-id={payment.id}
      data-status={payment.status}
      data-deposit={payment.deposit ? "true" : undefined}
      data-state={checked ? "selected" : undefined}
    >
      {toSettle ? (
        <Checkbox
          aria-label={`Select ${amount} from ${payment.companyName}`}
          checked={checked}
          onCheckedChange={(next) => onToggle(payment.id, next)}
          className={cn(
            "relative z-10 transition-opacity",
            selecting || checked ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
          )}
          data-testid="payment-select"
        />
      ) : null}
      <RowOpener href={hrefOf(payment.id)} onOpen={() => onOpen(payment.id)} className="flex-1" testId="payment-open">
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium" data-testid="payment-client">
            {payment.companyName}
          </span>
          <span className="truncate text-xs text-muted-foreground" data-testid="payment-detail">
            {paymentRowDetail(payment, invoices)}
          </span>
        </span>
      </RowOpener>
      <WhenCell payment={payment} today={today} tab={tab} />
      <span className="w-28 shrink-0 text-right font-medium tabular-nums" data-slot="money" data-testid="payment-amount">
        {amount}
      </span>
      {toSettle ? (
        <div className="relative z-10 flex shrink-0 items-center gap-1">
          <Button size="sm" variant="outline" onClick={() => onSettle(payment)} data-testid="settle-row">
            Settle
          </Button>
          <PaymentRowMenu label={`${amount} from ${payment.companyName}`} onMarkFailed={() => onOpen(payment.id, "fail")} />
        </div>
      ) : null}
    </DenseRow>
  )
}