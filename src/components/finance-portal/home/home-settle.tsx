"use client"

import { createContext, useContext, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"

import { SettleDialog, type SettleTarget } from "@/components/finance-portal/payment-actions"
import { Button } from "@/components/ui/button"
import { formatCents } from "@/lib/format"

type Settled = Pick<SettleTarget, "amountCents" | "companyName">

const SettledContext = createContext<{ settled: Settled | null; report: (payment: Settled) => void }>({
  settled: null,
  report: () => {},
})

/**
 * Holds what the last Settle on the Home settled, above the rows: the row leaves once the page
 * refreshes, so the line that says what happened lives here instead of in it.
 */
export function HomeSettleProvider({ children }: { children: ReactNode }) {
  const [settled, setSettled] = useState<Settled | null>(null)
  return <SettledContext.Provider value={{ settled, report: setSettled }}>{children}</SettledContext.Provider>
}

/** The quiet line after a Settle ("Settled $6,782.84 from Acme Robotics."); an empty live region before. */
export function HomeSettleStatus() {
  const { settled } = useContext(SettledContext)
  return (
    <p role="status" className="text-sm text-muted-foreground" data-testid="waiting-settled">
      {settled ? `Settled ${formatCents(settled.amountCents)} from ${settled.companyName.replace(/\.?$/, ".")}` : null}
    </p>
  )
}

/** A To do row's Settle: the same confirm as Payments, then the Home refreshes and the row leaves. */
export function HomeSettleButton({ payment }: { payment: SettleTarget }) {
  const router = useRouter()
  const { report } = useContext(SettledContext)
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        aria-label={`Settle ${formatCents(payment.amountCents)} from ${payment.companyName}`}
        data-testid="waiting-settle"
      >
        Settle
      </Button>
      <SettleDialog
        payment={open ? payment : null}
        onOpenChange={(next) => !next && setOpen(false)}
        onDone={() => {
          report(payment)
          router.refresh()
        }}
      />
    </>
  )
}
