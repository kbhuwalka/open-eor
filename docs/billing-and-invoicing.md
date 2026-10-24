# Billing and invoicing

## 1. Purpose and assumptions

This spec owns the pay calendar, the per-period employer cost calculation, invoice generation, invoice statuses, the payment lifecycle and the billing run. It is pure TypeScript under `src/domain/billing/` plus `costsForPeriod` in `src/domain/quote.ts`, and is tested with Vitest. Storage, payment-processor calls and screens are out of scope of the pure part; they call these functions with explicit inputs. Persistence and the operations around it are in §12.

Assumptions:

- US-only, single provider ([product-overview.md](./product-overview.md) §2). Money is whole US cents everywhere; fractions are rounded only inside `src/domain/cents.ts`.
- Employees are paid **biweekly**. A person has one hire; one invoice per person per pay period.
- Rates are versioned (`us-2026`, [domain.md](./domain.md) §7.2); every invoice and quote names the rate set it used.
- **Quote == invoice == calculator.** The hire quote, the cost calculator and every payroll invoice call the same function, `costsForPeriod`, so the sum of a person's invoices equals their quote to the cent (§5).
- Dates are plain `YYYY-MM-DD` days. Demo values, not legal or tax advice.

## 2. Pay calendar

The calendar is data (`PayCalendar`, `src/domain/billing/pay-calendar.ts`); nothing else hardcodes a date rule.

| Field | `DEFAULT_PAY_CALENDAR` | Meaning |
| --- | --- | --- |
| `id` | `us-biweekly-v1` | Stored on every invoice (`payCalendarId`) |
| `anchorPeriodStart` | `2025-12-15` | First day of period 0; every period is a whole number of `periodDays` away (negative indexes before it) |
| `periodDays` | `14` | Length of a period; periods per year = `floor(365 / periodDays)` = 26 |
| `payDateOffsetDays` | `5` | Pay date = last day of the period + 5 calendar days |
| `invoiceIssueOffsetDays` | `-7` | Issue date = pay date − 7 calendar days |
| `invoiceDueOffsetBusinessDays` | `-2` | Due date = pay date − 2 business days (`addBusinessDays`, Mon–Fri, holidays out of scope) |
| `depositDueOffsetBusinessDays` | `5` | Deposit due date = issue date + 5 business days (§7) |

- C1. Periods run Monday to Sunday, so with a 5-day offset every pay date is a **Friday**, the issue date is the Friday a week earlier and the due date is the Wednesday before the pay date. (Pay dates are Fridays only because the period ends on a Sunday: the anchor is a Monday. A Saturday anchor with a 5-day offset would pay on Wednesdays.)
- C2. A `PayPeriod` is `{ index, start, end, payDate, issueDate, dueDate, taxYear, indexInTaxYear }`. Both `start` and `end` are inclusive. Functions: `payPeriodByIndex`, `payPeriodContaining(date)`, `payPeriodsBetween(start, end)` (every period with at least one day in the range), `periodsForTaxYear(year)`, `daysEmployedInPeriod(period, start, end | null)`.
- C3. **Tax year of wages = the year of the pay date.** A period worked in late December and paid in January belongs to the next tax year, and year-to-date wages reset with the pay date's year, not the work date's. The anchor gives 2026 26 pay dates (Fri Jan 2 – Dec 18) and 2027 27 (Fri Jan 1 – Dec 31); a year has 26 or 27 pay dates. `indexInTaxYear` is the position of a pay date within its tax year (0–25, or 0–26).
- C4. `payDate` of period `i` is `anchorPeriodStart + i × periodDays + (periodDays − 1) + payDateOffsetDays`.

## 3. Pay per period

