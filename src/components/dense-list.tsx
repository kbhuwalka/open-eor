"use client"

/**
 * The dense list look of the specialist Home (ui-guidelines C43) as shared pieces, for lists whose
 * rows open a drawer: sections with a `text-sm font-medium` toggle header and a count, 40px rows
 * with only a bottom border (no box, no column headers), the whole row one stretched link or
 * button, and a `j`/`k` (arrow keys) cursor with Enter to open. The list owns its order and what a
 * row opens; these pieces own only the look and the keyboard.
 */

import { useEffect, type MouseEvent, type ReactNode } from "react"
import Link from "next/link"
import { cn } from "cn"
import { ChevronDown } from "lucide-react"

import { cursorKeyOf, moveCursor } from "@/lib/list-navigation"

export function DenseSection({
  id,
  label,
  count,
  open,
  onToggle,
  children,
}: {
  id: string
  label: string
  count: number
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const panel = `section-${id.replace(/\W+/g, "-")}`
  return (
    <section aria-labelledby={`${panel}-title`} className="flex flex-col" data-testid="list-section" data-section={id}>
      <h3 id={`${panel}-title`} className="mb-2 text-sm font-medium">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panel}
          onClick={onToggle}
          className="flex items-center gap-1.5 rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronDown aria-hidden className={cn("size-4 text-muted-foreground transition-transform", !open && "-rotate-90")} />
          <span>{label}</span>
          <span className="font-normal text-muted-foreground tabular-nums">{count}</span>
        </button>
      </h3>
      {open ? <ul id={panel}>{children}</ul> : null}
    </section>
  )
}

/** One 40px row. `cursor` marks the keyboard cursor; extra `data-*` attributes go on the `li`. */
export function DenseRow({
  cursor,
  children,
  className,
  ...data
}: { cursor: boolean; children: ReactNode; className?: string } & Record<`data-${string}`, string | undefined>) {
  return (
    <li
      {...data}
      data-cursor={cursor || undefined}
      className={cn(
        "relative flex h-10 items-center gap-3 border-b border-border px-2 text-sm hover:bg-muted/60 data-[cursor]:bg-muted",
        className,
      )}
    >
      {children}
    </li>
  )
}

const OPENER =
  "flex min-w-0 items-center gap-3 truncate text-left outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring/50"

/**
 * The row's one control, stretched over the whole row. With an `href` it is a link (a cmd, ctrl,
 * shift or middle click opens that URL in a new tab) whose plain click calls `onOpen` instead;
 * without one it is a button.
 */
export function RowOpener({
  href,
  onOpen,
  children,
  className,
  testId,
  label,
}: {
  href?: string
  onOpen: () => void
  children: ReactNode
  className?: string
  testId?: string
  /** The accessible name, when the visible text alone does not say which row this is. */
  label?: string
}) {
  if (!href) {
    return (
      <button type="button" onClick={onOpen} className={cn(OPENER, className)} aria-label={label} data-testid={testId}>
        {children}
      </button>
    )
  }
  return (
    <Link
      href={href}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        onOpen()
      }}
      className={cn(OPENER, className)}
      aria-label={label}
      data-testid={testId}
    >
      {children}
    </Link>
  )
}

/**
 * `j`/`k` and the arrow keys move `cursor` through `ids` (the visible rows, in order) and Enter
 * opens the row under it. Off while `enabled` is false (a drawer is open) and while focus is in a
 * field, a popup or a dialog, so typing is never hijacked.
 */
export function useListCursor({
  ids,
  cursor,
  onCursor,
  onOpen,
  enabled,
}: {
  ids: readonly string[]
  cursor: string | null
  onCursor: (id: string) => void
  onOpen: (id: string) => void
  enabled: boolean
}) {
  useEffect(() => {
    if (!enabled) return
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target instanceof HTMLElement ? event.target : null
      if (target?.closest("input, textarea, select, [role=combobox], [role=listbox], [role=dialog]")) return
      const key = cursorKeyOf(event.key)
      if (key) {
        const next = moveCursor(ids, cursor, key)
        if (next === null) return
        event.preventDefault()
        onCursor(next)
      } else if (event.key === "Enter" && cursor !== null && ids.includes(cursor) && !target?.closest("a, button")) {
        event.preventDefault()
        onOpen(cursor)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [ids, cursor, onCursor, onOpen, enabled])
}
