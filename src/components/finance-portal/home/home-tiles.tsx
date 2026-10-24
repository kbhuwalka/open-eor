import Link from "next/link"
import { cn } from "cn"

import { buttonVariants } from "@/components/ui/button"
import { homeTiles, type HomeTile } from "@/lib/finance-home-view"
import type { FinanceOverview } from "@/server/finance-portal-queries"

const CELL =
  "group/tile relative flex min-w-0 flex-col gap-1 px-5 py-4 transition-colors hover:bg-muted/50 has-[[data-tile-link]:focus-visible]:bg-muted/50 not-first:border-t not-first:border-border lg:not-first:border-t-0 lg:not-first:border-l"

function Tile({ tile }: { tile: HomeTile }) {
  const contextId = `home-tile-${tile.key}-context`
  return (
    <li className={CELL} data-testid={`tile-${tile.key}`}>
      <span aria-hidden className="text-xs font-medium text-muted-foreground">
        {tile.label}
      </span>
      <Link
        href={tile.href}
        aria-describedby={contextId}
        className={cn(
          "text-lg font-semibold tabular-nums outline-none after:absolute after:inset-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50 focus-visible:after:ring-inset",
          tile.valueDanger && "text-status-danger-foreground",
        )}
        data-tile-link
        data-testid={`tile-${tile.key}-link`}
      >
        <span className="sr-only">{tile.label}:</span>{" "}
        <span data-testid={`tile-${tile.key}-value`}>{tile.value}</span>
      </Link>
      <span
        id={contextId}
        className={cn("text-xs", tile.contextDanger ? "text-status-danger-foreground" : "text-muted-foreground")}
        data-testid={`tile-${tile.key}-context`}
        data-late={tile.contextDanger || undefined}
      >
        {tile.context}
      </span>
      <span className="mt-1 flex h-8 items-center">
        {tile.actionButton ? (
          <Link
            href={tile.href}
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "relative z-10 -ml-3")}
            data-testid="tile-run-billing"
          >
            {tile.action}
          </Link>
        ) : (
          <span aria-hidden className="text-sm font-medium underline-offset-4 group-hover/tile:underline">
            {tile.action}
          </span>
        )}
      </span>
    </li>
  )
}

/**
 * The Home's three action tiles (ui-guidelines C33): To settle, Overdue and Ready to bill in one
 * bordered card divided by hairlines, side by side from `lg` and a vertical list below it. Each tile
 * is a stretched link to its page; Ready to bill adds a ghost "Run billing" to Billing run while
 * something is ready.
 */
export function HomeTiles({ overview }: { overview: FinanceOverview }) {
  return (
    <ul className="grid overflow-hidden rounded-lg border border-border lg:grid-cols-3" aria-label="What needs Finance" data-testid="home-tiles">
      {homeTiles(overview).map((tile) => (
        <Tile key={tile.key} tile={tile} />
      ))}
    </ul>
  )
}
