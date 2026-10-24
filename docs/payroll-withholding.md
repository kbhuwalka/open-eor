# Payroll withholding (employee-side gross to net)

## 1. Purpose and scope

This spec owns the pure calculator that turns one biweekly gross into the employee's taxes, deductions and net pay, with current and year-to-date figures, the way a pay slip shows them. It is the **employee side**. The employer side of the same payroll (employer FICA, FUTA, state unemployment, workers' compensation, benefit match) is `statutoryCostsForPeriod` in `src/domain/quote.ts` over `src/domain/cost-rates.ts`; this module never duplicates it.

In scope: federal income tax withholding, Social Security, Medicare, Additional Medicare, state income tax withholding for 50 states and DC, employee-paid state payroll insurance, Section 125 and traditional 401(k) as pre-tax deductions, post-tax deductions, the 401(k) limit, a net-pay floor.

Out of scope: local (city, county, school district) income taxes, the pay calendar, who gets paid when, Roth 401(k), garnishment priority rules, W-2 reporting, supplemental-wage flat rates, tips and overtime deductions, tax-exempt states of residence versus work (the calculator withholds for the **work state** only).

Everything is data plus one generic function. No person, id or state is hardcoded in the logic.

## 2. Pay schedule

Employees are paid **biweekly**: 26 periods a year, 14 days each. Hourly pay is 80 hours a period; salary is annual / 26 rounded half up (`biweeklyGrossFromSalaryCents`, `biweeklyGrossFromHourlyCents`). Some years have **27 pay dates**. The calculator does not know the calendar: the caller passes `payPeriodsPerYear: 27` for a year where the employer annualizes over 27, and every annualized formula (federal worksheet, state tables, NY and HI weekly caps) uses that count. The default is 26. Social Security and Medicare are not annualized, so the 27th check is withheld like any other and the wage base cap does the limiting.

## 3. Where the code lives

| File | Contents |
| --- | --- |
| `src/domain/payroll/money.ts` | Integer-cent and scaled-rate arithmetic, half-up rounding (BigInt) |
| `src/domain/payroll/withholding-rates.ts` | The versioned `us-2026` rate set: FICA, Pub 15-T tables, 401(k) limits, and the state data |
| `src/domain/payroll/state-withholding-rates.ts` | State income tax rules for all 51 jurisdictions and the employee-paid state insurance lines |
| `src/domain/payroll/withholding.ts` | `computeWithholding` and helpers |
| `src/domain/payroll/index.ts` | Re-exports |
| `src/domain/payroll/__tests__/` | Tests and the IRS wage-bracket fixture |

Conventions follow `cost-rates.ts`: integer cents, percentages as numbers (6.2 means 6.2%), rate sets identified by id (`us-2026`) so a stored pay slip names the tables it used, pure functions, no I/O. `US_2026_WITHHOLDING` carries the same Social Security rate and wage base as `US_2026`; a test enforces that.

## 4. Public API

```ts
computeWithholding(input: WithholdingInput): PayStubTaxes

federalIncomeTaxWithholdingCents(args: {
  taxableWagesCents: number; payPeriodsPerYear: number; w4: W4Inputs
  rates?: WithholdingRateSet; rounding?: "cent" | "dollar"
}): number

stateIncomeTaxWithholdingCents(args: {
  stateCode: string; taxableWagesCents: number; payPeriodsPerYear: number
  federalTaxWithheldCents?: number; election?: StateWithholdingElection; rates?: WithholdingRateSet
}): number

annualizeCents(periodCents: number, payPeriodsPerYear: number): number
perPeriodCents(annualCents: number, payPeriodsPerYear: number): number
biweeklyGrossFromSalaryCents(annualSalaryCents: number): number
biweeklyGrossFromHourlyCents(hourlyWageCents: number): number
w4InputsFromForm(form: W4FormLike): W4Inputs        // structural match for W4Data in domain/forms/w4
getWithholdingRateSet(id: string): WithholdingRateSet | null
```

### 4.1 Input

