"use client"

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { cn } from "cn"
import { Search, X } from "lucide-react"

import { Pagination } from "@/components/data-table/pagination"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { OptionSelect, type Option } from "@/components/ui/option-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { showPagination } from "@/lib/pagination"
import {
  TASK_INBOX_CONFIG,
  type InboxColumn,
  type InboxFilter,
  type StaffInboxPortal,
} from "@/lib/task-inbox-config"
import {
  TASK_STATUS_FILTERS,
  TASK_STATUS_FILTER_LABEL,
  hasTaskInboxFilters,
  isTaskStatusFilter,
  taskInboxSearch,
  withTaskInboxChange,
  type TaskInboxPage,
  type TaskInboxQuery,
  type TaskInboxRow,
} from "@/lib/task-inbox-view"

import { DueLabel, TaskStatusBadge } from "./task-bits"

const ALL = "all"
const SEARCH_DEBOUNCE_MS = 300
const HEAD = "text-xs font-medium tracking-wide text-muted-foreground uppercase"

type ColumnDef = {
  label: string
  /** Classes for the header and every cell of the column (responsive hiding, wrapping). */
  className?: string
  /** Classes for the body cells only. */
  cellClassName?: string
  cell: (row: TaskInboxRow, now: Date) => ReactNode
}

/**
 * The task is the only link: the title is an anchor stretched over the whole row
 * (`after:absolute after:inset-0`, as the cases directory and the person Payments tab do), so a
 * click anywhere opens the task, keyboard focus has one stop per row and middle or cmd-click work.
 * The hidden text names the person and client so a screen reader hears what the row is about; below
 * `md` the Person, Client and Status columns drop out: the person shows under the title, the Due
 * label is already red when overdue and the task cell says when the start date is at risk.
 */
function TaskCell({ row }: { row: TaskInboxRow }) {
  return (
    <div className="flex flex-col">
      <Link
        href={row.href}
        className="font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
        data-testid="task-link"
      >
        {row.title}
        <span className="sr-only">
          , {row.personName}, {row.clientName}
        </span>
      </Link>
      <span aria-hidden className="text-xs text-muted-foreground md:hidden">
        {row.personName}
      </span>
      {row.detail ? <span className="text-xs text-muted-foreground">{row.detail}</span> : null}
      {row.atRisk ? (
        <span className="text-xs text-muted-foreground">Start date at risk</span>
      ) : row.blocksGoLive ? (
        <span className="text-xs text-muted-foreground">Blocks the start date</span>
      ) : null}
    </div>
  )
}

const COLUMNS: Record<InboxColumn, ColumnDef> = {
  task: { label: "Task", cell: (row) => <TaskCell row={row} /> },
  person: { label: "Person", className: "hidden md:table-cell", cell: (row) => row.personName },
  client: { label: "Client", className: "hidden md:table-cell", cellClassName: "text-muted-foreground", cell: (row) => row.clientName },
  due: {
    label: "Due",
    className: "whitespace-nowrap",
    cell: (row, now) => <DueLabel dueDate={row.dueDate} now={now} fallback="No date" />,
  },
  status: { label: "Status", className: "hidden md:table-cell", cell: (row) => <TaskStatusBadge row={row} /> },
}

const FILTER_LABEL: Record<InboxFilter, { all: string; name: string; width: string }> = {
  client: { all: "All clients", name: "Client", width: "w-48" },
  task: { all: "All tasks", name: "Task", width: "w-52" },
  status: { all: "All statuses", name: "Status", width: "w-44" },
}

/**
 * The staff home's one list (ui-guidelines C28, C43), shared by the onboarding specialist and
 * Finance: every open task the role can see, a search and the Client, Task and Status filters, the
 * rows most urgent first (overdue on top), each a whole-row link to its task page, paged per C11.
 * Which columns and filters show, and what an empty list says, is the portal's `TASK_INBOX_CONFIG`
 * record; nothing else differs. All state lives in the URL like the cases directory: every change
 * is a `router.replace` in a transition, so the current rows stay (dimmed) until the new page
 * arrives. `page` is already scoped to the signed-in user.
 */
