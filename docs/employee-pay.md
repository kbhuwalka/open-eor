# Employee pay dashboard

## 1. Purpose and assumptions

An employee sees their own pay slips, the withholdings on each, year-to-date totals and the next pay date, and downloads any slip as a PDF. The screens read the slips the billing run stores (`payroll_entries`) through one data seam ([§3](#3-the-data-seam)); `/dev/pay` shows the same views over fixtures.

- Money is whole US cents and dates are plain `YYYY-MM-DD` days everywhere ([billing-and-invoicing.md](./billing-and-invoicing.md) §1). Pay slip lines have the shape `computeWithholding` returns ([payroll-withholding.md](./payroll-withholding.md)); the pay slip PDF is [invoice-and-payslip-pdfs.md](./invoice-and-payslip-pdfs.md) §3.
- Employees are paid biweekly on the pay calendar ([billing-and-invoicing.md](./billing-and-invoicing.md) §2). A slip belongs to the **tax year of its pay date** (C3 there), and that is the year the year selector filters on.
- Only the signed-in `worker` reads pay, and only their own ([acl.md](./acl.md) §3 I3, F1). Demo values, not legal or tax advice.

## 2. Routes

| Route | What | Guard |
| --- | --- | --- |
| `/worker/pay` | Dashboard: tiles, year tabs, pay slip table (Pay period, Gross pay, Net pay and an icon-only download; the period opens the slip), direct-deposit account. `?year=2026` selects the year | `requirePortalUser("worker")` |
| `/worker/pay/[payslipId]` | One slip: earnings, deductions, taxes, net, current and YTD columns, "Where your money goes" | same; unknown, someone else's and not-yet-visible slips are `notFound()` |
| `/worker/pay/[payslipId]/pdf` | The slip as a PDF, `Content-Disposition: attachment` | `requireRole("worker")`: no session `401`, other role `403`, not visible `404`, otherwise `200 application/pdf` |
| `/dev/pay` | Dev-only review page (404 in production): the dashboard and a slip computed by the real payroll domain; `?scenario=` and `?state=` | none |

"Pay" is the second item of the worker sidebar, between Home and Benefits (`src/app/worker/layout.tsx`). Pay date, taxes, deductions and status are not columns of the list; the slip page has them. UI rules are [ui-guidelines.md](./ui-guidelines.md) C20 to C23.

## 3. The data seam

`src/server/pay-queries.ts` exports the `PayDataSource` interface and, as its default export, the implementation pages and routes use. The view-models are in `src/lib/payslip-view.ts` (integer cents, serializable).

```ts
interface PayDataSource {
  getPayDashboard(userId: string, opts?: { now?: Date }): Promise<PayDashboardSummary>
  listPayslips(userId: string, filter: { year: number }, opts?: { now?: Date }): Promise<PayslipSummaryRow[]>
  getPayslipDetail(userId: string, payslipId: string, opts?: { now?: Date }): Promise<PayslipDetail | null>
}
```

- P1. **Ownership by signature.** Every method takes the session user's id and nothing that names another person or company. The implementation resolves the user's person and reads only that person's slips. A slip that is not theirs is indistinguishable from one that does not exist (`null`; the page is a `404`), as in [acl.md](./acl.md) I6.
- P2. **Visibility.** A slip is visible on and after its pay date, never before: `isPayslipVisible(payDate, now)` is `payDate <= today`, today taken in `America/New_York` (`PAY_TIME_ZONE`, the zone the PDFs use), so a slip appears at 00:00 Eastern on its pay date. The rule is applied **in the query** for all three methods, so an unpaid slip never reaches a page, a list count, `availableYears`, the YTD tiles or the PDF route. `opts.now` pins the clock for tests.
- P3. `listPayslips` returns the visible slips whose pay date falls in `year`, newest pay date first.
- P4. `getPayDashboard` returns `PayDashboardSummary`: `taxYear` (the current tax year), `latestNetPayCents` and `latestPayDate` (latest visible slip), `ytdGrossCents`, `ytdTaxesCents`, `ytdNetCents` (the latest slip's YTD columns, and zero when the latest slip is from an earlier year: the new year starts at zero on its first pay date), `nextPayDate`, `directDeposit` (`{ label: "Checking ••1234" }`, account type and last four digits only) and `availableYears` (years with a visible slip, newest first; empty means "no slips yet").
- P5. **Nothing yet.** An unknown user, a user who is not an employee and an employee with no visible slip read as an empty dashboard (no slips; the next pay date and deposit label when known), `[]` and `null`. The seam invents nothing.

### 3.1 How the seam is wired (`createPayDataSource`)

`createPayDataSource({ getDb })` builds the source; the default export uses the process database and the real clock, and tests pass a temp database. Slip ids are `payroll_entries.id` (`payslip:<hireId>:<periodIndex>`); the page decodes the percent-encoded route segment before asking.

1. Only a `worker` user is an employee; anything else reads as nothing.
2. Rows are selected by `worker_user_id = userId` and `pay_date <= payDayOf(now)` (P2) in the same query, newest pay date first; a slip id that is not theirs or not yet visible is `null`.
3. A run stores its `PayStubTaxes` in `withholding_json` next to the period, the tax year and the money columns. Detail is `payslipDetailFromWithholding(stub, context)` (`src/lib/payslip-from-withholding.ts`) with the hire's work state, role title and, for hourly pay, hours worked estimated from the days employed in the period. If the stub cannot be read the detail is built from the stored columns (YTD summed over the hire's slips of that year up to this one). List rows are mapped from the stored columns, so a row always equals its detail. The PDF prints "Northwind EOR, Inc." as the employer.
4. `nextPayDate` is `nextPayDateAfter(now, { startDate, endDate })` from the latest case of the hire; the end is `employmentEndDate` (term end or last working day); a cancelled case has none, so a new hire sees the first pay date before any run exists.
5. `directDeposit.label` is "Checking ••1234" built from the stored `direct_deposit` form data (`accountType`, `last4`). The account and routing numbers live in the encrypted payload, which is never read; the SSN on the slip PDF is decrypted from the `w4` form and masked (`maskSsn`) before it reaches the generator, and the dashboard never loads it.
6. YTD columns on a slip are what the run stored (`stub.ytd`), chained from the previous slip of the same tax year; they are not recomputed on read.

`createFixturePayDataSource` (`src/app/dev/pay/fixtures.ts`) is the reference implementation over an in-memory list; the same assertions run against the real source.

### 3.2 Invariants of a `PayslipDetail`

- `gross = preTaxDeductions + taxes + postTaxDeductions + net` for the current period, to the cent, and earnings sum to gross.
- YTD of a line is the sum of that line over every slip of the tax year up to and including this one.
- `taxes` lists federal income tax, Social Security, Medicare, Additional Medicare (only once due), the state income tax and each state insurance line. `preTaxDeductions` holds the Section 125 health premium (tier in `detail`) and the 401(k) deferral; `taxableWages` is gross less pre-tax deductions (federal wages). Both deductions come from the invoice's `HEALTHCARE` and `RETIREMENT` lines, which bill the election in force for that pay period ([billing-and-invoicing.md](./billing-and-invoicing.md) §13): a 401(k) change on the Benefits page changes the slips of later periods and never one already issued.

## 4. PDF download

`src/server/pay-pdf.ts` maps a `PayslipDetail` to the generator's `PayslipInput` (`payslipInputFromDetail`) and `renderPayslipPdf` calls `generatePayslipPdf` from `src/server/documents`. The route streams the bytes with `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="payslip-<payDate>.pdf"` and `Cache-Control: private, no-store`. The employee's SSN is only ever passed already masked (`ssnMasked`).

## 5. Out of scope

The payroll run itself (the billing run writes the slips, [billing-and-invoicing.md](./billing-and-invoicing.md)); correcting or voiding a slip; W-2 and year-end forms; employer-paid amounts and employer cost (client invoices, [billing-and-invoicing.md](./billing-and-invoicing.md)); changing the deposit account (the read-only card links to nothing); local taxes ([payroll-withholding.md](./payroll-withholding.md) §10).

## 6. Verification

Unit and component (`pnpm vitest run`):

1. `isPayslipVisible`: hidden the day before, shown on the pay date and after, switching at midnight Eastern (`src/lib/__tests__/payslip-view.test.ts`).
2. Fixture builder through the real domain (`src/app/dev/pay/__tests__/fixtures.test.ts`, CA, TX and NY): net = gross − deductions − taxes to the cent on every slip; YTD of gross, net, taxable wages, taxes, deductions and every tax and deduction line equals the sum of the prior slips of the year; YTD restarts at the first 2026 pay date; required tax lines and state insurance lines present.
3. Fixture data source: no slip before its pay date, appears when the pay date arrives, year filter and ordering, list rows agree with their detail, a different user gets nothing, YTD tiles equal the sum of the visible slips, empty scenarios.
4. `nextPayDateAfter`, `moneyBreakdown` (segments add up to gross), year helpers (`src/lib/__tests__`).
5. Components (`src/components/pay/__tests__`): tiles, year filter and tabs, the three-column table with its icon-only download (accessible name, link target, no text), both empty states, direct-deposit read-only, detail columns, itemized taxes, breakdown legend adds up to gross.
6. The real seam over a seeded temporary database (`src/server/__tests__/pay-queries.test.ts`): own slips per year, the visibility boundary at 00:00 Eastern on the pay date, detail invariants (net = gross − deductions − taxes, list row equals summary), the YTD chain equals the sum of the employee's visible slips (also with an earlier clock), another employee's slip is `null`, non-employees read nothing, the next pay date, no account number, routing number or SSN in any output, a real PDF and the stored-columns fallback.
7. PDF adapter keeps the generator's invariants; the route's 401 / 403 / 404 / 200 and its headers.

E2E (`e2e/employee-pay.spec.ts`, against `/dev/pay`): tiles, 9 rows for 2026 with the Pay period, Gross pay, Net pay and Download headers, future slip hidden, year tabs and URL, slip detail adds up to net, state insurance lines (NY, TX), both empty states, skeletons, dark theme.

E2E on the real pages (`e2e/employee-pay-live.spec.ts`, seeded database, `e2e/support/live.ts`): the list holds only slips paid up to today and each row adds up; tiles equal the stored sums; the deposit label; a slip's net = gross − deductions − taxes and its PDF prints the same figures with no account number or SSN; the YTD column equals the sum of the visible slips; a slip dated tomorrow (inserted, then removed) is not listed and its page and PDF are 404; another employee's slip answers like an unknown id; the PDF route's 401 / 403; a new hire sees the empty state with the first pay date. `e2e/employee-pay-benefits.spec.ts` adds the table's four columns with the icon-only download, and a 401(k) change followed by a later payroll that uses the new percent. The page answers a missing slip with the 404 screen at HTTP 200 because the slip streams inside Suspense; the PDF route answers a real 404.

Run: `pnpm vitest run src/lib src/app src/components/pay src/server/__tests__/pay-queries.test.ts src/server/__tests__/pay-pdf.test.ts` and `pnpm playwright test e2e/employee-pay.spec.ts`; the live spec needs `DATABASE_FILE=<copy>` and `PLAYWRIGHT_BASE_URL` of a server started with the same file.