| Field | Type | Meaning |
| --- | --- | --- |
| `grossCents` | integer cents | Gross pay this period |
| `workState` | `"CA"`, `"DC"`, ... | State the employee works in; unknown codes throw `RangeError` |
| `payPeriodsPerYear` | 1 to 366, default 26 | Annualization factor (27 for a 27-pay-date year) |
| `ytd` | `Partial<YtdTotals>` | Totals before this period; every field defaults to 0. Pass the previous result's `ytd` back in |
| `w4` | `W4Inputs` | `filingStatus` (`single`, `mfj`, `hoh`), `step2MultipleJobs`, `step3DependentsCreditCents` (annual), `step4aOtherIncomeCents` (annual), `step4bDeductionsCents` (annual), `step4cExtraWithholdingCents` (per period), `exemptFromWithholding`. Defaults to single with nothing claimed |
| `stateElection` | `{ filingStatus?: "single" \| "married" \| "head_of_household"; allowances?: number }` | Defaults to single, 0 allowances (no state form is collected) |
| `preTaxDeductions` | `{ section125HealthCents?, traditional401kCents? }` | Per period |
| `postTaxDeductions` | `{ code, label, amountCents }[]` | Per period, in priority order |
| `hoursWorked` | number, default 80 | Only used by per-hour state lines (Oregon WBF) |
| `catchUp` | `"none"` \| `"age50"` \| `"age60to63"` | 401(k) catch-up eligibility |
| `rates` | `WithholdingRateSet` | Defaults to `US_2026_WITHHOLDING` |
| `federalRounding` | `"cent"` (default) \| `"dollar"` | See section 7 |

`YtdTotals`: `grossCents`, `ficaWagesCents` (gross less Section 125, defaults to `grossCents`), `federalTaxableWagesCents`, `stateTaxableWagesCents`, `netPayCents`, `taxCents` (by tax code), `deductionCents` (by deduction code).

### 4.2 Output (`PayStubTaxes`)

| Field | Meaning |
| --- | --- |
| `rateSetId`, `taxYear`, `payPeriodsPerYear`, `workState`, `grossCents` | What was computed |
| `wageBases` | `ficaWagesCents`, `socialSecurityTaxableCents`, `medicareTaxableCents`, `additionalMedicareTaxableCents`, `federalIncomeTaxableCents`, `stateIncomeTaxableCents` |
| `taxes` | `TaxLine[]`: `code`, `label`, `kind`, `jurisdiction`, `taxableWagesCents`, `amountCents`, `ytdCents` |
| `preTaxDeductions`, `postTaxDeductions` | `DeductionLine[]`: `code`, `label`, `amountCents` (applied), `requestedCents`, `ytdCents` |
| `totals` | `taxesCents`, `preTaxDeductionsCents`, `postTaxDeductionsCents`, `deductionsCents`, `netPayCents` |
| `ytd` | `YtdTotals` including this period, ready to pass into the next call |
| `warnings` | `FOUR_01K_ANNUAL_LIMIT`, `DEDUCTION_CURTAILED`, `EXTRA_WITHHOLDING_REDUCED` |

Tax codes: `FED_INCOME`, `FED_SOCIAL_SECURITY`, `FED_MEDICARE`, `FED_ADDITIONAL_MEDICARE` (present only once it applies), `<ST>_INCOME` for a state with income tax (`stateIncomeTaxCode`), and the insurance codes in section 9.1. Deduction codes: `SECTION_125_HEALTH`, `TRADITIONAL_401K`, and whatever the caller names its post-tax lines.

Invariant, tested over 1,500 random inputs across all 51 jurisdictions: `net + taxes + pre-tax deductions + post-tax deductions = gross`, net is never negative, and no line is negative.

## 5. Method

### 5.1 Which wages each tax uses

| Base | Definition |
| --- | --- |
| FICA wages | gross minus Section 125 premiums |
| Federal income tax wages | FICA wages minus traditional 401(k) |
| State income tax wages | same as federal wages, except Pennsylvania and New Jersey, where 401(k) deferrals stay in state wages (still net of Section 125) |
| State insurance wages | FICA wages (a Section 125 premium reduces them) |

### 5.2 Federal income tax: Pub 15-T 2026 Worksheet 1A (percentage method, Form W-4 from 2020 or later)