export function TaskInboxTable({
  portal,
  page,
  query,
  nowIso,
}: {
  portal: StaffInboxPortal
  page: TaskInboxPage
  query: TaskInboxQuery
  nowIso: string
}) {
  const config = TASK_INBOX_CONFIG[portal]
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const now = new Date(nowIso)

  function go(next: TaskInboxQuery) {
    startTransition(() => {
      router.replace(`${config.basePath}${taskInboxSearch(next)}`, { scroll: false })
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

  if (page.empty) return <EmptyState message={config.emptyMessage} />

  function clearFilters() {
    lastPushed.current = ""
    setText("")
    go(withTaskInboxChange(query, { q: "", client: null, task: null, status: null }))
  }

  const columns = config.columns.map((id) => ({ id, ...COLUMNS[id] }))

  const selects: Record<InboxFilter, { options: Option[]; value: string; onChange: (value: string | null) => void }> = {
    client: {
      options: page.options.clients,
      value: query.client ?? ALL,
      onChange: (client) => go(withTaskInboxChange(query, { client })),
    },
    task: {
      options: page.options.tasks,
      value: query.task ?? ALL,
      onChange: (task) => go(withTaskInboxChange(query, { task })),
    },
    status: {
      options: TASK_STATUS_FILTERS.map((value) => ({ value, label: TASK_STATUS_FILTER_LABEL[value] })),
      value: query.status ?? ALL,
      onChange: (status) => go(withTaskInboxChange(query, { status: isTaskStatusFilter(status) ? status : null })),
    },
  }

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
            onChange={(e) => setText(e.target.value)}
            placeholder={config.searchPlaceholder}
            aria-label="Search tasks"
            className="pl-9"
            data-testid="task-search"
          />
        </div>
        {config.filters.map((filter) => {
          const { all, name, width } = FILTER_LABEL[filter]
          const select = selects[filter]
          const id = `task-${filter}-filter`
          return (
            <div key={filter} className={width}>
              <label htmlFor={id} className="sr-only">
                {name}
              </label>
              <OptionSelect
                id={id}
                options={[{ value: ALL, label: all }, ...select.options]}
                value={select.value}
                placeholder={all}
                onValueChange={(value) => select.onChange(value === ALL ? null : value)}
                data-testid={`${filter}-filter`}
              />
            </div>
          )
        })}
        {hasTaskInboxFilters(query) ? (
          <Button variant="ghost" onClick={clearFilters} data-testid="clear-task-filters">
            <X data-icon="inline-start" />
            Clear
          </Button>
        ) : null}
      </div>

      <section
        aria-label="Tasks"
        aria-busy={pending}
        className="relative overflow-hidden rounded-lg border border-border"
      >
        {pending ? (
          <div aria-hidden className="absolute inset-x-0 top-0 z-10 h-0.5 animate-pulse bg-primary" />
        ) : null}
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {columns.map((column) => (
                <TableHead key={column.id} className={cn(HEAD, column.className)}>
                  {column.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody className={pending ? "opacity-60 transition-opacity" : "transition-opacity"}>
            {page.rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length} className="py-10 text-center text-muted-foreground" data-testid="no-tasks">
                  No tasks match these filters.{" "}
                  <button type="button" onClick={clearFilters} className="underline underline-offset-4">
                    Clear
                  </button>
                </TableCell>
              </TableRow>
            ) : (
              page.rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="relative hover:bg-muted/50"
                  data-testid="task-row"
                  data-task-type={row.type}
                  data-overdue={row.overdue || undefined}
                  data-at-risk={row.atRisk || undefined}
                >
                  {columns.map((column) => (
                    <TableCell key={column.id} className={cn(column.className, column.cellClassName)}>
                      {column.cell(row, now)}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {showPagination(page.total) ? (
          <Pagination
            page={page.page}
            totalPages={page.totalPages}
            total={page.total}
            pageSize={page.pageSize}
            onPageChange={(next) => go({ ...query, page: next })}
            onPageSizeChange={(size) => go(withTaskInboxChange(query, { size: size as TaskInboxQuery["size"] }))}
          />
        ) : null}
      </section>
    </div>
  )
}
