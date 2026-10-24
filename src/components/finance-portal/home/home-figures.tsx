import Link from "next/link"
import { cn } from "cn"

import { FigureAmount, FigureDot } from "@/components/finance-portal/figure-amount"
import { homeFigures } from "@/lib/finance-home-view"
import type { FinanceOverview } from "@/server/finance-portal-queries"

const LINK = "rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"

/**
 * The one quiet line under the Home's title (ui-guidelines C33): what is to settle, what is
 * overdue and what is ready to bill (or when billing is next), each a link to its page. Overdue is
 * the only danger figure on the page; a figure with nothing behind it reads as a plain sentence.
 * Filtered to one client (`client`), the figures and the links to Payments and Receivables are that client's.
 */
export function HomeFigures({ overview, client = null }: { overview: FinanceOverview; client?: string | null }) {
  return (
    <ul className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-sm" aria-label="What needs Finance" data-testid="home-figures">
      {homeFigures(overview, client).map((figure, index) => (
        <li key={figure.key} className="flex items-baseline gap-2.5" data-testid={`figure-${figure.key}`}>
          {index > 0 ? <FigureDot /> : null}
          <Link href={figure.href} className={cn(LINK, figure.danger ? "text-status-danger-foreground" : "text-muted-foreground")} data-testid={`figure-${figure.key}-link`}>
            {figure.amountCents !== null ? (
              <>
                <FigureAmount cents={figure.amountCents} className={figure.danger ? undefined : "text-foreground"} testId={`figure-${figure.key}-amount`} />{" "}
              </>
            ) : null}
            <span data-testid={`figure-${figure.key}-text`}>{figure.text}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
