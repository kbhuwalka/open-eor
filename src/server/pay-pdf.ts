/**
 * Adapter between the pay dashboard and the pay slip PDF generator (`src/server/documents`).
 * The `PayslipInput` mapping lives in this file so the generator never sees a view-model.
 */

import { generatePayslipPdf, type PayslipInput } from "@/server/documents"
import type { PayslipDetail } from "@/lib/payslip-view"

export type PayslipPdf = { bytes: Uint8Array; filename: string }

export function payslipInputFromDetail(detail: PayslipDetail): PayslipInput {
  const line = (l: { code?: string; label: string; currentCents: number; ytdCents: number }) => ({
    code: l.code,
    label: l.label,
    currentCents: l.currentCents,
    ytdCents: l.ytdCents,
  })
  return {
    employer: detail.employerName ? { name: detail.employerName } : undefined,
    employee: {
      name: detail.employee.name,
      ssn: detail.employee.ssnMasked,
      employeeId: detail.employee.employeeId,
      roleTitle: detail.employee.roleTitle,
      workState: detail.employee.workState,
    },
    period: { start: detail.payPeriodStart, end: detail.payPeriodEnd, payDate: detail.payDate },
    hoursWorked: detail.hoursWorked,
    paymentMethod: detail.paymentMethod ?? undefined,
    earnings: detail.earnings.map(line),
    gross: detail.gross,
    preTaxDeductions: detail.preTaxDeductions.map(line),
    taxableWages: detail.taxableWages,
    taxes: detail.taxes.map(line),
    postTaxDeductions: detail.postTaxDeductions.map(line),
    net: detail.net,
  }
}

export function payslipPdfFilename(detail: Pick<PayslipDetail, "payDate">): string {
  return `payslip-${detail.payDate}.pdf`
}

export async function renderPayslipPdf(detail: PayslipDetail, options: { now?: Date } = {}): Promise<PayslipPdf> {
  return { bytes: await generatePayslipPdf(payslipInputFromDetail(detail), options), filename: payslipPdfFilename(detail) }
}
