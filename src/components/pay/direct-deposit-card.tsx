import { Landmark } from "lucide-react"

import { SummaryCard, SummaryRow } from "@/components/summary-card"
import type { PayDirectDeposit } from "@/lib/payslip-view"

/** Read-only account the net pay is deposited to: type and last four digits only. */
export function DirectDepositCard({ directDeposit }: { directDeposit: PayDirectDeposit | null }) {
  return (
    <section aria-labelledby="direct-deposit-heading" className="flex flex-col gap-3" data-testid="direct-deposit-card">
      <h3 id="direct-deposit-heading" className="text-lg font-medium">
        Direct deposit
      </h3>
      <SummaryCard>
        <SummaryRow
          label={
            <span className="flex items-center gap-2">
              <Landmark aria-hidden className="size-4 text-muted-foreground" />
              Net pay is deposited to
            </span>
          }
          strong
        >
          {directDeposit ? <span data-testid="direct-deposit-label">{directDeposit.label}</span> : <span className="text-muted-foreground">No account on file</span>}
        </SummaryRow>
      </SummaryCard>
      {directDeposit ? (
        <p className="text-xs text-muted-foreground">Only the account type and the last four digits are shown.</p>
      ) : null}
    </section>
  )
}
