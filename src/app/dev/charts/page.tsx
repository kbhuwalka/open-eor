import { Suspense } from "react"
import { notFound } from "next/navigation"

import { PageHeader } from "@/components/page-header"
import { ThemeRoot } from "@/components/theme-root"

import { ChartsShowcase } from "./showcase"

/**
 * Dev-only review page for the Finance charts over fixtures (nothing is read or stored). 404 in
 * production like the other `/dev` pages, unless `DEV_SHOWCASE=1` is set to review the charts on a
 * production server. The check runs both when the shell is prerendered and when the request fills
 * in the dynamic part, so the variable must be set for `next build` and for `next start`.
 */
export default function DevChartsPage() {
  if (process.env.NODE_ENV === "production" && process.env.DEV_SHOWCASE !== "1") notFound()
  return (
    <Suspense fallback={<main className="p-8 text-sm text-muted-foreground">Loading…</main>}>
      <DevCharts />
    </Suspense>
  )
}

async function DevCharts() {
  return (
    <ThemeRoot>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-10">
        <PageHeader title="Charts" description="Finance chart components over fixtures typed as the read models (dev only)." />
        <ChartsShowcase />
      </div>
    </ThemeRoot>
  )
}
