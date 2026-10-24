"use client"

/**
 * The one right-hand drawer of the product (ui-guidelines C45). It owns the frame every drawer
 * shares: a full-height panel on the right edge, a FIXED header (an optional back button and
 * "N of M" stepper, the title with its status, a muted subtitle, and the actions, primary first)
 * and a body that scrolls underneath it. There is no button bar at the bottom and no Close button:
 * the dialog's corner X, Escape and a click outside close it.
 *
 * It owns no data and no loading: callers render `DrawerHeader` and `DrawerBody` inside
 * `DrawerShell`, keyed by what is shown, and use `DrawerSkeleton` and `DrawerLoadError` for the two
 * states a loading body has. Swapping what a drawer shows (a payment, then one of its invoices)
 * swaps the children of one shell; drawers never stack.
 */

import type { ReactNode, Ref } from "react"
import { cn } from "cn"
import { ChevronDown, ChevronLeft, ChevronUp, CircleAlert } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export const DRAWER_WIDTHS = ["md", "lg", "2xl"] as const
export type DrawerWidth = (typeof DRAWER_WIDTHS)[number]

const WIDTH_CLASS: Record<DrawerWidth, string> = {
  md: "sm:max-w-md",
  lg: "sm:max-w-lg",
  "2xl": "sm:max-w-2xl",
}

/** Where the shown item sits in the list the drawer was opened from; `index` is zero-based. */
export type DrawerPosition = { index: number; total: number }

export type DrawerShellProps = {
  open: boolean
  onClose: () => void
  /** `md` for a record, `lg` for a record with a wide table, `2xl` for side-by-side content (a document and a form). */
  width?: DrawerWidth
  children: ReactNode
  "data-testid"?: string
}

/**
 * The drawer frame. `initialFocus={false}` keeps the focus ring off the first control (a chevron)
 * when it opens; Tab still enters the drawer and focus returns to the opener on close.
 */
export function DrawerShell({ open, onClose, width = "md", children, "data-testid": testId }: DrawerShellProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        data-testid={testId}
        initialFocus={false}
        className={cn(
          "inset-y-0 top-0 right-0 left-auto flex h-dvh max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0",
          WIDTH_CLASS[width],
        )}
      >
        {open ? <div className="flex min-h-0 flex-1 flex-col">{children}</div> : null}
      </DialogContent>
    </Dialog>
  )
}

export type DrawerHeaderProps = {
  title: ReactNode
  /** A status badge beside the title. */
  status?: ReactNode
  /** One muted line under the title: what the record is ("Payroll invoice"). */
  subtitle?: ReactNode
  /** An optional further line (timing, a warning) under the subtitle. */
  meta?: ReactNode
  /** The actions, primary first, on one row. Utility actions are `DrawerIconAction`s after it. */
  actions?: ReactNode
  /** For a body that portals its own actions into the header (the specialist panels). */
  actionsRef?: Ref<HTMLDivElement>
  /** Previous and Next through the list the drawer was opened from. */
  stepper?: DrawerStepperProps
  /** Back to what the drawer showed before it swapped content ("Payment of $1,200.00"). */
  back?: { label: string; onBack: () => void }
  titleTestId?: string
}

/** The fixed header. It never scrolls and never wraps its actions onto a second row. */
export function DrawerHeader({ title, status, subtitle, meta, actions, actionsRef, stepper, back, titleTestId }: DrawerHeaderProps) {
  const topRow = Boolean(back || stepper)
  return (
    <header className="flex shrink-0 flex-col gap-4 border-b border-border px-6 pt-5 pb-4" data-testid="drawer-header">
      {topRow ? (
        <div className="-mt-1 flex min-w-0 items-center gap-1 pr-8">
          {back ? (
            <Button variant="ghost" size="sm" className="-ml-2 min-w-0" onClick={back.onBack} data-testid="drawer-back">
              <ChevronLeft data-icon="inline-start" />
              <span className="truncate">{back.label}</span>
            </Button>
          ) : null}
          {stepper ? <DrawerStepper {...stepper} /> : null}
        </div>
      ) : null}
      <div className={cn("flex items-start justify-between gap-4", !topRow && "pr-8")}>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <DialogTitle className="text-base" data-testid={titleTestId}>
              {title}
            </DialogTitle>
            {status}
          </div>
          {subtitle ? <DialogDescription>{subtitle}</DialogDescription> : null}
          {meta}
        </div>
        <div ref={actionsRef} className="flex shrink-0 flex-nowrap items-center gap-2" data-testid="drawer-actions">
          {actions}
        </div>
      </div>
    </header>
  )
}

