"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { cn } from "cn"
import { ChevronDown, Search, X } from "lucide-react"

import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { OptionSelect, type Option } from "@/components/ui/option-select"
import {
  TASK_STATUS_FILTERS,
  TASK_STATUS_FILTER_LABEL,
  hasTaskInboxFilters,
  isTaskStatusFilter,
  taskInboxSearch,
  withTaskInboxChange,
  type TaskInboxQuery,
} from "@/lib/task-inbox-view"
import type { StaffHomePage, StaffHomeRow } from "@/server/task-inbox"

import { daysBetween, shortDay } from "./specialist-home-dates"
import { homeHref, type HomeGroup } from "./specialist-home-group"
import { SpecialistTaskDrawer } from "./specialist-task-drawer"

const ALL = "all"
const SEARCH_DEBOUNCE_MS = 300
const WEEK_DAYS = 7

/** Every dropdown shares the row evenly and wraps as equals, so no one is left alone on a second line. */
const FILTER_CELL = "min-w-40 flex-[1_1_10rem]"

type Section = { key: string; label: string; rows: StaffHomeRow[] }

/**
 * The rows in the order the server sent them (most urgent first), split into the sections the
 * viewer asked for: by urgency (overdue, due this week, later) or by task type, the group with the
 * most urgent task first.
 */
function sectionsFor(rows: readonly StaffHomeRow[], group: HomeGroup, today: string): Section[] {
  if (group === "task") {
    const sections = new Map<string, Section>()
    for (const row of rows) {
      const section = sections.get(row.key) ?? { key: row.key, label: row.title, rows: [] }
      section.rows.push(row)
      sections.set(row.key, section)
    }
    return [...sections.values()]
  }
  const dueIn = (row: StaffHomeRow) => (row.dueDate ? daysBetween(today, row.dueDate) : Number.POSITIVE_INFINITY)
  return [
    { key: "overdue", label: "Overdue", rows: rows.filter((row) => row.overdue) },
    { key: "week", label: "Due this week", rows: rows.filter((row) => !row.overdue && dueIn(row) < WEEK_DAYS) },
    { key: "later", label: "Later", rows: rows.filter((row) => !row.overdue && dueIn(row) >= WEEK_DAYS) },
  ].filter((section) => section.rows.length > 0)
}

function Due({ row, today }: { row: StaffHomeRow; today: string }) {
  if (!row.dueDate) return <span className="text-muted-foreground">No date</span>
  const dueIn = daysBetween(today, row.dueDate)
  if (dueIn < 0) return <span className="text-status-danger-foreground tabular-nums">{-dueIn}d overdue</span>
  if (dueIn === 0) return <span className="font-medium tabular-nums">Today</span>
  return <span className="text-muted-foreground tabular-nums">{shortDay(row.dueDate)}</span>
}

type FilterSelect = {
  id: string
  all: string
  options: Option[]
  value: string
  onChange: (value: string | null) => void
}

/**
 * The onboarding specialist's home (ui-guidelines C28, C43): every open task the team can see,
 * grouped by urgency or by task, one compact row each (the title and the person, the client, when
 * it is due). A click anywhere on a row opens the drawer, where the task is done; `j`/`k` and Enter do the same from the keyboard. Search, the Client, Task and Status
 * filters and the grouping live in the URL like the other lists: each change is a `router.replace`
 * in a transition, so the rows stay (dimmed) until the new ones arrive.
 */
