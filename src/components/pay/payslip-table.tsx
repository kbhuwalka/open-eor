import Link from "next/link"
import { Download } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { formatCents } from "@/lib/format"
import { formatPayPeriod, type PayslipSummaryRow } from "@/lib/payslip-view"

import type { PayHrefs } from "./hrefs"

const HEAD = "text-xs font-medium tracking-wide text-muted-foreground uppercase"

/**
 * Pay slips of one year: pay period, gross pay, net pay and an icon-only download. The period is a
 * stretched link, so the whole row opens the slip; the download sits above it and never navigates.
 */
export function PayslipTable({ rows, hrefs }: { rows: PayslipSummaryRow[]; hrefs: PayHrefs }) {
  return (
    <section aria-label="Pay slips" className="overflow-hidden rounded-lg border border-border" data-testid="payslip-table">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={HEAD}>Pay period</TableHead>
            <TableHead className={`${HEAD} text-right`}>Gross pay</TableHead>
            <TableHead className={`${HEAD} text-right`}>Net pay</TableHead>
            <TableHead className="w-px">
              <span className="sr-only">Download</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const period = formatPayPeriod(row.payPeriodStart, row.payPeriodEnd)
            return (
              <TableRow key={row.id} className="relative" data-testid="payslip-row">
                <TableCell>
                  <Link
                    href={hrefs.slip(row.id)}
                    className="font-medium tabular-nums outline-none after:absolute after:inset-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
                  >
                    {period}
                  </Link>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatCents(row.grossCents)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{formatCents(row.netCents)}</TableCell>
                <TableCell className="text-right">
                  <a
                    href={hrefs.pdf(row.id)}
                    download
                    aria-label={`Download pay slip for ${period}`}
                    title="Download pay slip"
                    className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "relative z-10")}
                  >
                    <Download aria-hidden />
                  </a>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </section>
  )
}
