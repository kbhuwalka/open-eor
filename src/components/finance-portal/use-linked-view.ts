"use client"

import { useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import type { StaffDrawerView } from "@/lib/finance-staff-view"

/**
 * The drawer's view on a Finance list, seeded from the page's `?open=` deep link. A new link while
 * the page is open opens that record; closing the drawer drops `?open=` so a reload does not
 * reopen it, and writes `keep` (state the link implied, such as the tab that lists the record) so
 * the list behind the drawer stays as it is. Opening a row changes no URL (its link carries
 * `?open=` for a new tab).
 */
export function useLinkedView(
  linked: StaffDrawerView | null,
  keep: Record<string, string> = {},
): [StaffDrawerView | null, (view: StaffDrawerView | null) => void] {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const linkedKey = linked ? `${linked.kind}:${linked.id}` : null
  const [view, setView] = useState(linked)
  const [seen, setSeen] = useState(linkedKey)
  if (linkedKey !== seen) {
    setSeen(linkedKey)
    if (linked) setView(linked)
  }

  function change(next: StaffDrawerView | null) {
    setView(next)
    if (next === null && search.has("open")) {
      const params = new URLSearchParams(search.toString())
      params.delete("open")
      for (const [key, value] of Object.entries(keep)) params.set(key, value)
      const text = params.toString()
      router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false })
    }
  }

  return [view, change]
}
