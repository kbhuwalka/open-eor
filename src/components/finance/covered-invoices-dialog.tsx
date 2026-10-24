"use client"

import type * as React from "react"

import { MoneyCell } from "@/components/finance/money-cell"
import { PaymentStatusBadge } from "@/components/finance/invoice-status-badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import type { CoveredInvoiceItem, CoveredPayment } from "@/lib/covered-invoices"
import { formatIsoDay } from "@/lib/finance-format"
import { formatCents } from "@/lib/format"

export type CoveredInvoicesProps = {
  items: readonly CoveredInvoiceItem[]
  payment: CoveredPayment
  /** Said before "Covers N invoices", for a list that spans clients ("Acme Robotics"). */
  context?: string
}

const LINK = "rounded-sm font-medium whitespace-nowrap underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
const ROW = "flex items-start justify-between gap-4 rounded-md px-2 py-2"

/**
 * The invoices a payment covers, in one table cell, for the client Payments tab and the Finance
 * payments list alike. One invoice is its number, a new-tab link when it has an `href`; several are
 * a text button "3 invoices" that opens `CoveredInvoicesDialog` instead of a growing row of links.
 */
export function CoveredInvoices({ items, payment, context }: CoveredInvoicesProps) {
  if (items.length > 1) return <CoveredInvoicesDialog items={items} payment={payment} context={context} />
  return (
    <>
      {items.map((item) =>
        item.href ? (
          <a key={item.id} href={item.href} target="_blank" rel="noopener noreferrer" className={LINK} data-testid="payment-invoice">
            {item.number}
          </a>
        ) : (
          <span key={item.id} className="font-medium whitespace-nowrap" data-testid="payment-invoice">
            {item.number}
          </span>
        ),
      )}
    </>
  )
}

/**
 * A payment's invoices in a small dialog: the payment (amount, day, status) in the title, then one
 * row per invoice with its person and title, its period (or "Deposit") and its amount. A row with an
 * `href` is one link to the invoice in a new tab (the whole row, a normal tab stop with a focus
 * ring); Escape closes the dialog and focus returns to the button.
 */
export function CoveredInvoicesDialog({ items, payment, context }: CoveredInvoicesProps) {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="link" className="h-auto p-0 font-medium" data-testid="payment-invoices-trigger" />}>
        {items.length} invoices
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg" data-testid="payment-invoices-dialog">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="payment-invoices-title">
            <span>Payment of {formatCents(payment.amountCents)}</span>
            <span className="font-normal text-muted-foreground">{formatIsoDay(payment.initiatedAt)}</span>
            <PaymentStatusBadge status={payment.status} />
          </DialogTitle>
          <DialogDescription>
            {context ? `${context}. ` : ""}Covers {items.length} invoices. Each one opens in a new tab.
          </DialogDescription>
        </DialogHeader>
        <ul className="-mx-2 flex max-h-80 flex-col overflow-y-auto" data-testid="payment-invoices-list">
          {items.map((item) => (
            <li key={item.id}>
              <Row href={item.href}>
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium" data-testid="payment-invoice-number">
                    {item.number}
                  </span>
                  {item.personName ? (
                    <span className="text-muted-foreground" data-testid="payment-invoice-person">
                      {item.personName}
                      {item.personTitle ? <span className="text-xs"> · {item.personTitle}</span> : null}
                    </span>
                  ) : null}
                  {item.periodLabel ? (
                    <span className="text-xs text-muted-foreground tabular-nums" data-testid="payment-invoice-period">
                      {item.periodLabel}
                    </span>
                  ) : null}
                </span>
                {item.amountCents != null ? <MoneyCell cents={item.amountCents} className="shrink-0 font-medium" /> : null}
              </Row>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

function Row({ href, children }: { href: string | undefined; children: React.ReactNode }) {
  if (!href) {
    return (
      <div className={ROW} data-testid="payment-invoice">
        {children}
      </div>
    )
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`${ROW} outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50`}
      data-testid="payment-invoice"
    >
      {children}
    </a>
  )
}
