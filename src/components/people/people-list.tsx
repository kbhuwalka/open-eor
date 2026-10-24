"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Search, X } from "lucide-react"

import { AtRiskFlag } from "@/components/at-risk-flag"
import { Pagination } from "@/components/data-table/pagination"
import { SortableHead } from "@/components/data-table/sortable-head"
import { EmptyState } from "@/components/empty-state"
import { PersonStatusBadge } from "@/components/person-status"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { OptionSelect, type Option } from "@/components/ui/option-select"
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table"
import { PERSON_STATUS_LABEL, PERSON_STATUSES } from "@/domain/person-status"
import { showPagination } from "@/lib/pagination"
import {
  cycleSort,
  hasActiveFilters,
  peopleSearch,
  withPeopleChange,
  type PeopleQuery,
  type PeopleSortKey,
} from "@/lib/people-query"
import { stateName } from "@/lib/us-states"
import type { PeoplePage } from "@/server/queries"

const ALL = "all"
const SEARCH_DEBOUNCE_MS = 300

const STATUS_OPTIONS: Option[] = [
  { value: ALL, label: "All statuses" },
  ...PERSON_STATUSES.map((s) => ({ value: s, label: PERSON_STATUS_LABEL[s] })),
]

/**
 * The people list: filter bar, sortable table and pagination. All state lives
 * in the URL; every change navigates with `router.replace` inside a
 * transition, so the current rows stay (dimmed) until the new page arrives.
 *
 * The client portal and the onboarding team show the same list: the team's adds a Client column
 * and a Client filter, because it spans every company.
 */
const LIST: Record<"client" | "onboarding", { listPath: string; personPath: string; staff: boolean }> = {
  client: { listPath: "/client/people", personPath: "/client/people", staff: false },
  onboarding: { listPath: "/onboarding/people", personPath: "/onboarding/people", staff: true },
}

