import Link from "next/link"
import { cn } from "cn"

import { buttonVariants } from "@/components/ui/button"
import type { GlanceCard } from "@/lib/client-home"

const FIGURE_TONE: Record<GlanceCard["tone"], string> = {
  default: "",
  danger: "text-status-danger-foreground",
  muted: "text-muted-foreground",
}

/**
 * The client Home's three glance cards (ui-guidelines C28): once the content is 42rem wide (a
 * container query, so the sidebar's width counts) two equal columns, Onboarding and At risk on the
 * first row and Invoices due across both below them; narrower, one bordered
 * list with a row per card, the figure on the right of its label. A card is one link: the
 * label is a stretched link over the whole card, named with the figure and label ("36 Onboarding,
 * view people"), so the card is a single tab stop with a visible focus ring. The Invoices card's
 * "View" is drawn as an outline button but is part of that link (`aria-hidden`, under the
 * stretched link), never a second control inside it.
 */
export function GlanceCards({ cards }: { cards: readonly GlanceCard[] }) {
  return (
    <div className="@container">
      <ul
        aria-label="At a glance"
        className="divide-y divide-border rounded-lg border border-border @2xl:grid @2xl:grid-cols-2 @2xl:gap-3 @2xl:divide-y-0 @2xl:border-0"
        data-testid="glance-cards"
      >
        {cards.map((card) => (
          <li
            key={card.id}
            className={cn(
              "group relative grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 px-4 py-3 transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-muted/60 @2xl:flex @2xl:flex-col @2xl:items-stretch @2xl:gap-1 @2xl:rounded-lg @2xl:border @2xl:border-border",
              card.id === "invoices" && "@2xl:col-span-2",
            )}
            data-testid="glance-card"
            data-card={card.id}
          >
            <Link
              href={card.href}
              aria-label={card.linkName}
              className="w-fit text-sm text-muted-foreground outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
            >
              {card.label}
            </Link>
            <div className="flex items-center justify-end gap-3 @2xl:min-h-8 @2xl:justify-between">
              <span className={cn("text-xl font-semibold tabular-nums @2xl:text-2xl", FIGURE_TONE[card.tone])} data-testid="glance-figure">
                {card.figure}
              </span>
              {card.view ? (
                <span aria-hidden className={cn(buttonVariants({ variant: "outline", size: "sm" }), "group-hover:bg-muted")} data-testid="glance-view">
                  View
                </span>
              ) : null}
            </div>
            {card.context ? (
              <p className="col-span-2 text-sm text-muted-foreground tabular-nums" data-testid="glance-context">
                {card.context}
                {card.alert ? (
                  <>
                    {" · "}
                    <span className="text-status-danger-foreground">{card.alert}</span>
                  </>
                ) : null}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