- P1. Annual wage = `annualizeWageCents` (hourly × 2,080, monthly × 12, annual as entered). 2,080 hours are kept, so an hourly worker is paid **80 hours** a period (2,080 ÷ 26).
- P2. Gross pay for a full period is `scheduledGrossCents(annual, indexInTaxYear)` = `floor((n+1) × annual / 26) − floor(n × annual / 26)` for `n = indexInTaxYear mod 26`. Cumulative rounding spreads the division's cents so periods differ by at most one cent and **the first 26 pay dates of any tax year sum to the annual wage exactly**; a 27th pay date repeats the first period's amount (a salary is annual ÷ 26 per pay date, so a 27-date year pays 27 periods).
- P3. **Proration.** A partial first or last period is paid `round(scheduled gross × days employed ÷ periodDays)`, where days employed are **calendar days** (Mon–Sun, weekends included) from the start date or to the last day, both inclusive. A fixed term's end date is inclusive (the person works it). Employment ends on the earlier of the fixed-term end and a termination's last working day (`employmentEndDate`).
- P4. Employer health cost for a partial period is the full-period cost prorated by the same days ÷ `periodDays`.

## 4. The shared calculation and benefit rates

`costsForPeriod` (`src/domain/quote.ts`) takes the annual wage, the pay date's `indexInTaxYear`, days employed, year-to-date gross pay (same tax year), state, package, markup percent, benefit elections (or `null`) and returns the period's gross pay, the five statutory costs (`statutoryCostsForPeriod`), the service fee (`round(gross × markupPct / 100)`), and, when elected, the employer health share and the 401(k) deferral and match.

Benefit rates are data in the rate set (`src/domain/cost-rates.ts`, `us-2026`):

- B1. **Health**, per package (`standard`, `premium`) and tier (`employee`, `employee_spouse`, `employee_children`, `family`): `monthlyPremiumCents` (total premium) and `employerSharePct`. Per period: premium = `round(monthly × 12 ÷ 26)`; employer = `round(premium × employerSharePct ÷ 100)`; employee = premium − employer, so the two always add up. Helpers: `employerHealthCostPerPeriod(...)` (billed to the client) and `employeeHealthPremiumPerPeriod(...)` (deducted from net pay by the payroll run). Employee-only premiums are chosen so the employer cost stays $558 (Standard) and $800 (Premium) a month, the figures the quote used before tiers existed; other tiers are demo assumptions (employer shares follow KFF 2025: workers pay 16% of a single and 26% of a family premium on average). Premiums are charged per pay period, including the 27th.
- B2. **401(k)**: `retirement401k` holds the IRS 2026 limits (Notice 2025-67): elective deferral limit **$24,500** and compensation limit **$360,000**, and the default deferral (4%). Each package has a match rule as data: Standard 50% of deferrals up to 4% of pay, Premium 100% of deferrals up to 4% of pay. `employerRetirementMatch({ package, grossCents, ytdWageCents, deferralPct })` returns `{ deferralCents, matchCents }`: the deferral is `deferralPct` of gross pay until the year's deferrals reach the limit (it is the growth of `min(limit, pct × pay so far)`, so only year-to-date pay is needed); the match is `matchRatePct` of the deferral, on deferrals up to `matchCapPct` of pay under the compensation limit.
- B3. **The pending-benefits quote keeps its meaning.** While a worker has not chosen, the quote assumes **employee-only** coverage and the default 4% deferral (`assumedBenefitElections`), which gives the same employer cost as before: $558 / $800 a month of health, and a 2% (Standard) or 4% (Premium) match of pay.

## 5. Quote on the pay calendar

`buildQuote` simulates the biweekly calendar with `costsForPeriod`, one call per period, year-to-date wages carried within a tax year and reset when the pay date's year changes:

