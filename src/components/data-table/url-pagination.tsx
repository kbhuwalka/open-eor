"use client"

import { useTransition } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { Pagination } from "@/components/data-table/pagination"
import { DEFAULT_PAGE_SIZE, showPagination } from "@/lib/pagination"

/**
 * The shared pagination bar for a server-rendered list whose page lives in the URL (`?page=` and
 * `?size=`, or `?<prefix>page` for a second list on the same screen). It keeps every other query
 * parameter, leaves defaults out of the URL, goes back to page 1 when the size changes and renders
 * nothing while the list fits on one page of the smallest size (ui-guidelines C11).
 */
export function UrlPagination({
  page,
  totalPages,
  total,
  pageSize,
  prefix = "",
}: {
  page: number
  totalPages: number
  total: number
  pageSize: number
  prefix?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const [, startTransition] = useTransition()

  if (!showPagination(total)) return null

  function go(next: { page: number; size: number }) {
    const params = new URLSearchParams(search.toString())
    if (next.page > 1) params.set(`${prefix}page`, String(next.page))
    else params.delete(`${prefix}page`)
    if (next.size !== DEFAULT_PAGE_SIZE) params.set(`${prefix}size`, String(next.size))
    else params.delete(`${prefix}size`)
    const text = params.toString()
    startTransition(() => router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false }))
  }

  return (
    <Pagination
      page={page}
      totalPages={totalPages}
      total={total}
      pageSize={pageSize}
      onPageChange={(next) => go({ page: next, size: pageSize })}
      onPageSizeChange={(size) => go({ page: 1, size })}
    />
  )
}
