# Invoice and pay slip PDFs

## 1. Purpose and assumptions

Two pure PDF generators in `src/server/documents/`: the client **invoice** (from the billing domain's `Invoice`, [billing-and-invoicing.md](./billing-and-invoicing.md) §6) and the employee **pay slip** (from `computeWithholding`, [payroll-withholding.md](./payroll-withholding.md)). They read nothing from the database or the clock beyond an optional `now`; plain data in, `Uint8Array` out. The same input and `now` give byte-identical PDFs. The layer that persists invoices and payroll runs maps its rows onto the input types below. Neither document is signed; they are not part of the e-signature flow ([documents-and-signing.md](./documents-and-signing.md)).

- Every amount is printed from **integer cents** with `formatCents` (`src/lib/format.ts`): `$1,234.50`, `$0.00`. A generator never recomputes billing or tax; it throws `DocumentInputError` (field-keyed `errors`) when the input does not reconcile.
- Letter size, shared helpers in `pdf-layout.ts` (fonts, colours, right-aligned and wrapped text, the page cursor `Flow`, footers). Long tables continue on further pages with a running header, the table header repeated and `Page n of N` in the footer. The pay slip uses the built-in Helvetica; the **invoice** is set in **Geist** (below). Text goes through `toWinAnsi` in both, so "李" prints as `?`.

## 2. Invoice

```ts
generateInvoicePdf(input: InvoicePdfInput): Promise<Uint8Array>

type InvoicePdfInput = {
  invoice: Invoice                                   // src/domain/billing/types.ts
  client: { name: string; addressLines?: string[] }  // bill-to
  person?: {                                         // who the invoice is for, payroll and deposit alike
    name: string; roleTitle?: string; workState?: string
    endDate?: string; endKind?: "terminated" | "fixed_term"
  }                                                  // omitted: the "For" block prints "Deposit"
  voidReason?: string | null                         // the stored reason, printed when void
  payments?: readonly Payment[]                      // any status; only the allocation to invoice.id is shown
  status?: InvoiceDisplayStatus                      // default: invoiceDisplayStatus(invoice, payments, today)
  today?: string                                     // YYYY-MM-DD, default: now in America/New_York
  now?: Date
}
```

- The PDF prints the same facts as the invoice page (`InvoiceDocument`, [client-finance.md](./client-finance.md) section 2a) and takes its words from `src/lib/invoice-lines.ts`, so the two cannot disagree. `src/server/invoice-document.ts` builds both from one query (`invoicePdfInputFromSource`).
- **Look.** The invoice is the page on paper (`src/server/documents/invoice-pdf.ts`): Geist Regular, Medium and SemiBold, embedded as subset TTFs from `assets/fonts/` (with `OFL-Geist.txt`, the SIL Open Font License) by `src/server/documents/geist.ts` through `@pdf-lib/fontkit`, with the `tnum` feature so every figure is tabular (Geist's digits are proportional by default). The palette is the neutral design tokens of `src/app/globals.css` converted to sRGB (near-black foreground, muted grey secondary text, hairline borders, a muted band and notes box); the status badge is the only tint, in the status tokens, and there are no decorative colours and no watermark. The sections come in the page's order: issuer, title, number and status; the amount band; Bill to, For and the facts; the lines; totals; payments; notes.
- Prints: Northwind letterhead and entity, `INVOICE`, the number and the status badge; a band with the amount due (or paid, or `$0.00` void) and its note ("Due Nov 18, 2026", "Overdue: was due …", "Paid in full on …", "Void: <reason>"); **Bill to**; **For** (name, job title, work location, service period, last day worked or fixed term end, "Prorated: 9 of 14 days"; no start date); issue date, due date, service period ("None (security deposit)" for a deposit), pay date and tax year. There is no terms fact and no "Please pay $X by <date>" sentence; the due date is a fact in the header, and the Pay button is on the page only.
- **Lines**: every stored invoice line is its own row (salary, each employer tax by name and rate or basis, benefits, workers' compensation, the EOR fee, one-time fees, and each component of a deposit), grouped Wages / Employer payroll taxes / Benefits / Northwind service fee, or Security deposit. Each line prints its title, a basis sentence in small type under it ("6.2% of $5,576.92 wages, annual wage base $184,500.00"), the Quantity and Rate columns and the amount; a group of several lines has a subtotal (a group of one line whose title equals the heading prints no heading). Titles and bases are derived from the line's stored `inputs` by `describeInvoiceLine`, never from the stored description. The rows add up to the total exactly (the quote equals the invoice). Then the total, payments received and amount due, kept together with the notes box so they do not strand alone on a page.
- **Status** is a badge (Due, Overdue, Processing, Paid, Void). A void invoice owes `$0.00`; a paid one shows the settled payments and `$0.00` due.
- **Payment history**: initiated date, settled date (a succeeded payment only; a failed one prints its reason and no settled date), method label (`ACH ••1234` for a bank account, `Visa ••4242` for a card), status (Processing, Settled, Failed with the reason) and the amount allocated to this invoice.
- **Notes**: paid, void and processing invoices say so, a void invoice names its reason, a deposit invoice adds the deposit note (billed once per hire, not credited automatically), and every invoice names who it is payable to. No bank details are invented and there is no pay-now sentence.
- Validation: lines must be integers and sum to `invoice.totalCents`.

## 3. Pay slip

```ts
generatePayslipPdf(input: PayslipInput, options?: { now?: Date }): Promise<Uint8Array>
payslipFromWithholding(stub: PayStubTaxes, context: PayslipContext): PayslipInput
```

`PayslipInput` (all cents, never negative; defined and documented in `payslip-pdf.ts`): `employer?`, `employee` (`name`, `ssn?`, `employeeId?`, `roleTitle?`, `workState?`), `period` (`start`, `end`, `payDate`), `hoursWorked?`, `paymentMethod?`, `earnings?` (default one "Regular wages" line), `gross`, `preTaxDeductions[]`, `taxableWages`, `taxes[]`, `postTaxDeductions[]`, `net`. `gross`, `taxableWages` and `net` are `{ currentCents, ytdCents }`; every line is `{ code?, label, currentCents, ytdCents }`.

- **Mapping.** `payslipFromWithholding` copies a `PayStubTaxes` one to one: gross, taxable wages (federal income tax wages), net and each line's year to date come from the stub. Tax and deduction lines that are zero this period and year to date (for example Additional Medicare below its threshold) are dropped. A payroll-run table that stores these lines can build `PayslipInput` directly.
- **SSN.** `employee.ssn` accepts any form (`123-45-6789`, digits, `***-**-6789`, last four). Only `***-**-NNNN` is ever written; the other digits never reach the PDF.
- Prints: employee, masked SSN, employer, pay period, pay date, a gross / taxes / deductions / net summary, then Earnings, Pre-tax deductions, Taxable wages, Taxes withheld (federal income tax, Social Security, Medicare, Additional Medicare, state income tax, state insurance lines), Post-tax deductions and Net pay, each with **This period** and **Year to date** columns.
- Validation: `gross − pre-tax − taxes − post-tax = net`; `earnings` (when given) sum to gross.

## 4. Verification

`pnpm vitest run src/server/documents/__tests__/invoice-pdf.test.ts src/server/documents/__tests__/payslip-pdf.test.ts` (text is extracted with `pdfjs-dist`). They prove: every line title and amount, each group subtotal and the total equal the input cents; header facts, the person's job title and work location, and the absence of terms, a start date and a pay sentence; the prorated and terminated notes; every `INVOICE_LINE_CODES` value as its own row with the amounts summing to the total; deposit variant (person, one row per component, no pay period); Geist embedded and tabular; multi-page overflow with headers and page numbers; paid, processing, overdue, open and void statuses and payment history including failed payments; only this invoice's share of a shared payment; SSN masking from four input forms; every pay slip amount current and YTD; zero lines omitted; reconciliation errors; determinism.

Visual check: `pnpm exec tsx scripts/sample-invoice-payslip-pdfs.mts /tmp/northwind-pdfs`, then `node scripts/render-pdf.mjs /tmp/northwind-pdfs/invoice-paid.pdf /tmp/northwind-pdfs/png 80`.

The seeded invoices through the real loader are checked in `src/server/__tests__/invoice-document.test.ts` (person, every line title and amount, and the total equal the page's). A full payroll invoice with benefits, a payment history and the notes is two pages; a standard one without a payment history fits on one.