export function PeopleList({
  portal = "client",
  data,
  query,
  emptyAction,
  emptyMessage = "No one yet. Start your first hire through Northwind.",
}: {
  portal?: "client" | "onboarding"
  data: PeoplePage
  query: PeopleQuery
  emptyAction?: React.ReactNode
  emptyMessage?: string
}) {
  const { listPath, personPath, staff } = LIST[portal]
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function go(next: PeopleQuery) {
    startTransition(() => {
      router.replace(`${listPath}${peopleSearch(next)}`, { scroll: false })
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
      go(withPeopleChange(query, { q: trimmed }))
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // `go` and `query` only matter at fire time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  if (data.companyTotal === 0) {
    return (
      <EmptyState message={emptyMessage} action={emptyAction} />
    )
  }

  const clientOptions: Option[] = [
    { value: ALL, label: "All clients" },
    ...data.clients.map((c) => ({ value: c.id, label: c.name })),
  ]
  const locationOptions: Option[] = [
    { value: ALL, label: "All locations" },
    ...data.locations.map((code) => ({ value: code, label: stateName(code), hint: code })),
  ]
  const roleOptions: Option[] = [
    { value: ALL, label: "All roles" },
    ...data.roleOptions.map((r) => ({ value: r.id, label: r.name })),
  ]
  const sortHead = (key: PeopleSortKey, label: string, className?: string) => (
    <SortableHead
      label={label}
      active={query.sort === key}
      direction={query.dir}
      onSort={() => go(withPeopleChange(query, cycleSort(query, key)))}
      className={className}
    />
  )

  function clearFilters() {
    lastPushed.current = ""
    setText("")
    go(withPeopleChange(query, { q: "", status: null, client: null, role: null, location: null, atRisk: false }))
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3" role="search" data-testid="people-filters">
        <div className="relative min-w-56 flex-[2_1_16rem]">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search name or email"
            aria-label="Search people"
            className="pl-9"
            data-testid="people-search"
          />
        </div>
        <div className="w-44">
          <OptionSelect
            options={STATUS_OPTIONS}
            value={query.status ?? ALL}
            onValueChange={(v) =>
              go(withPeopleChange(query, { status: v === ALL ? null : (v as PeopleQuery["status"]) }))
            }
            data-testid="status-filter"
          />
        </div>
        {staff ? (
          <div className="w-48">
            <OptionSelect
              options={clientOptions}
              value={query.client ?? ALL}
              onValueChange={(v) => go(withPeopleChange(query, { client: v === ALL ? null : v }))}
              data-testid="client-filter"
            />
          </div>
        ) : null}
        <div className="w-48">
          <OptionSelect
            options={roleOptions}
            value={query.role ?? ALL}
            onValueChange={(v) => go(withPeopleChange(query, { role: v === ALL ? null : v }))}
            data-testid="role-filter"
          />
        </div>
        {staff ? null : (
          <div className="w-48">
            <OptionSelect
              options={locationOptions}
              value={query.location ?? ALL}
              onValueChange={(v) => go(withPeopleChange(query, { location: v === ALL ? null : v }))}
              data-testid="location-filter"
            />
          </div>
        )}
        {hasActiveFilters(query) ? (
          <div className="flex items-center gap-2">
            {query.atRisk ? (
              <span
                className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-muted/50 pr-1 pl-2.5 text-xs"
                data-testid="filter-chip"
                data-chip="atRisk"
              >
                At risk
                <button
                  type="button"
                  onClick={() => go(withPeopleChange(query, { atRisk: false }))}
                  aria-label="Remove filter: At risk"
                  className="rounded-sm p-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                  data-testid="filter-chip-remove"
                >
                  <X className="size-3.5" />
                </button>
              </span>
            ) : null}
            <Button variant="ghost" onClick={clearFilters} data-testid="clear-filters">
              <X data-icon="inline-start" />
              Clear
            </Button>
          </div>
        ) : null}
      </div>

      <section
        aria-label="People"
        aria-busy={pending}
        className="relative overflow-hidden rounded-lg border border-border"
      >
        {pending ? (
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 z-10 h-0.5 animate-pulse bg-primary"
            data-testid="people-refetching"
          />
        ) : null}
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {sortHead("name", "Name")}
              {staff ? sortHead("client", "Client") : null}
              {sortHead("role", "Role")}
              {staff ? null : sortHead("location", "Location")}
              {sortHead("status", "Status")}
            </TableRow>
          </TableHeader>
          <TableBody className={pending ? "opacity-60 transition-opacity" : "transition-opacity"}>
            {data.rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="py-10 text-center text-muted-foreground" data-testid="no-people">
                  No people match these filters.{" "}
                  <button type="button" onClick={clearFilters} className="underline underline-offset-4">
                    Clear filters
                  </button>
                </TableCell>
              </TableRow>
            ) : (
              data.rows.map((row) => {
                return (
                  <TableRow key={row.caseId} className="relative" data-testid="person-row">
                    <TableCell>
                      <div className="flex flex-col">
                        <div className="flex items-center gap-1.5">
                          <Link
                            href={`${personPath}/${row.caseId}`}
                            className="font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
                          >
                            {row.workerName}
                          </Link>
                          <AtRiskFlag message={row.atRisk} className="relative z-10" />
                        </div>
                        <span className="text-xs text-muted-foreground">{row.workerEmail}</span>
                      </div>
                    </TableCell>
                    {staff ? <TableCell className="text-muted-foreground">{row.clientName}</TableCell> : null}
                    <TableCell className="text-muted-foreground">{row.roleName}</TableCell>
                    {staff ? null : <TableCell className="text-muted-foreground">{stateName(row.location)}</TableCell>}
                    <TableCell>
                      <PersonStatusBadge status={row.status} />
                    </TableCell>
                  </TableRow>
                )
              })
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
            onPageSizeChange={(size) =>
              go(withPeopleChange(query, { size: size as PeopleQuery["size"] }))
            }
          />
        ) : null}
      </section>
    </div>
  )
}
