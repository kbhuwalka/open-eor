"use client"

import { useTransition, type ReactNode } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

/**
 * Year selector for the pay slip list: the standard tabs (ui-guidelines C13) with the year in the
 * URL (`?year=2026`) so the server renders the right slips and the selection survives a reload.
 * Other query parameters are kept. With a single year there is nothing to choose, so no tab list.
 */
export function PayYearTabs({
  years,
  selectedYear,
  children,
}: {
  years: number[]
  selectedYear: number
  children: ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  if (years.length < 2) return <>{children}</>

  function select(value: unknown) {
    const next = new URLSearchParams(searchParams.toString())
    next.set("year", String(value))
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }))
  }

  return (
    <Tabs value={String(selectedYear)} onValueChange={select} data-testid="pay-year-tabs">
      <TabsList aria-label="Tax year">
        {years.map((year) => (
          <TabsTrigger key={year} value={String(year)} data-testid={`year-tab-${year}`}>
            {year}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent
        value={String(selectedYear)}
        aria-busy={pending}
        className={pending ? "opacity-60 transition-opacity" : "transition-opacity"}
      >
        {children}
      </TabsContent>
    </Tabs>
  )
}