export type DrawerStepperProps = {
  position: DrawerPosition
  onStep: (delta: -1 | 1) => void
  /** What is being stepped through, for the buttons' names: "invoice" reads "Previous invoice". */
  noun: string
}

/** "3 of 12" with Previous and Next chevrons, disabled at either end. */
export function DrawerStepper({ position, onStep, noun }: DrawerStepperProps) {
  return (
    <div className="ml-auto flex items-center gap-1 first:ml-0" data-testid="drawer-stepper">
      <span className="mr-1 text-xs text-muted-foreground tabular-nums" data-testid="drawer-position">
        {position.index + 1} of {position.total}
      </span>
      <Button variant="ghost" size="icon-sm" aria-label={`Previous ${noun}`} disabled={position.index <= 0} onClick={() => onStep(-1)}>
        <ChevronUp />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Next ${noun}`}
        disabled={position.index >= position.total - 1}
        onClick={() => onStep(1)}
      >
        <ChevronDown />
      </Button>
    </div>
  )
}

/**
 * A utility action in the header (Download PDF): an icon-only outline link the height of the
 * primary button, named by `label` for assistive technology and shown as a tooltip on hover and
 * focus. The tooltip opens below, so it never covers the dialog's corner X.
 */
export function DrawerIconAction({
  href,
  label,
  icon,
  download = false,
  testId,
}: {
  href: string
  label: string
  icon: ReactNode
  download?: boolean
  testId?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<a href={href} download={download || undefined} />}
        aria-label={label}
        className={buttonVariants({ variant: "outline", size: "icon" })}
        data-testid={testId}
      >
        {icon}
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

/** The scrolling area under the header; its content is one padded column. */
export function DrawerBody({ children, "data-testid": testId }: { children: ReactNode; "data-testid"?: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid={testId ?? "drawer-scroll"}>
      <div className="flex flex-col gap-6 px-6 py-6">{children}</div>
    </div>
  )
}

/** A record's facts as one compact two-column block (label muted on the left), never a bordered card. */
export function DrawerFacts({ children, "data-testid": testId }: { children: ReactNode; "data-testid"?: string }) {
  return (
    <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm" data-testid={testId}>
      {children}
    </dl>
  )
}

export function DrawerFact({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0" data-testid={testId}>
        {children}
      </dd>
    </>
  )
}

/** A small muted subhead inside the body, with an optional figure on the right (a subtotal). */
export function DrawerSubhead({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-xs font-medium text-muted-foreground">
      <h3>{children}</h3>
      {aside}
    </div>
  )
}

/** What a body shows while its record loads. */
export function DrawerSkeleton({ testId = "drawer-loading" }: { testId?: string }) {
  return (
    <div className="flex flex-col gap-3" aria-busy data-testid={testId}>
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  )
}

/**
 * A body that could not load says what is missing and offers Try again; it never shows a partial
 * record as if it were whole.
 */
export function DrawerLoadError({
  title,
  children,
  onRetry,
  testId = "drawer-error",
  retryTestId = "drawer-retry",
}: {
  title: string
  children?: ReactNode
  onRetry: () => void
  testId?: string
  retryTestId?: string
}) {
  return (
    <Alert variant="destructive" data-testid={testId}>
      <CircleAlert aria-hidden />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        {children}
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry} data-testid={retryTestId}>
          Try again
        </Button>
      </AlertDescription>
    </Alert>
  )
}
