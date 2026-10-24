"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Search, X } from "lucide-react"

import { AtRiskFlag } from "@/components/at-risk-flag"
import { Pagination } from "@/components/data-table/pagination"
import { EmptyState } from "@/components/empty-state"
import { PersonStatusBadge } from "@/components/person-status"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Input } from "@/components/ui/input"
import { OptionSelect, type Option } from "@/components/ui/option-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDay } from "@/lib/format"
import { casesSearch, hasCaseFilters, withCasesChange, type CasesQuery } from "@/lib/onboarding-portal/cases-query"
import { stageProgressText } from "@/lib/onboarding-portal/stage-text"
import { PERSON_STATUS_LABEL, PERSON_STATUSES } from "@/domain/person-status"
import { showPagination } from "@/lib/pagination"
import { parseDay } from "@/lib/task-view"
import type { CasesPage } from "@/server/onboarding-portal/directory"

const ALL = "all"
const SEARCH_DEBOUNCE_MS = 300
const HEAD = "text-xs font-medium tracking-wide text-muted-foreground uppercase"

/**
 * The people and cases directory (onboarding-portal.md §5): search, filters, the table and paging.
 * Like the client people list, all state is in the URL and every change is a `router.replace` in
 * a transition, so the current rows stay (dimmed) until the new page arrives.
 */
export function CasesTable({ data, query, nowIso }: { data: CasesPage; query: CasesQuery; nowIso: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [atRisk, setAtRisk] = useState(query.atRisk)
  const [seenAtRisk, setSeenAtRisk] = useState(query.atRisk)
  if (seenAtRisk !== query.atRisk) {
    setSeenAtRisk(query.atRisk)
    setAtRisk(query.atRisk)
  }
  const now = new Date(nowIso)

  function go(next: CasesQuery) {
    startTransition(() => {
      router.replace(`/onboarding/cases${casesSearch(next)}`, { scroll: false })
    })
  }

  const [text, setText] = useState(query.q)
  const lastPushed = useRef(query.q)
  useEffect(() => {
    if (query.q !== lastPushed.current) {
      lastPushed.current = query.q
      setText(query.q)
    }
  }, [query.q])
  useEffect(() => {
    const trimmed = text.trim()
    if (trimmed === lastPushed.current) return
    const timer = setTimeout(() => {
      lastPushed.current = trimmed
      go(withCasesChange(query, { q: trimmed }))
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // `go` and `query` only matter at fire time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  if (data.overall === 0) return <EmptyState message="No cases yet. They appear here as clients place orders." />

  const statusOptions: Option[] = [{ value: ALL, label: "All statuses" }, ...PERSON_STATUSES.map((s) => ({ value: s, label: PERSON_STATUS_LABEL[s] }))]
  const stageOptions: Option[] = [{ value: ALL, label: "All stages" }, ...data.stages.map((s) => ({ value: s.id, label: s.title }))]
  const clientOptions: Option[] = [{ value: ALL, label: "All clients" }, ...data.clients.map((c) => ({ value: c.id, label: c.name }))]

  function clearFilters() {
    lastPushed.current = ""
    setText("")
    go(withCasesChange(query, { q: "", status: null, atRisk: false, stage: null, client: null, startFrom: null, startTo: null }))
  }

  return (
    <div className="flex flex-col gap-4" data-testid="cases-directory">
      <div className="flex flex-wrap items-center gap-3" role="search" data-testid="cases-filters">
        <div className="relative min-w-56 flex-[2_1_16rem]">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search person or client"
            aria-label="Search cases"
            className="pl-9"
            data-testid="cases-search"
          />
        </div>
        <div className="w-40">
          <OptionSelect
            options={statusOptions}
            value={query.status ?? ALL}
            onValueChange={(v) => go(withCasesChange(query, { status: v === ALL ? null : (v as CasesQuery["status"]) }))}
            data-testid="status-filter"
          />
        </div>
        <div className="w-44">
          <OptionSelect
            options={stageOptions}
            value={query.stage ?? ALL}
            onValueChange={(v) => go(withCasesChange(query, { stage: v === ALL ? null : v }))}
            data-testid="stage-filter"
          />
        </div>
        <div className="w-48">
          <OptionSelect
            options={clientOptions}
            value={query.client ?? ALL}
            onValueChange={(v) => go(withCasesChange(query, { client: v === ALL ? null : v }))}
            data-testid="client-filter"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={atRisk}
            onChange={(e) => {
              setAtRisk(e.target.checked)
              go(withCasesChange(query, { atRisk: e.target.checked }))
            }}
            data-testid="at-risk-filter"
          />
          At risk
        </label>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Starts</span>
          <div className="w-40">
            <DatePicker
              value={query.startFrom ?? ""}
              max={query.startTo ?? undefined}
              onValueChange={(v) => go(withCasesChange(query, { startFrom: v || null }))}
              placeholder="From"
              data-testid="start-from"
            />
          </div>
          <span>to</span>
          <div className="w-40">
            <DatePicker
              value={query.startTo ?? ""}
              min={query.startFrom ?? undefined}
              onValueChange={(v) => go(withCasesChange(query, { startTo: v || null }))}
              placeholder="To"
              data-testid="start-to"
            />
          </div>
        </div>
        {hasCaseFilters(query) ? (
          <Button variant="ghost" onClick={clearFilters} data-testid="clear-filters">
            <X data-icon="inline-start" />
            Clear
          </Button>
        ) : null}
      </div>

      <section aria-label="Cases" aria-busy={pending} className="relative overflow-hidden rounded-lg border border-border">
        {pending ? <div aria-hidden className="absolute inset-x-0 top-0 z-10 h-0.5 animate-pulse bg-primary" /> : null}
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={HEAD}>Person</TableHead>
              <TableHead className={HEAD}>Client</TableHead>
              <TableHead className={`${HEAD} hidden lg:table-cell`}>Role</TableHead>
              <TableHead className={HEAD}>Starts</TableHead>
              <TableHead className={HEAD}>Status</TableHead>
              <TableHead className={HEAD}>Progress</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className={pending ? "opacity-60 transition-opacity" : "transition-opacity"}>
            {data.rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground" data-testid="no-cases">
                  No cases match these filters.{" "}
                  <button type="button" onClick={clearFilters} className="underline underline-offset-4">
                    Clear filters
                  </button>
                </TableCell>
              </TableRow>
            ) : (
              data.rows.map((row) => (
                <TableRow key={row.caseId} className="relative" data-testid="case-row" data-at-risk={row.atRisk ? "true" : undefined}>
                  <TableCell>
                    <div className="flex flex-col">
                      <div className="flex items-center gap-1.5">
                        <Link
                          href={`/onboarding/cases/${row.caseId}`}
                          className="font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
                        >
                          {row.person}
                        </Link>
                        <AtRiskFlag message={row.atRisk} className="relative z-10" />
                      </div>
                      <span className="text-xs text-muted-foreground">{row.email}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.clientName}</TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">{row.roleName}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                    {row.startDate ? formatDay(parseDay(row.startDate), now) : "Not set"}
                  </TableCell>
                  <TableCell>
                    <PersonStatusBadge status={row.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground" data-testid="case-progress">
                    {stageProgressText(row)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {showPagination(data.total) ? (
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            pageSize={data.pageSize}
            onPageChange={(page) => go({ ...query, page })}
            onPageSizeChange={(size) => go(withCasesChange(query, { size: size as CasesQuery["size"] }))}
          />
        ) : null}
      </section>
    </div>
  )
}
