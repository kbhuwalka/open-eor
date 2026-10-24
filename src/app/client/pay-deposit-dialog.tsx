"use client"

import { useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FieldError } from "@/components/ui/field"
import { SummaryCard, SummaryRow } from "@/components/summary-card"
import { formatCents } from "@/lib/format"
import type { TaskDialogProps } from "@/components/tasks/task-dialogs"

import { payDepositTask } from "./actions"

/**
 * The `pay_deposit` dialog for the client's home panel (`TASK_DIALOGS`): confirm the amount, pay with
 * the company's saved bank account. Northwind Finance then confirms it settled.
 */
export function PayDepositDialog({ row, open, onOpenChange, onDone }: TaskDialogProps) {
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const amount = typeof row.context.amountCents === "number" ? row.context.amountCents : null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        if (next) setError(null)
        onOpenChange(next)
      }}
    >
      <DialogContent data-testid="pay-deposit-dialog">
        <DialogHeader>
          <DialogTitle>Pay the deposit for {row.personName}</DialogTitle>
          <DialogDescription>
            {row.description} Northwind confirms the payment once it settles.
          </DialogDescription>
        </DialogHeader>
        <SummaryCard>
          <SummaryRow label="Person">{row.personName}</SummaryRow>
          <SummaryRow label="Pay from">Your saved bank account</SummaryRow>
          {amount === null ? null : (
            <SummaryRow label="Deposit" strong>
              {formatCents(amount)}
            </SummaryRow>
          )}
        </SummaryCard>
        <FieldError>{error}</FieldError>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={pending} />}>Cancel</DialogClose>
          <Button
            disabled={pending}
            data-testid="confirm-pay-deposit"
            onClick={() =>
              start(async () => {
                const result = await payDepositTask(row.caseId, row.id)
                if (result.ok) onDone()
                else setError(result.message)
              })
            }
          >
            {pending ? "Paying…" : amount === null ? "Pay deposit" : `Pay ${formatCents(amount)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
