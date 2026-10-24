"use client"

import * as React from "react"
import { Loader2Icon, SearchIcon } from "lucide-react"

import { PersonStatusBadge } from "@/components/person-status"
import {
  Combobox,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import { InputGroupAddon } from "@/components/ui/input-group"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { EmployeeResult, EmployeeSearchPage } from "@/server/personas"

const DEBOUNCE_MS = 150

type SearchState =
  | { query: string; page: EmployeeSearchPage; failed: false }
  | { query: string; page: null; failed: true }

/**
 * Searchable list of every employee (ui-guidelines C14). The list is filtered by the server as the
 * user types (`search`), never by a list shipped to the browser, so it holds up with thousands of
 * rows. Arrow keys move the highlight, Enter selects, Escape closes.
 */
export function EmployeeSearchDialog({
  open,
  onOpenChange,
  search,
  onSelect,
  pending = false,
  title = "Employees",
  description = "Search by name, email or company, then pick who you're signing in as.",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  search: (query: string) => Promise<EmployeeSearchPage>
  onSelect: (employee: EmployeeResult) => void
  /** True while the chosen employee is being signed in. */
  pending?: boolean
  title?: string
  description?: string
}) {
  const [query, setQuery] = React.useState("")
  const [state, setState] = React.useState<SearchState | null>(null)
  const trimmed = query.trim()
  const loading = state === null || state.query !== trimmed

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    const timer = window.setTimeout(
      () => {
        search(trimmed).then(
          (page) => {
            if (!cancelled) setState({ query: trimmed, page, failed: false })
          },
          () => {
            if (!cancelled) setState({ query: trimmed, page: null, failed: true })
          }
        )
      },
      state === null ? 0 : DEBOUNCE_MS
    )
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
    // `state === null` only picks the first delay; it must not retrigger the search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, trimmed, search])

  const page = state?.page ?? null
  const rows = page?.rows ?? []
  const settled = !loading && state !== null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setQuery("")
      }}
    >
      <DialogContent className="top-[12%] translate-y-0 gap-0 p-0 sm:max-w-xl">
        <DialogHeader className="p-6 pb-4">
          <DialogTitle className="text-lg">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Combobox
          inline
          open
          items={rows}
          filter={null}
          autoHighlight
          value={null}
          inputValue={query}
          onInputValueChange={(value) => setQuery(value)}
          onValueChange={(row) => {
            if (row && !pending) onSelect(row as EmployeeResult)
          }}
          itemToStringLabel={(row: EmployeeResult) => row.displayName}
          itemToStringValue={(row: EmployeeResult) => row.id}
          isItemEqualToValue={(a: EmployeeResult, b: EmployeeResult) =>
            a.id === b.id
          }
        >
          <div className="px-6 pb-3">
            <ComboboxInput
              showTrigger={false}
              placeholder="Search employees"
              aria-label="Search employees"
              autoComplete="off"
              className="h-10 w-full rounded-lg bg-muted"
            >
              <InputGroupAddon>
                <SearchIcon aria-hidden />
              </InputGroupAddon>
            </ComboboxInput>
          </div>
          <div
            className="border-t border-border"
            aria-busy={loading}
            data-loading={loading || undefined}
          >
            {state?.failed ? (
              <p role="alert" className="px-6 py-8 text-center text-sm text-muted-foreground">
                Couldn&apos;t load employees. Try typing again.
              </p>
            ) : settled && rows.length === 0 ? (
              <p role="status" className="px-6 py-8 text-center text-sm text-muted-foreground">
                {trimmed
                  ? `No employees match “${trimmed}”.`
                  : "There are no employees yet."}
              </p>
            ) : (
              <ComboboxList
                aria-label="Employees"
                className="max-h-80 p-2 data-empty:p-0 transition-opacity data-[loading=true]:opacity-60"
                data-loading={loading}
              >
                {(row: EmployeeResult) => (
                  <ComboboxItem
                    key={row.id}
                    value={row}
                    className="h-auto items-start gap-3 rounded-lg px-3 py-2.5 data-highlighted:bg-primary/10 data-highlighted:text-foreground"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {row.displayName}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {row.email} · {row.companyName}
                      </span>
                    </span>
                    {row.status ? (
                      <PersonStatusBadge status={row.status} className="mt-0.5" />
                    ) : null}
                  </ComboboxItem>
                )}
              </ComboboxList>
            )}
          </div>
        </Combobox>
        <div
          className="flex items-center justify-between gap-4 border-t border-border px-6 py-3 text-xs text-muted-foreground"
          aria-live="polite"
        >
          <span>
            {pending ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2Icon aria-hidden className="size-3.5 animate-spin" />
                Signing in…
              </span>
            ) : page ? (
              summary(page)
            ) : (
              "Loading employees…"
            )}
          </span>
          <span className="hidden shrink-0 sm:inline">↑↓ navigate · Enter select · Esc close</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function summary(page: EmployeeSearchPage): string {
  if (page.total === 0) return "No matches"
  const n = page.rows.length
  if (page.total > n) {
    return `Showing ${n} of ${page.total.toLocaleString("en-US")}. Refine your search to narrow the list.`
  }
  return `${page.total.toLocaleString("en-US")} ${page.total === 1 ? "employee" : "employees"}`
}
