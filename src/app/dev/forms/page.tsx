import { Suspense } from "react"
import { notFound } from "next/navigation"

import { PageHeader } from "@/components/page-header"
import { ThemeRoot } from "@/components/theme-root"

import { FormsShowcase } from "./showcase"

/**
 * Dev-only showcase of the signing and tax-form building blocks. The server actions fill and sign
 * real PDFs from the submitted data and return them; nothing is stored. Returns 404 in production.
 */
export default function DevFormsPage() {
  if (process.env.NODE_ENV === "production") notFound()
  return (
    <Suspense fallback={<main className="p-8 text-sm text-muted-foreground">Loading…</main>}>
      <DevForms />
    </Suspense>
  )
}

async function DevForms() {
  return (
    <ThemeRoot>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-10">
        <PageHeader
          title="Signing and forms"
          description="Typed-name e-signature, the official W-4 and I-9, direct deposit and the employment agreement."
        />
        <FormsShowcase />
      </div>
    </ThemeRoot>
  )
}
