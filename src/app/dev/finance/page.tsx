import { Suspense } from "react"
import { notFound } from "next/navigation"

import { PageHeader } from "@/components/page-header"
import { ThemeRoot } from "@/components/theme-root"

import { FinanceShowcase } from "./showcase"

/**
 * Dev-only review page for the client finance components, populated from the real billing domain
 * so the visuals can be checked before invoices are persisted. Nothing is stored. 404 in production.
 */
export default function DevFinancePage() {
  if (process.env.NODE_ENV === "production") notFound()
  return (
    <Suspense fallback={<main className="p-8 text-sm text-muted-foreground">Loading…</main>}>
      <DevFinance />
    </Suspense>
  )
}

async function DevFinance() {
  return (
    <ThemeRoot>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-10">
        <PageHeader
          title="Finance"
          description="Client finance components over fixtures from the billing domain (dev only)."
        />
        <FinanceShowcase />
      </div>
    </ThemeRoot>
  )
}
