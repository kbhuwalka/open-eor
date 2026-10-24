import { Suspense } from "react"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { InvoiceDocumentSkeleton } from "@/components/finance/invoice-document"

import { InvoiceView, type InvoiceParams } from "./invoice-view"

export default function InvoicePage({ params }: { params: InvoiceParams }) {
  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/client/finance"
        className="inline-flex w-fit items-center gap-1.5 rounded-sm text-sm text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 print:hidden"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back to Finance
      </Link>
      <Suspense fallback={<InvoiceDocumentSkeleton />}>
        <InvoiceView params={params} />
      </Suspense>
    </div>
  )
}
