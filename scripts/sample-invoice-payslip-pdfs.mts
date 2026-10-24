// Dev helper: write sample invoice and pay slip PDFs for visual inspection.
// Usage: pnpm exec tsx scripts/sample-invoice-payslip-pdfs.mts [outDir=/tmp/northwind-pdfs]
//   node scripts/render-pdf.mjs <outDir>/<file>.pdf <outDir>/png 80
import fs from "node:fs"
import path from "node:path"

import { generateInvoicePdf } from "../src/server/documents/invoice-pdf"
import { generatePayslipPdf } from "../src/server/documents/payslip-pdf"
import {
  declinedInvoice,
  depositInvoice,
  invoiceInput,
  manyLines,
  payment,
  payrollInvoice,
  payslipInput,
  withholding,
} from "../src/server/documents/__tests__/invoice-payslip-fixtures"

const outDir = process.argv[2] ?? "/tmp/northwind-pdfs"
fs.mkdirSync(outDir, { recursive: true })

async function write(name: string, bytes: Promise<Uint8Array>) {
  const file = path.join(outDir, `${name}.pdf`)
  fs.writeFileSync(file, await bytes)
  console.log(file)
}

const open = payrollInvoice()
const paid = payrollInvoice()
await write("invoice-open", generateInvoicePdf(invoiceInput(open)))
await write("invoice-overdue", generateInvoicePdf(invoiceInput(open, { today: "2026-12-01" })))
await write("invoice-paid", generateInvoicePdf(invoiceInput(paid, { payments: [payment(paid)] })))
await write(
  "invoice-processing",
  generateInvoicePdf(
    invoiceInput(open, { payments: [payment(open, { status: "initiated", settledAt: null })] }),
  ),
)
await write(
  "invoice-void",
  generateInvoicePdf(
    invoiceInput({ ...open, status: "void" }, {
      payments: [
        payment(open, { id: "pay_0", status: "failed", settledAt: null, failureReason: "Insufficient funds" }),
      ],
    }),
  ),
)
await write("invoice-deposit", generateInvoicePdf(invoiceInput(depositInvoice())))
await write("invoice-declined-benefits", generateInvoicePdf(invoiceInput(declinedInvoice())))
await write("invoice-long", generateInvoicePdf(invoiceInput(manyLines(70), { payments: [payment(manyLines(70))] })))
await write("payslip-ca", generatePayslipPdf(payslipInput(), { now: new Date("2026-10-24T16:00:00Z") }))
await write(
  "payslip-tx-minimal",
  generatePayslipPdf(payslipInput(withholding({ workState: "TX", preTaxDeductions: undefined, postTaxDeductions: undefined })), {
    now: new Date("2026-10-24T16:00:00Z"),
  }),
)
