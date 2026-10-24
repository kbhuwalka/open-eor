"use client"

import { useState, useTransition } from "react"
import { cn } from "cn"
import { CircleAlert, CircleCheck, Info, Play } from "lucide-react"

import { runBillingAction, type BillingRunSummary } from "@/app/finance/actions"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { describeRun, nothingToIssue, runButtonLabel, runFigures } from "@/lib/billing-run-view"
import { formatIsoDay } from "@/lib/finance-format"
import { formatCents } from "@/lib/format"
import type { ActionResult } from "@/server/action-result"
import type { BillingPreview } from "@/server/billing-preview"

type RunState = { ok: true; summary: BillingRunSummary } | { ok: false; message: string } | null

const plural = (n: number, one: string, many: string = `${one}s`) => `${n} ${n === 1 ? one : many}`

function Figure({ label, cents, count, strong, testId }: { label: string; cents: number; count: number; strong?: boolean; testId: string }) {
  return (
    <div className="flex flex-col gap-0.5 py-3 not-first:border-t not-first:border-border sm:px-5 sm:py-0 sm:not-first:border-t-0 sm:not-first:border-l sm:first:pl-0" data-testid={testId}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-lg tabular-nums", strong ? "font-semibold" : "font-medium")} data-testid={`${testId}-value`}>
        {formatCents(cents)}
      </span>
      <span className="text-xs text-muted-foreground tabular-nums">{count === 0 ? "None" : plural(count, "invoice")}</span>
    </div>
  )
}

/**
 * The Run card of the Billing run page: what Run billing would issue now (payroll, deposit, total
 * and the pay slips), the page's one primary button, and the outcome in place of the figures once
 * it ran. The run is idempotent: with nothing due the button is disabled, and a press on a stale
 * page that finds nothing left says so. A failure keeps the figures and offers Try again.
 */
export function BillingRunCard({
  preview,
  run = runBillingAction,
}: {
  preview: BillingPreview
  run?: () => Promise<ActionResult<BillingRunSummary>>
}) {
  const [state, setState] = useState<RunState>(null)
  const [pending, start] = useTransition()
  const would = preview.wouldIssue
  const figures = runFigures(would)
  const outcome = state?.ok ? describeRun(state.summary) : null

  function press() {
    start(async () => {
      try {
        const result = await run()
        setState(result.ok ? { ok: true, summary: result.data } : { ok: false, message: result.message })
      } catch {
        setState({ ok: false, message: "The billing run did not answer. Nothing may have been issued; check Recent issue dates before trying again." })
      }
    })
  }

  return (
    <section aria-labelledby="run-heading" aria-busy={pending} className="flex flex-col rounded-lg border border-border" data-testid="run-card">
      <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 id="run-heading" className="text-base font-medium">
            Due to issue
          </h3>
          <p className="text-sm text-muted-foreground">As of {formatIsoDay(preview.today)}</p>
        </div>
        <Button onClick={press} disabled={pending || would.count === 0} className="shrink-0" data-testid="run-billing">
          <Play data-icon="inline-start" />
          {pending ? "Running…" : runButtonLabel(would.count)}
        </Button>
      </header>
      <div className="flex flex-col gap-4 px-5 py-4">
        {outcome ? (
          <div role="status" className="flex items-start gap-2.5" data-testid="run-result" data-issued={outcome.issued}>
            {outcome.issued ? (
              <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-status-success-foreground" />
            ) : (
              <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            )}
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-medium" data-testid="run-result-text">
                {outcome.headline}
              </p>
              {outcome.detail ? <p className="text-xs text-muted-foreground">{outcome.detail}</p> : null}
            </div>
          </div>
        ) : would.count === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="would-issue-summary">
            {nothingToIssue(preview.today)}
          </p>
        ) : (
          <div className="flex flex-col gap-3" data-testid="would-issue-summary">
            <div className="grid sm:grid-cols-3">
              <Figure label="Payroll invoices" cents={figures.payroll.cents} count={figures.payroll.count} testId="figure-payroll" />
              <Figure label="Deposit invoices" cents={figures.deposit.cents} count={figures.deposit.count} testId="figure-deposit" />
              <Figure label="Total" cents={figures.total.cents} count={figures.total.count} strong testId="figure-total" />
            </div>
            <p className="text-xs text-muted-foreground" data-testid="figure-payslips">
              {figures.payslips === 0 ? "No pay slips: deposit invoices have none." : `Creates ${plural(figures.payslips, "pay slip")}, one behind each payroll invoice.`}
            </p>
          </div>
        )}
        {state && !state.ok ? (
          <Alert variant="destructive" data-testid="run-error">
            <CircleAlert aria-hidden />
            <AlertTitle>Billing run failed</AlertTitle>
            <AlertDescription>
              <p>{state.message}</p>
              <Button variant="outline" size="sm" className="mt-2" onClick={press} disabled={pending} data-testid="run-retry">
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
      </div>
    </section>
  )
}