- Q1. **Indefinite** (no term; this is also the cost calculator): the 26 pay periods of a notional tax year, year-to-date starting at 0. Annual figures are the sum of those 26 periods; monthly figures are annual ÷ 12. A person who works exactly a tax year's 26 pay dates is invoiced these amounts.
- Q2. **Fixed term**: the actual pay periods that overlap `[startDate, endDate]`, partial first and last periods prorated by days (P3), Social Security, FUTA and SUTA wage bases applied with year-to-date wages that reset by pay-date year. Year-to-date starts at 0 on the first period (wages earned earlier in the year elsewhere are not modelled). `quote.term.committedCents` and `withBenefitsCents` are the absolute totals.
- Q3. **Display lines.** Every line keeps `annualCents` as an annualised rate so `perUnitCents` and the hourly/monthly/annual display work unchanged. `WAGE`, `SERVICE_FEE`, `HEALTHCARE` and `RETIREMENT` are always those of the indefinite quote (the displayed salary is the entered one); the statutory lines of a fixed term are `round(term cents × 364 ÷ days employed)` because a shorter run of wages consumes the wage bases sooner (364 = 26 × 14).
- Q4. **Equality.** The sum of a person's invoice totals over their employment equals `quote.term.committedCents` when benefits are declined and `quote.term.withBenefitsCents` when they are enrolled in employee-only coverage with the default deferral, **to the cent**. The 26 invoices of a full tax year equal the indefinite quote's annual figures, line by line. These are tested for random hires.
- Q5. The calculator is unaffected by a term: it builds an indefinite quote. A quote read from a policy snapshot is shown as stored; quotes frozen before the pay calendar existed keep their monthly-based figures and are not re-priced.

## 6. Invoices

`generatePayrollInvoice` (`src/domain/billing/invoice.ts`) produces **one invoice per person per pay period**.

| Line code | Group | Amount |
| --- | --- | --- |
| `SALARY` | `wage` | Prorated gross pay for the period |
| `SOCIAL_SECURITY`, `MEDICARE`, `FUTA`, `SUTA`, `WORKERS_COMP` | `statutory` | `statutoryCostsForPeriod` on that person's gross pay and year-to-date wages; always present, zero once a wage base is used up |
| `SERVICE_FEE` | `service_fee` | `markupPct` of the period's gross pay |
| `HEALTHCARE` | `benefits` | Employer health share for the chosen tier; only if enrolled and a tier is chosen |
| `RETIREMENT` | `benefits` | Employer 401(k) match; only if enrolled and a deferral is chosen |
| `DEPOSIT` | `deposit` | Deposit invoices only (§7) |

