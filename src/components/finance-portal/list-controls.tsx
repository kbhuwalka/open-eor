"use client"

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react"
import Link from "next/link"
import { Search, X } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const SEARCH_DEBOUNCE_MS = 300

/**
 * The search of a Finance list: a field with a leading icon whose text reaches the URL 300 ms after
 * typing stops. A new `value` from the URL (Clear, back and forward) replaces what is typed.
 */
export function SearchField({
  value,
  onSearch,
  placeholder,
  label,
  testId,
}: {
  value: string
  onSearch: (q: string) => void
  placeholder: string
  label: string
  testId: string
}) {
  const [text, setText] = useState(value)
  const [seen, setSeen] = useState(value)
  if (value !== seen) {
    setSeen(value)
    setText(value)
  }
  const latest = useRef(onSearch)
  useEffect(() => {
    latest.current = onSearch
  })

  useEffect(() => {
    const trimmed = text.trim()
    if (trimmed === seen) return
    const timer = setTimeout(() => latest.current(trimmed), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [text, seen])

  return (
    <div className="relative min-w-56 flex-[1_1_16rem]">
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="pl-9"
        data-testid={testId}
      />
    </div>
  )
}

/** A chip's remove control or the Clear button: a button, or a link to the URL without the filter whose plain click calls `run`. */
export type FilterAction = { run: () => void; href?: string }

export type FilterChipItem = { key: string; label: string; remove: FilterAction }

const plainClick = (event: MouseEvent) => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey

function ActionControl({
  action,
  className,
  label,
  testId,
  children,
}: {
  action: FilterAction
  className: string
  label?: string
  testId: string
  children: ReactNode
}) {
  if (action.href === undefined) {
    return (
      <button type="button" onClick={action.run} aria-label={label} className={className} data-testid={testId}>
        {children}
      </button>
    )
  }
  return (
    <Link
      href={action.href}
      scroll={false}
      onClick={(event) => {
        if (!plainClick(event)) return
        event.preventDefault()
        action.run()
      }}
      aria-label={label}
      className={className}
      data-testid={testId}
    >
      {children}
    </Link>
  )
}

/**
 * The active filters of a Finance list as removable chips (`text-xs`, bordered, an X named
 * "Remove filter: Overdue"), then a ghost Clear (ui-guidelines C30). Render it only while a
 * filter is on.
 */
export function FilterChips({ chips, clear }: { chips: readonly FilterChipItem[]; clear: FilterAction }) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="filter-chips">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-muted/50 pr-1 pl-2.5 text-xs"
          data-testid="filter-chip"
          data-chip={chip.key}
        >
          {chip.label}
          <ActionControl
            action={chip.remove}
            label={`Remove filter: ${chip.label}`}
            className="rounded-sm p-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            testId="filter-chip-remove"
          >
            <X className="size-3.5" />
          </ActionControl>
        </span>
      ))}
      <ActionControl action={clear} className={buttonVariants({ variant: "ghost", size: "sm" })} testId="clear-filters">
        Clear
      </ActionControl>
    </div>
  )
}

/** The `h-0.5` pulse bar over a list while its next page or filter loads. */
export function RefetchBar({ pending, testId }: { pending: boolean; testId?: string }) {
  return pending ? <div aria-hidden className="absolute inset-x-0 top-0 z-10 h-0.5 animate-pulse bg-primary" data-testid={testId} /> : null
}