1. Annualize the period's federal wages: `wages x payPeriodsPerYear`.
2. Add Step 4(a) other income; subtract Step 4(b) deductions.
3. Subtract the standard deduction offset: **$12,900** for married filing jointly, **$8,600** for single and head of household, **$0** when the Step 2 box is checked. Floor at 0.
4. Find the row of the filing status's annual schedule (standard, or "Step 2 checkbox") where the adjusted amount is at or over column A. Tentative tax = column C + (amount - column A) x column D.
5. Subtract the Step 3 credit; floor at 0.
6. Divide by `payPeriodsPerYear`.
7. Add Step 4(c) extra withholding per period.

"Exempt from withholding" returns 0 for the whole line, extra withholding included. Pub 15-T allows rounding to the dollar; `federalRounding: "dollar"` does that before step 7.

Tables are in `US_2026_WITHHOLDING.federalIncomeTax`, transcribed from the "Percentage Method Tables for Automated Payroll Systems" (the 2020+ W-4 section) of Pub 15-T (2026). A table of 178 biweekly wage bracket rows from the same publication is stored as a test fixture; every one of its 1,068 cells (178 rows x six filing-status and checkbox columns) is reproduced by the percentage method at the bracket midpoint, rounded to the dollar, as the IRS builds its own wage bracket tables.

### 5.3 FICA

| Line | Rule |
| --- | --- |
| Social Security | 6.2% of FICA wages up to the **$184,500** wage base, using YTD FICA wages to find the part of this period under the base. YTD Social Security tax can never exceed `round(184,500 x 6.2%)` = $11,439.00: the last period is trimmed so earlier rounding cannot push the year over |
| Medicare | 1.45% of all FICA wages, no cap |
| Additional Medicare | 0.9% of the part of FICA wages above **$200,000** YTD. A period that crosses the threshold is taxed only on the part above it. The line appears once it applies |

Only the employee share is computed here. The employer share is in `cost-rates.ts`.

### 5.4 State income tax

Each of the 51 jurisdictions has one rule (section 8) of one of five kinds:

- `none`: nothing is withheld and no income line is produced.
- `flat` and `brackets`: annualize the state wages, subtract the standard deduction and any allowance deduction, apply the marginal bands (a published base per band where the state publishes one, otherwise the sum of the lower bands), subtract any per-allowance credit, floor at 0, divide by `payPeriodsPerYear`.
- `oregon-formula`: Oregon's computer formula, which subtracts the federal tax withheld (annualized, capped at $8,750 and phased out above $125,000 single or $250,000 married), applies the standard deduction, uses one of two tables split at $50,000 of annual wages, and subtracts $263 per allowance.
- `fallback`: a single documented effective rate on state wages.