export function SpecialistHome({
  data,
  query,
  group,
  today,
  nowIso,
  initialTaskId,
  linkedRow,
  emptyMessage,
}: {
  data: StaffHomePage
  query: TaskInboxQuery
  group: HomeGroup
  today: string
  nowIso: string
  /** `?open=` of a link that opens a task straight in the drawer (a person's page, the payroll checklist). */
  initialTaskId: string | null
  /** The `?open=` task when it is not in the list (still blocked, or filtered out), so the link opens it anyway. */
  linkedRow: StaffHomeRow | null
  emptyMessage: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(["later"]))
  const [selected, setSelected] = useState<string | null>(initialTaskId)
  const [seenTask, setSeenTask] = useState(initialTaskId)
  const [notice, setNotice] = useState<string | null>(null)
  if (initialTaskId !== seenTask) {
    setSeenTask(initialTaskId)
    if (initialTaskId) setSelected(initialTaskId)
  }
  const [cursor, setCursor] = useState<string | null>(null)

  function go(next: TaskInboxQuery) {
    startTransition(() => {
      router.replace(homeHref(taskInboxSearch(next), group), { scroll: false })
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
      go(withTaskInboxChange(query, { q: trimmed }))
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // `go` and `query` only matter at fire time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  const sections = sectionsFor(data.rows, group, today)
  const ordered = sections.flatMap((section) => section.rows)
  const selectedIndex = ordered.findIndex((row) => row.id === selected)
  const selectedRow = selectedIndex >= 0 ? ordered[selectedIndex] : selected !== null && linkedRow?.id === selected ? linkedRow : null

  useEffect(() => {
    if (selected !== null) return
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target instanceof HTMLElement ? event.target : null
      if (target?.closest("input, textarea, select, [role=combobox], [role=listbox], [role=dialog]")) return
      const rows = sections.filter((section) => !collapsed.has(section.key)).flatMap((section) => section.rows)
      if (rows.length === 0) return
      const index = rows.findIndex((row) => row.id === cursor)
      if (event.key === "ArrowDown" || event.key === "j") {
        event.preventDefault()
        setCursor(rows[Math.min(rows.length - 1, index + 1)].id)
      } else if (event.key === "ArrowUp" || event.key === "k") {
        event.preventDefault()
        setCursor(rows[Math.max(0, index - 1)].id)
      } else if (event.key === "Enter" && index >= 0 && !target?.closest("a, button")) {
        event.preventDefault()
        setSelected(rows[index].id)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  if (data.empty) return <EmptyState message={emptyMessage} />

  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  function clearFilters() {
    lastPushed.current = ""
    setText("")
    go(withTaskInboxChange(query, { q: "", client: null, task: null, status: null }))
  }

  const selects: FilterSelect[] = [
    {
      id: "client",
      all: "All clients",
      options: data.options.clients,
      value: query.client ?? ALL,
      onChange: (client) => go(withTaskInboxChange(query, { client })),
    },
    {
      id: "task",
      all: "All tasks",
      options: data.options.tasks,
      value: query.task ?? ALL,
      onChange: (task) => go(withTaskInboxChange(query, { task })),
    },
    {
      id: "status",
      all: "All statuses",
      options: TASK_STATUS_FILTERS.map((value) => ({ value, label: TASK_STATUS_FILTER_LABEL[value] })),
      value: query.status ?? ALL,
      onChange: (status) => go(withTaskInboxChange(query, { status: isTaskStatusFilter(status) ? status : null })),
    },
  ]

  return (
    <div className="flex flex-col gap-4" data-testid="task-inbox">
      <div className="flex flex-wrap items-center gap-3" role="search" data-testid="task-filters">
        <div className="relative min-w-56 flex-[2_1_16rem]">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Search task, person or client"
            aria-label="Search tasks"
            className="pl-9"
            data-testid="task-search"
          />
        </div>
        {selects.map((filter) => (
          <div key={filter.id} className={FILTER_CELL}>
            <label htmlFor={`task-${filter.id}-filter`} className="sr-only">
              {filter.id}
            </label>
            <OptionSelect
              id={`task-${filter.id}-filter`}
              options={[{ value: ALL, label: filter.all }, ...filter.options]}
              value={filter.value}
              placeholder={filter.all}
              onValueChange={(value) => filter.onChange(value === ALL ? null : value)}
              data-testid={`${filter.id}-filter`}
            />
          </div>
        ))}
        {hasTaskInboxFilters(query) ? (
          <Button variant="ghost" onClick={clearFilters} data-testid="clear-task-filters">
            <X data-icon="inline-start" />
            Clear
          </Button>
        ) : null}
      </div>

      {data.rows.length === 0 ? (
        <div className="rounded-lg border border-border px-4 py-10 text-center text-muted-foreground" data-testid="no-tasks">
          No tasks match these filters.{" "}
          <button type="button" onClick={clearFilters} className="underline underline-offset-4">
            Clear
          </button>
        </div>
      ) : (
        <div
          aria-busy={pending}
          className={cn("flex flex-col gap-6 transition-opacity", pending && "opacity-60")}
          data-testid="task-sections"
        >
          {sections.map((section) => {
            const open = !collapsed.has(section.key)
            const panel = `section-${section.key.replace(/\W+/g, "-")}`
            return (
              <section
                key={section.key}
                aria-labelledby={`${panel}-title`}
                className="flex flex-col"
                data-testid="task-section"
                data-section={section.key}
              >
                <h3 id={`${panel}-title`} className="mb-2 text-sm font-medium">
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={panel}
                    onClick={() => toggle(section.key)}
                    className="flex items-center gap-1.5 rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <ChevronDown
                      aria-hidden
                      className={cn("size-4 text-muted-foreground transition-transform", !open && "-rotate-90")}
                    />
                    <span>{section.label}</span>
                    <span className="font-normal text-muted-foreground tabular-nums">{section.rows.length}</span>
                  </button>
                </h3>
                {open ? (
                  <ul id={panel}>
                    {section.rows.map((row) => (
                      <li
                        key={row.id}
                        data-testid="task-row"
                        data-task-type={row.type}
                        data-overdue={row.overdue || undefined}
                        data-at-risk={row.atRisk || undefined}
                        data-cursor={cursor === row.id || undefined}
                        className="relative flex h-10 items-center gap-3 border-b border-border px-2 text-sm hover:bg-muted/60 data-[cursor]:bg-muted"
                      >
                        <Link
                          href={row.href}
                          data-testid="task-link"
                          onClick={(event) => {
                            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return
                            event.preventDefault()
                            setCursor(row.id)
                            setSelected(row.id)
                          }}
                          className="min-w-0 truncate outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring/50"
                        >
                          <span className="font-medium">{group === "task" ? row.personName : row.title}</span>
                          {group === "urgency" ? (
                            <span className="ml-2 text-muted-foreground">{row.personName}</span>
                          ) : (
                            <span className="sr-only">, {row.title}</span>
                          )}
                          <span className="sr-only">, {row.clientName}</span>
                        </Link>
                        <span className="ml-auto hidden shrink-0 truncate text-muted-foreground sm:block">
                          {row.clientName}
                        </span>
                        <span className="ml-auto w-24 shrink-0 text-right sm:ml-0">
                          <Due row={row} today={today} />
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            )
          })}
        </div>
      )}

      <SpecialistTaskDrawer
        row={selectedRow}
        today={today}
        nowIso={nowIso}
        position={selectedIndex >= 0 ? { index: selectedIndex, total: ordered.length } : null}
        notice={notice}
        onClose={() => {
          setSelected(null)
          setNotice(null)
          if (initialTaskId) router.replace(homeHref(taskInboxSearch(query), group), { scroll: false })
        }}
        onStep={(delta) => {
          setNotice(null)
          setSelected(ordered[selectedIndex + delta]?.id ?? null)
        }}
        onFinished={(message) => {
          const next = selectedIndex >= 0 ? (ordered[selectedIndex + 1] ?? ordered[selectedIndex - 1] ?? null) : null
          setNotice(next ? message : null)
          setSelected(next?.id ?? null)
        }}
      />
    </div>
  )
}