- I1. Invoice fields: `id`, `number`, `kind` (`payroll`, `deposit`), `companyId`, `hireId`, `period` (`index`, `start`, `end`, `payDate`, `taxYear`, `indexInTaxYear`, `daysEmployed`, `periodDays`; `null` for a deposit), `issueDate`, `dueDate`, `currency` (`USD`), `rateSetId`, `payCalendarId`, `lines`, `totalCents` (sum of the lines), `status` (`open` or `void`).
- I2. **Audit inputs.** Each payroll line stores `inputs`: at least `rateSetId`, `wageCents` (the period's gross pay) and `ytdWageCents` (gross pay earlier in the tax year), plus what the line needs: statutory lines add `ratePct`, `wageBaseCents` (or `null`) and `taxableWageCents`; `SALARY` adds the annual wage, unit, scheduled gross and days employed; health adds package, tier, premium, employer share and the employee premium for the payroll run; retirement adds the deferral and match rule. Any line can be recomputed from its inputs.
- I3. **Ids and numbers.** The `id` is deterministic (`payroll:<hireId>:<periodIndex>`, `deposit:<hireId>`) and is the billing run's idempotency key. The number is `INV-<year>-<seq>`, the year the invoice is **issued**, `seq` zero-padded to four digits and restarting each year (`formatInvoiceNumber`, `parseInvoiceNumber`, `nextInvoiceSequence`).
- I4. Dates come from the pay calendar: `issueDate` and `dueDate` of the period (§2). A person who is not employed on any day of the period cannot be invoiced for it (`RangeError`).
- I5. Benefit elections are per person (`{ enrolled, healthTier | null, retirementDeferralPct | null }`) and effective-dated (§13): each invoice bills the election in force for its own pay period. Invoices bill benefits only when `enrolled`. A person without elections is billed as declined.

## 7. Deposit invoice

`generateDepositInvoice({ quote, ... })` is one invoice with one `DEPOSIT` line: one month of the committed total, `quote.totals.committed.monthlyCents`, **capped at the term total** (`quote.term.committedCents`) for a fixed term shorter than a month. The hire quote's deposit row uses the same rule (`depositAmountCents`). It is issued on the day the order was placed (`hiredOn`) and due `depositDueOffsetBusinessDays` business days later. Crediting the deposit against later invoices or refunding it is out of scope.

## 8. Statuses and payments

An invoice stores only `open` or `void`. `invoiceDisplayStatus(invoice, payments, today)` derives the status a person sees, in this order:

| Status | When |
| --- | --- |
| `void` | The invoice is void |
| `paid` | Succeeded payments allocate at least the invoice total to it |
| `processing` | An `initiated` payment allocates to it |
| `overdue` | Open, and `dueDate < today` |
| `open` | Otherwise (due today counts as open) |

- S1. A `Payment` is `{ id, companyId, status, method, allocations, totalCents, initiatedAt, settledAt, failedAt, failureReason }` with status `initiated`, `succeeded` or `failed`; `method` is a `SavedPaymentMethod` summary (`id`, `type` card or us_bank_account, `label`, `last4`, expiry), never a full number. `PaymentAllocation` is `{ invoiceId, amountCents }`; payments allocate invoices in full. `settledAt` is the time it succeeded and is `null` for any other status; `failedAt` is the time Finance failed it and is `null` for any other status. A failed payment never has a settled date, in any screen, query or PDF.
- S2. `validatePaymentSelection(invoices, payments, selectedIds)` accepts a selection that is non-empty, made of known invoices of **one company**, none void, none already paid and none in an `initiated` payment. Duplicate ids count once. A rejection carries a `code` (`EMPTY_SELECTION`, `UNKNOWN_INVOICE`, `MIXED_COMPANIES`, `VOID_INVOICE`, `ALREADY_PAID`, `ALREADY_PROCESSING`) and the offending ids; success carries `totalCents`. `isPayable` is the single-invoice form.
- S3. `initiatePayment` validates, then creates an `initiated` payment. `settlePayment` and `failPayment` are the only transitions and apply only to an `initiated` payment (otherwise `DomainError("ILLEGAL_TRANSITION")`); they return a new object. **A failed payment returns its invoices to payable** with no change to them, because status is derived: failed payments are ignored.

## 9. Billing run

`billingRun({ companies, hires, elections, existingInvoices, today, payCalendar? })` is a pure planner that returns the invoices that **should exist and do not yet**; the caller persists them.

- R1. One deposit per hire, once its `hiredOn` has come.
- R2. One payroll invoice per active person per pay period, from the period holding the start date until the period holding the last day of employment (`employmentEndDate`: fixed-term end or last working day), or until the latest period whose issue date has come for an open-ended hire. First and last periods are prorated by days (P3).
- R3. Only invoices with `issueDate <= today` are planned. An invoice is skipped when `existingInvoices` already has its id, void ones included (a voided invoice is never silently regenerated).
- R4. **Idempotent and deterministic.** Running again with the planned invoices added to `existingInvoices` returns nothing; the same inputs give the same invoices and numbers. Output is ordered by issue date, company, hire, period; numbers continue each issue year's sequence after the highest existing number.
- R5. **Year-to-date wages are derived from invoices**: the `SALARY` lines of the person's earlier, non-void payroll invoices in the same tax year (`ytdWageFromInvoices`), including those planned earlier in the same run. A voided invoice does not count as wages paid.
- R6. Hires of a company missing from `companies` are skipped. `elections` is, per hire, one state for every period or a version history resolved period by period (§13). A hire without an entry in `elections` is billed as not enrolled. `hires` are the people to bill: the caller supplies payroll-ready people (including ones with a last working day); the planner does not read case state.

## 10. Out of scope

Payroll runs and net pay (employee withholding is in `docs/payroll-withholding.md`); payment-processor calls and webhooks; payment-processor integration (a saved method is a stored summary and settlement is a Finance action); credit notes, deposit credit or refund; partial payments; holidays in the business-day calendar; semi-monthly or weekly calendars (the calendar is data, but only the 14-day period is tested); state paid-leave levies; 401(k) catch-up contributions; changing the health tier after the first election (it goes through Northwind; the history and billing already support a new version); invoicing from a quote frozen before the pay calendar.

## 11. Verification

Vitest under `src/domain/billing/__tests__/` and `src/domain/__tests__/quote.test.ts` MUST prove:

1. Calendar: every pay date is a Friday 14 days apart; issue is 7 days before pay and due is the Wednesday; due dates skip weekends for a Monday pay date; 2026 has 26 pay dates and 2027 has 27; tax years partition all periods without gaps; a December period paid in January is next year's.
2. Pay: hourly is 80 hours a period; the first 26 pay dates of a tax year sum to the annual wage exactly for random wages; partial first and last periods prorate by days ÷ 14; a termination before the term end wins.
3. Equality: for random fixed-term hires the sum of invoices equals `term.committedCents` (declined) and `term.withBenefitsCents` (default elections) to the cent; the 26 invoices of a tax year equal the indefinite quote line by line; a 27-pay-date year bills 27 invoices.
4. Wage bases: Social Security, FUTA and SUTA stop at the right pay period; year-to-date resets by pay-date year; the 401(k) deferral limit and compensation limit apply.
5. Benefits: declined vs enrolled; tier and package costs; employer plus employee premium equals the premium; the pending-benefits quote keeps $558 / $800 a month and 2% / 4% of pay.
6. Deposit: one month of the committed total, capped at a short term's total.
7. Billing run: idempotent and deterministic; incremental runs equal a single run; numbering per issue year; void invoices block regeneration and are excluded from year-to-date; unknown companies skipped.
8. Status derivation (`void`, `paid`, `processing`, `overdue`, `open`), selection validation, `settlePayment`, `failPayment` and the retry after a failed payment.
9. `failPayment` sets `failedAt` and leaves `settledAt` null; `settlePayment` the reverse. `businessDayOf` turns over at Eastern midnight in daylight and standard time (`src/domain/__tests__/business-time.test.ts`), and the read models use it for overdue, paid-on, last payment and pay slip visibility (`billing-queries.test.ts`).

## 12. Persistence and operations

Code: `src/server/billing-core.ts` (primitives that run inside a caller's transaction), `src/server/billing.ts` (operations), `src/server/billing-queries.ts` (read models). Tables are in [data-model.md](./data-model.md) §3 (`invoices`, `invoice_lines`, `payments`, `payment_allocations`, `saved_payment_methods`, `benefit_elections`, `benefit_election_versions`, `payroll_entries`). Access rules are in [acl.md](./acl.md) §5.

- B1. **The run.** `runBilling(deps, { hireIds? })` loads the payroll-ready hires, plans with `billingRun` and writes the invoices, their lines (the calculation inputs are stored as JSON, so a line can be re-derived) and, for each payroll invoice, its `payroll_entries` row (gross, withholding from the W-4 submitted in the case, net, year-to-date continued from the previous entry) in **one transaction**. Running twice creates nothing the second time. Invoice numbers are `INV-<year>-<seq>`, sequential per issue year.
- B2. **Trigger.** There is no scheduler. The seed calls the run once per issue day with a simulated clock; `POST /api/billing/run` (bearer `BILLING_RUN_SECRET`) calls it for the real day; Finance screens call the same function. The run never needs arguments to be correct.
- B3. **The deposit is an invoice** (`deposit:<hireId>`), created when the order is created. Client `pay_deposit` creates an `initiated` payment of it with the company's saved method; Finance `confirm_deposit` completes with `settled` (the payment succeeds) or `received` (a succeeded payment without a method: paid outside the product). `settlePayment` completes a ready `confirm_deposit` itself. There is no way to forgive a deposit: it is paid, or voided by cancelling the order.
- B4. **Operations** (Finance-only unless noted; other roles get `DomainError("FORBIDDEN_ROLE")`): `initiatePaymentForInvoices` (client, own company; an invalid selection is `INVALID_PAYMENT_SELECTION`), `settlePayment`, `failPayment` (reason required), `voidInvoice` (reason required; also deletes the payroll entry), `markDepositReceived`, `markDepositNotReceived` (the deposit payment is in flight and the money did not arrive: it fails that payment through `failPayment` with the reason "Deposit not received", plus Finance's optional detail), `runBilling`. Each is idempotent only through its state guard: settling a settled payment is `ILLEGAL_TRANSITION`.
- B5. **Lifecycle.** Cancelling an order voids its unpaid deposit invoice (`order_cancelled`). Terminating reissues the unpaid invoice that holds the last working day (prorated) and voids later unpaid ones (`terminated`) with their payroll entries; paid invoices are never touched. Restarting a cancelled order owes nothing if the deposit was paid or is processing, and reopens the invoice otherwise. A deposit whose payment was already `initiated` when the order was cancelled is not voided at that moment; it stays in Finance's Payments queue, where Finance settles it or marks it failed, and failing it voids the now unpaid deposit (`order_cancelled`) because there is no one left to pay it.
- B6. **Reads.** Display status is always derived (§8) at read time with an injected `now`. Employees see only their own pay slips whose pay date is on or before today; clients see only their own company; Finance sees every company. Receivables are bucketed by days past due (`current`, 1–30, 31–60, 60+), per company, with in-flight payments shown apart.
- B6a. **One business day.** Every "today" a person reads in billing and finance (due and overdue, "paid on", last payment, the ageing buckets, the tax year, the day a pay slip appears, the `YYYY-MM-DD` of a timestamp shown in a table, drawer, PDF or Finance page) is the America/New_York day, from `businessDayOf(instant)` in `src/domain/business-time.ts` (`formatIsoDay` converts timestamps through it too). Never the UTC date (8pm Eastern on the 15th is the 16th in UTC, and a payment settled then was settled on the 15th), never the server's local day. `todayIso` in `employment-term.ts` is the machine-local day and belongs to task due dates only. Specs use `todayEastern()`, which is the same helper.
- B7. **Seed.** Invoices, payments and payroll entries are produced only by these operations, replayed over the simulated calendar with a deterministic RNG. A per-company payment policy leaves a realistic mix: Acme's latest group unpaid, Brightwave's latest two unpaid, Harbor's latest processing plus one failed-then-repaid payment. Counts are in [data-model.md](./data-model.md) §5.2. The replay runs on the business day: it bills only issue days up to the seed clock's Eastern day, and no event it writes is later than the clock. A pay slip is created with its invoice, a week before its pay date, so slips with a pay date after "today" exist but are hidden from the employee until that Eastern day (`src/db/__tests__/seed-billing-clock.test.ts` seeds at 8:30pm Eastern and the night before a pay date). Every seeded `failed` payment has a reason and `failed_at`, and no `settled_at`.
- B8. **A failed deposit payment is not a dead end.** `failPayment` (Payments, Mark failed) and `markDepositNotReceived` (Deposits, Not received) are one path: the payment becomes `failed`, the deposit invoice derives back to Due or Overdue (nothing is stored for it) and shows again in the client's Invoices tab, and the order's `pay_deposit` step is reopened as a **new instance** (`reopenTask`, [tasks-and-workflow.md](./tasks-and-workflow.md) §5.8) with a note ("The deposit payment failed (<reason>). Please pay it again."), so the case shows the payment step as the client's to do again and `confirm_deposit` is blocked until they pay. The client paying again (Invoices tab or the step) completes the reopened step and starts a new payment. It reopens only while the order is `open`, the person has not reached go-live, and no task that depends on `pay_deposit` is done already (the engine refuses to undo work that moved on, so a case already past `confirm_deposit` keeps its history and only the invoice shows due again). A payment that covers several invoices fails as a whole: every deposit in it is reopened and every other invoice is payable again. A cancelled order has no one left to pay, so failing its deposit payment voids the unpaid deposit instead of reopening anything. A deposit with no payment in flight has nothing to fail: Finance's Deposits row reads "Awaiting payment" and offers only Confirm received.

Known limits: a failed deposit payment reopens `pay_deposit` only while the order is open and the person has not gone live, and not once a task that depends on it is done (§12 B8); reactivating a terminated person does not un-void periods voided by the termination; invoice numbers are sequential per year but not strictly chronological across deposits and payroll in seeded data; list queries filter and paginate in memory (demo scale).

## 13. Effective-dated benefit elections

An election is not a single mutable row any more. Each decision is a version that says from which pay period it applies, so a change made today never rewrites an invoice or a pay slip that already exists.

- E1. **Versions.** `benefit_election_versions` (PK `case_id` + `version`; [data-model.md](./data-model.md) §3) holds `{ enrolled, healthTier, retirementDeferralPct, effectiveFrom, source, decidedByUserId, decidedAt }`. It is append-only: nothing updates or deletes a version. `benefit_elections` keeps one row per case, the latest decision, for readers that only need "what did they choose".
- E2. **The election in force** for a pay period is the latest version whose `effectiveFrom` is null (applies from the start of employment) or on or before the period's first day (`electionInForce`, `src/domain/billing/elections.ts`). `billingRun` resolves it per period (`resolveElection`), so one run can bill three periods under two elections. Rows that predate versions are backfilled as version 1 from the start, so older data reads the same as before.
- E3. **First election.** The `benefits_decision` task records version 1 through `recordBenefitElection` (`source: "onboarding"`). With no payroll invoice yet it applies from the start; if payroll was already invoiced it applies from the next period as for a change.
- E4. **A change** (the employee's 401(k) percent on `/worker/benefits`, [employee-portal.md](./employee-portal.md) §7) appends a version with `source: "employee_change"` and `effectiveFrom` = the first day of the next election period, and writes a `benefit_election_changed` case event. The health tier is carried over unchanged. Saving the percent already in force appends nothing.
- E5. **Which period is next** (`nextElectionPeriod`, `src/domain/billing/elections.ts`; the server supplies the pay periods payroll has already invoiced for the hire): the first pay period after the one containing today, not before the start date, and not yet invoiced; none when employment ends before it starts. Example: today Mon Apr 20, 2026 gives the period May 4 to May 17, paid May 22. A period that has begun is never chosen, even if no invoice exists yet, because its pay slip is about to be issued. The employee does not choose the date; the page states it before Save and again after.
- E6. **What a change touches.** Invoices issued before the next period are untouched (their `RETIREMENT` and `HEALTHCARE` lines keep the inputs stored on them), and so are the pay slips made from them, because a slip takes its 401(k) deduction from the invoice's `RETIREMENT` line (`createPayrollEntry`). The next invoices the billing run plans use the new version; the Finance billing preview and the employee's page project the same arithmetic.
- E7. **The annual IRS limit** follows what was deferred, not percent times pay. When the percent changes during the year, `retirementMatch` is given `ytdDeferralCents` (`ytdDeferralFromInvoices`: the `deferralCents` of the person's earlier non-void payroll invoices of the tax year, including ones planned earlier in the same run), and the period's deferral is the percent of that period's pay, capped at what is left under the limit. Without a change history the old cumulative formula gives the same numbers. The match follows the deferral actually made.
- E8. **Termination** (`reissueForTermination`) re-issues the invoice that holds the last day with the election in force for that period, not the latest one.
- E9. **Audit.** Every version carries who decided and when, and a change also leaves a case event, so Northwind can read who changed what from where.