Two special cases: California returns 0 at or below its Table 1 low-income exemption, and New York applies the Method III top-tier rate to the **whole** amount when annualized net wages reach the tier. State tax is never above the wages left after federal tax and FICA, which matters only on checks of a few dollars (Oregon's table has a $263 annual floor on any positive wage).

No state withholding certificate is collected, so the default election is **single with 0 allowances**. The caller may pass `stateElection` (married, head of household, allowances or exemptions) when the product collects one.

### 5.5 Employee-paid state insurance

Section 9.1 lists each program. A line is `rate x wages under its cap`, where the cap is one or more of an annual wage base (cumulative with YTD FICA wages, so a period that crosses the base is taxed on the part under it), a weekly wage cap scaled to the period (`weeklyCap x 52 / payPeriodsPerYear`), and an annual maximum contribution (YTD tax can never exceed it). Oregon's Workers' Benefit Fund is per hour worked (0.9 cent), using `hoursWorked`.

### 5.6 Pre-tax deductions and the 401(k) limit

- Section 125 reduces every wage base.
- Traditional 401(k) reduces only income tax wages (not FICA; not state wages in PA and NJ).
- The 401(k) is limited to `$24,500` (2026 elective deferral limit) plus the catch-up for `catchUp`: `age50` adds $8,000, `age60to63` adds **$11,250** instead of (not on top of) the $8,000. Room is computed from `ytd.deductionCents.TRADITIONAL_401K`. When the request exceeds the room the applied amount is cut and `FOUR_01K_ANNUAL_LIMIT` is returned.
- From 2026 catch-up contributions by employees whose prior-year FICA wages from the employer exceeded $150,000 must be Roth. This is **not enforced**; the plan administrator designates catch-up contributions. The threshold is in the rate set for reference.

### 5.7 Net-pay floor

Taxes are legal obligations and are computed first on the wages that remain. If gross minus pre-tax deductions minus taxes minus post-tax deductions would be negative, the shortfall is removed in this order, each cut to the largest amount that leaves net pay at zero, and reported in `warnings`:

1. Post-tax deductions, the last listed first (`DEDUCTION_CURTAILED`).
2. W-4 Step 4(c) extra withholding (`EXTRA_WITHHOLDING_REDUCED`).
3. The traditional 401(k) deferral (`DEDUCTION_CURTAILED`).
4. The Section 125 premium (`DEDUCTION_CURTAILED`).

Taxes are recomputed after each cut. Computed taxes are never reduced, except that state income tax and per-hour state lines are limited to the wages left after federal tax and FICA. Net pay is therefore never below zero.

## 6. Year-to-date

The caller owns persistence. `ytd` in the result is the input `ytd` plus this period, ready to be passed to the next period. Social Security, Additional Medicare, state wage bases and the NY PFL maximum all read it, so a chain of 26 results reproduces the single-shot annual amounts: tested within 13 cents (half a cent per period) for Social Security, Medicare and Additional Medicare across six salaries from $30,000 to $400,000, with the Social Security year total never above $11,439.00.

## 7. Rounding

- Every rate is scaled to 1e-6 of a percentage point and every product is computed in BigInt, so there are no floating-point half-cent errors.
- **Each tax line is computed from the period's wages and rounded once, half up, to the cent.** Lines are rounded independently, then summed; there is no rounding of the total.
- Federal income tax keeps full precision through the worksheet (annualize, table, Step 3 credit, divide by the number of periods) and is rounded once at the end; with `federalRounding: "dollar"` that result is rounded half up to whole dollars. Step 4(c) is added after rounding.
- State income tax is annualized at full precision and rounded once after dividing by the number of periods.
- The Social Security cap is applied after rounding the line, so YTD never exceeds the cap.
- `perPeriodCents` and salary-to-biweekly conversion round half up.

## 8. Sources

All retrieved **2026-10-24** for the **2026** tax year (rate set `us-2026`). "Parsed" means the document was downloaded and the numbers were read from the document text.

| Table | Source | Status |
| --- | --- | --- |
| Federal percentage-method schedules, Worksheet 1A, standard deduction offsets, biweekly wage bracket fixture | IRS Publication 15-T (2026), 3 Dec 2025, https://www.irs.gov/pub/irs-pdf/p15t.pdf | Parsed. Reproduced against all 1,068 wage bracket cells |
| Social Security 6.2% and $184,500 base, Medicare 1.45%, Additional Medicare 0.9% over $200,000 | IRS Publication 15 (2026) and Topics 751 and 560, https://www.irs.gov/publications/p15; SSA 2026 COLA, https://www.ssa.gov/oact/cola/cbb.html | Values entered from these publications; not re-fetched in this build. The base is cross-checked against `cost-rates.ts` |
| 401(k) $24,500 limit, $8,000 catch-up, $11,250 for ages 60 to 63, $150,000 Roth threshold | IRS Notice 2025-67, https://www.irs.gov/pub/irs-drop/n-25-67.pdf | Not re-fetched in this build |
| State statutory brackets, rates, standard deductions (36 jurisdictions) | Tax Foundation, State Individual Income Tax Rates and Brackets for 2026, https://taxfoundation.org/data/all/state/state-income-tax-rates-2026/ | Parsed. Secondary source: statutory values, not each state's withholding table |
| California | EDD 2026 Withholding Schedules, Method B, https://edd.ca.gov/siteassets/files/pdf_pub_ctr/26methb.pdf | Parsed. Official examples E and F are tests |
| New York | NYS-50-T-NYS (1/26), https://www.tax.ny.gov/pdf/publications/withholding/nys50_t_nys.pdf | Parsed. Official examples 1 to 3 are tests (within 5 cents) |
| Oregon | Form 150-206-436 (Rev. 12-31-25), https://www.oregon.gov/dor/forms/FormsPubs/withholding-tax-formulas_206-436_2026.pdf | Parsed. Official example 1 is a test (exact) |
| Pennsylvania | https://www.pa.gov/agencies/revenue/resources/tax-types-and-information/employer-withholding | Page returned 200 and shows 3.07% |
| New Jersey NJ-WT withholding tables (Sept 2025) | NJ Division of Taxation NJ-WT booklet; the exact download URL was not recorded | Downloaded, but the rate tables are images and could not be read; **not transcribed**. NJ uses statutory bands |
| Hawaii TDI | https://labor.hawaii.gov/dcd/home/about-tdi/ | Page returned 200 with the weekly wage base |
| Other insurance programs | URL in the table in section 9.1 | Rates were taken from the program pages or search-result summaries of them; see Known gaps for those not fetched directly |

Sources that could **not** be fetched directly, and what was done:

- **Maine PFML and Rhode Island TDI official pages**: the state pages returned 403 to an automated client. The rates in the rate set come from a Sun Life employer summary (Maine) and a New England Employee Benefits Council summary (Rhode Island). Both are secondary; the rates are 0.5% (Maine employee share, up to the Social Security wage base) and 1.1% of the first $100,000 (Rhode Island).
- **Minnesota PFML**: the official calculator page was not fetched; the rate and $185,000 cap come from a search result.
- **State withholding tables for the 36 `statutory` jurisdictions**: not transcribed. Fallback: annualize the statutory rates, with the documented simplifications in the table below.
- **IRS Pub 15 and Notice 2025-67, SSA**: see the table; entered from the publications and cross-checked, not re-fetched.

## 9. Jurisdictions (all 51)

Methods: **none** (no wage income tax), **flat**, **brackets**, **fallback** (effective rate). Status: **exact** means the state's own published 2026 method (or no tax) so there is nothing to approximate; **approximated** means statutory rates and annualization, so withholding can differ from the state's own table by cents to a few dollars a period, or, for the fallback states, by more.

Summary: 9 no-tax states and 4 states with their own published method (CA, NY, OR, PA) are exact: **13**. 36 are statutory approximations and 2 (AL, AR) are effective-rate fallbacks.

| Code | Jurisdiction | Method | 2026 rate | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| AL | Alabama | fallback | 4.2% effective | approximated: effective-rate fallback | Fallback 4.2% of state wages. Alabama deducts federal tax paid and phases its standard deduction by AGI. |
| AK | Alaska | none | 0% | exact (nothing to withhold) |  |
| AZ | Arizona | flat | 2.5% | approximated: statutory rates, not the state table | Statutory 2.5% flat. Real AZ withholding is the employee's Form A-4 percentage of gross, which is not collected. |
| AR | Arkansas | fallback | 3.1% effective | approximated: effective-rate fallback | Fallback 3.1% of state wages. Two rate tables split at $92,300 and a bracket adjustment, not transcribed. |
| CA | California | brackets | 10 bands, 1.1-14.63% | exact: state's own 2026 method | EDD Method B annual tables 3-7 (statutory rates x 1.1), low-income exemption, $168.30 credit per allowance. Married = 2+ allowances column. |
| CO | Colorado | flat | 4.4% | approximated: statutory rates, not the state table |  |
| CT | Connecticut | brackets | 7 bands, 2-6.99% | approximated: statutory rates, not the state table | Statutory bands, no exemption and no recapture: over-withholds below about $45,000. TPG-211 not transcribed. |
| DE | Delaware | brackets | 7 bands, 0-6.6% | approximated: statutory rates, not the state table |  |
| DC | District of Columbia | brackets | 7 bands, 4-10.75% | approximated: statutory rates, not the state table |  |
| FL | Florida | none | 0% | exact (nothing to withhold) |  |
| GA | Georgia | flat | 5.19% | approximated: statutory rates, not the state table | 5.19% as of 1 Jan 2026; scheduled step-downs not applied. |
| HI | Hawaii | brackets | 12 bands, 1.4-11% | approximated: statutory rates, not the state table |  |
| ID | Idaho | brackets | 2 bands, 0-5.3% | approximated: statutory rates, not the state table |  |
| IL | Illinois | flat | 4.95% | approximated: statutory rates, not the state table |  |
| IN | Indiana | flat | 2.95% | approximated: statutory rates, not the state table | Statutory 2.95% flat. County income tax out of scope. |
| IA | Iowa | flat | 3.8% | approximated: statutory rates, not the state table |  |
| KS | Kansas | brackets | 2 bands, 5.2-5.58% | approximated: statutory rates, not the state table |  |
| KY | Kentucky | flat | 3.5% | approximated: statutory rates, not the state table |  |
| LA | Louisiana | flat | 3% | approximated: statutory rates, not the state table |  |
| ME | Maine | brackets | 3 bands, 5.8-7.15% | approximated: statutory rates, not the state table | 2025 inflation-adjusted band widths (2026 widths not found). Deduction phase-outs ignored. |
| MD | Maryland | brackets | 10 bands, 2-6.5% | approximated: statutory rates, not the state table | State bands only; county tax (2.25% to 3.3%) is out of scope. |
| MA | Massachusetts | brackets | 2 bands, 5-9% | approximated: statutory rates, not the state table | 5%, plus the 4% surtax above $1,083,150. |
| MI | Michigan | flat | 4.25% | approximated: statutory rates, not the state table | Statutory 4.25% flat. City income tax out of scope. |
| MN | Minnesota | brackets | 4 bands, 5.35-9.85% | approximated: statutory rates, not the state table |  |
| MS | Mississippi | brackets | 2 bands, 0-4% | approximated: statutory rates, not the state table |  |
| MO | Missouri | brackets | 8 bands, 0-4.7% | approximated: statutory rates, not the state table |  |
| MT | Montana | brackets | 2 bands, 4.7-5.65% | approximated: statutory rates, not the state table |  |
| NE | Nebraska | brackets | 3 bands, 2.46-4.55% | approximated: statutory rates, not the state table |  |
| NV | Nevada | none | 0% | exact (nothing to withhold) |  |
| NH | New Hampshire | none | 0% | exact (nothing to withhold) | No tax on wages (interest and dividends tax repealed from 2025). |
| NJ | New Jersey | brackets | 7 bands, 1.4-10.75% | approximated: statutory rates, not the state table | Statutory bands with $1,000 per allowance; NJ-WT tables are images and were not transcribed. 401(k) deferrals are NJ wages. |
| NM | New Mexico | brackets | 6 bands, 1.5-5.9% | approximated: statutory rates, not the state table |  |
| NY | New York | brackets | 10 bands, 3.9-7.35% | exact: state's own 2026 method | NYS-50-T-NYS Method II annual schedule and Method III top-tier rates, $1,000 per exemption. Head of household withheld as single. Within 5 cents of the published per-period tables. |
| NC | North Carolina | flat | 3.99% | approximated: statutory rates, not the state table |  |
| ND | North Dakota | brackets | 3 bands, 0-2.5% | approximated: statutory rates, not the state table |  |
| OH | Ohio | brackets | 2 bands, 0-2.75% | approximated: statutory rates, not the state table | Statutory schedule, $2,400 exemption (top amount used). School district and city taxes out of scope. |
| OK | Oklahoma | brackets | 4 bands, 0-4.5% | approximated: statutory rates, not the state table |  |
| OR | Oregon | brackets (formula) | formula | exact: state's own 2026 method | OR 150-206-436 computer formula: federal tax subtracted (capped, phased out), standard deduction, two tables split at $50,000, $263 per allowance. Assumes an OR-W-4 with 0 allowances. |
| PA | Pennsylvania | flat | 3.07% | exact: state's own 2026 method | Flat 3.07% of compensation, no deductions. 401(k) deferrals stay in wages; Section 125 does not. |
| RI | Rhode Island | brackets | 3 bands, 3.75-5.99% | approximated: statutory rates, not the state table |  |
| SC | South Carolina | brackets | 3 bands, 0-6% | approximated: statutory rates, not the state table | 6.0% top rate as of 1 Jan 2026; the statutory move to 6.2% on 1 Jul 2026 is not applied. |
| SD | South Dakota | none | 0% | exact (nothing to withhold) |  |
| TN | Tennessee | none | 0% | exact (nothing to withhold) |  |
| TX | Texas | none | 0% | exact (nothing to withhold) |  |
| UT | Utah | flat | 4.5% | approximated: statutory rates, not the state table | 4.5% flat, the standard-deduction credit (at most $966) ignored: over-withholds below about $90,000. |
| VT | Vermont | brackets | 4 bands, 3.35-8.75% | approximated: statutory rates, not the state table |  |
| VA | Virginia | brackets | 4 bands, 2-5.75% | approximated: statutory rates, not the state table |  |
| WA | Washington | none | 0% | exact (nothing to withhold) | No wage income tax; PFML and WA Cares are insurance lines. |
| WV | West Virginia | brackets | 5 bands, 2.22-4.82% | approximated: statutory rates, not the state table |  |
| WI | Wisconsin | brackets | 4 bands, 3.5-7.65% | approximated: statutory rates, not the state table | Standard deduction phase-out ignored. |
| WY | Wyoming | none | 0% | exact (nothing to withhold) |  |

### 9.1 Employee-paid state payroll insurance lines

Each line is a separate tax line with its own YTD. Rates are the employee share only.

| State | Code | Program | Employee rate | Wage cap | Source |
| --- | --- | --- | --- | --- | --- |
| AK | `AK_UI` | AK unemployment insurance (employee) | 0.5% | $54,200 annual wage base | https://labor.alaska.gov/estax/2026-experience-rates.html |
| CA | `CA_SDI` | CA State Disability Insurance | 1.3% | no cap | https://edd.ca.gov/en/payroll_taxes/rates_and_withholding/ |
| CO | `CO_FAMLI` | CO FAMLI | 0.44% | $184,500 annual wage base | https://famli.colorado.gov/employers |
| CT | `CT_PFML` | CT Paid Leave | 0.5% | $184,500 annual wage base | https://www.ctpaidleave.org/how-ct-paid-leave-works/contributions |
| DE | `DE_PFML` | DE Paid Leave | 0.4% | $184,500 annual wage base | https://labor.delaware.gov/delaware-paid-leave/ |
| HI | `HI_TDI` | HI Temporary Disability Insurance | 0.5% | $1,500.21 weekly wage cap | https://labor.hawaii.gov/dcd/home/about-tdi/ |
| MA | `MA_PFML` | MA Paid Family and Medical Leave | 0.46% | $184,500 annual wage base | https://www.mass.gov/info-details/paid-family-and-medical-leave-employer-contribution-rates-and-calculator |
| ME | `ME_PFML` | ME Paid Family and Medical Leave | 0.5% | $184,500 annual wage base | https://www.sunlife.com/us/en/employers/products-and-services/paid-family-medical-leave/state-programs/ |
| MN | `MN_PFML` | MN Paid Leave | 0.44% | $185,000 annual wage base | https://pl.mn.gov/resources/calculators/premium-rate-and-contributions |
| NJ | `NJ_UI` | NJ unemployment insurance (employee) | 0.3825% | $44,800 annual wage base | https://www.nj.gov/labor/ea/employer-services/rate-info/ |
| NJ | `NJ_WF_SWF` | NJ workforce development and supplemental workforce fund | 0.0425% | $44,800 annual wage base | https://www.nj.gov/labor/ea/employer-services/rate-info/ |
| NJ | `NJ_TDI` | NJ Temporary Disability Insurance | 0.19% | $171,100 annual wage base | https://www.nj.gov/labor/lwdhome/press/2025/20251229_newbenefitrates2026.shtml |
| NJ | `NJ_FLI` | NJ Family Leave Insurance | 0.23% | $171,100 annual wage base | https://www.nj.gov/labor/lwdhome/press/2025/20251229_newbenefitrates2026.shtml |
| NY | `NY_SDI` | NY Disability Benefits (DBL) | 0.5% | $120.00 weekly wage cap | https://www.law.cornell.edu/regulations/new-york/12-NYCRR-362.2 |
| NY | `NY_PFL` | NY Paid Family Leave | 0.432% | $411.91 annual maximum | https://paidfamilyleave.ny.gov/2026 |
| OR | `OR_PAID_LEAVE` | OR Paid Leave | 0.6% | $184,500 annual wage base | https://paidleave.oregon.gov/employers/contributions-calculator.html |
| OR | `OR_WBF` | OR Workers' Benefit Fund | 0.9 cent per hour | no cap | https://www.oregon.gov/DCBS/wbf/Documents/4999.pdf |
| PA | `PA_UC` | PA unemployment compensation (employee) | 0.07% | no cap | https://www.pa.gov/agencies/dli/resources/for-employers-and-educators/how-to-file/uc-tax/employee-withholding |
| RI | `RI_TDI` | RI Temporary Disability Insurance | 1.1% | $100,000 annual wage base | https://www.neebc.org/index.php?day=04&id=184%3Apaid-family-and-medical-leave-around-new-england-2026-updates&month=02&option=com_dailyplanetblog&view=entry&year=2026 |
| WA | `WA_PFML` | WA Paid Family and Medical Leave | 0.807159% | $184,500 annual wage base | https://paidleave.wa.gov/estimate-your-paid-leave-payments/ |
| WA | `WA_CARES` | WA Cares Fund | 0.58% | no cap | https://wacaresfund.wa.gov/toolkit/paid-leave |

## 10. Known gaps

- **Local taxes** (city, county, school district, e.g. NYC, Yonkers, Ohio municipalities, Maryland county tax, Pennsylvania local earned income tax) are not computed.
- **36 states use statutory annualization**, not the state's own withholding table. Differences: cents to a few dollars per period.
- **Alabama and Arkansas** are effective-rate fallbacks (4.2% and 3.1% of state wages).
- **Arizona** real withholding is the employee's Form A-4 percentage of gross, which is not collected. The statutory 2.5% less standard deduction is used.
- **Connecticut** has no exemption phase-out or recapture, so it over-withholds below about $45,000 of annual wages. **Utah** ignores the standard deduction credit (over-withholds below about $90,000). **Georgia** and **South Carolina** scheduled rate changes are not applied. **Maine** uses 2025 band widths.
- **New Jersey**: NJ-WT tables are images and were not transcribed; statutory bands are used.
- **California** married uses the 2-or-more-allowances column; the estimated-deduction allowance (DE 4 line 2) is not modelled. **New York** head of household is withheld as single, and the NY per-period tables can differ from the annual method by a few cents.
- **Oregon** assumes an OR-W-4 with 0 allowances; without one Oregon requires flat 8% instead. The table's published quirk is kept: tax drops $263 a year when annual wages reach $50,000, so Oregon withholding is not monotone there.
- State withholding assumes **single and 0 allowances** unless the caller passes `stateElection`.
- **Roth catch-up** designation is not enforced. Catch-up eligibility is supplied by the caller, not derived from a birth date.
- **Supplemental wages** (bonuses) are withheld as regular wages, not at the 22% flat rate.
- **Insurance programs**: small-employer variants (for example WA PFML, MA PFML and CO FAMLI where an employer under a headcount threshold may pass on more) and exemption elections (WA Cares) are not modelled. Several 2026 rates were taken from search-result summaries, listed in section 8.
- **FUTA, employer taxes and employer-paid insurance** are in `cost-rates.ts`, not here.
- Pay period count is a parameter. The calculator does not know which year has 27 pay dates.

## 11. Verification

- Federal golden cases hand-checked against the Worksheet 1A arithmetic in this document: single, married filing jointly, head of household, Step 2 checkbox, Step 3 dependents credit, Step 4 adjustments and extra withholding, the 27-period case.
- 1,068 IRS wage-bracket cells reproduced (section 5.2).
- Official worked examples: California Method B examples E and F (exact), New York examples 1 to 3 (within 5 cents), Oregon example 1 (exact).
- Social Security wage-base crossing and cap, Additional Medicare crossing, 401(k) limit and catch-up, Section 125 and 401(k) effects.
- State cases: no-tax (TX), flat (PA, IL, CO), graduated (CA, NJ, NY, OR), insurance states (CA, NY, NJ, WA, HI, RI, OR, AK).
- Properties: federal withholding never decreases with gross (26 and 27 periods, all filing statuses and Step 2); state income tax never decreases with wages in 50 jurisdictions (Oregon excluded, see above); net + taxes + deductions = gross; a 26-period YTD chain equals the single-shot annual amount within rounding; all 51 jurisdictions run without error at six pay levels.

Run with `pnpm vitest run src/domain/payroll`.

## 12. Updating for a new tax year

Add a new `WithholdingRateSet` (for example `us-2027`) next to `US_2026_WITHHOLDING` and register it in `getWithholdingRateSet`; do not edit `us-2026`, so old pay slips still reproduce. Update the Pub 15-T tables, the 401(k) limits, the Social Security base (and `cost-rates.ts` with it), and each state's brackets and insurance lines, then re-run the wage bracket fixture test against that year's Pub 15-T.
