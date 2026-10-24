/**
 * State-specific clause hooks for the employment agreement, keyed by two-letter state code.
 * Data only: add a state by adding an entry. A state with no entry gets the general terms alone.
 * The text is illustrative demo copy, not legal advice.
 */

export type StateClause = {
  /** Short heading shown in the state addendum. */
  title: string
  /** One paragraph of agreement text; may use `{{state}}` and any merge field. */
  text: string
}

export const STATE_CLAUSES: Readonly<Record<string, readonly StateClause[]>> = {
  CA: [
    {
      title: "Inventions excluded by California Labor Code section 2870",
      text: "Section 8 of this Agreement does not apply to an invention that Employee developed entirely on Employee's own time without using the Company's, the Client's or their equipment, supplies, facilities or trade secret information, except for an invention that relates at the time of conception or reduction to practice to the Company's or the Client's business, or to their actual or demonstrably anticipated research or development, or that results from any work performed by Employee for them.",
    },
    {
      title: "Wages, final pay and expense reimbursement",
      text: "Wages earned are paid on regular paydays. If employment ends, final wages are paid at the times required by California Labor Code sections 201 to 203. The Company reimburses all necessary business expenses Employee incurs in carrying out the job, as required by Labor Code section 2802, and provides paid sick leave as required by the Healthy Workplaces, Healthy Families Act.",
    },
    {
      title: "No restraint on lawful work",
      text: "Nothing in this Agreement prevents Employee from engaging in a lawful profession, trade or business after employment ends, consistent with California Business and Professions Code sections 16600 and 16600.5.",
    },
  ],
  NY: [
    {
      title: "Pay notice and paid leave",
      text: "Employee acknowledges receipt of the written notice of pay rate, designated payday and the Company's contact details required by New York Labor Law section 195(1). Employee is entitled to paid sick and safe leave under New York Labor Law section 196-b and to paid family leave under the New York Paid Family Leave Benefits Law.",
    },
  ],
  WA: [
    {
      title: "Inventions excluded by RCW 49.44.140",
      text: "Section 8 of this Agreement does not apply to an invention for which no equipment, supplies, facilities or trade secret information of the Company or the Client was used and that was developed entirely on Employee's own time, unless the invention relates directly to the business of the Company or the Client, or to their actual or demonstrably anticipated research or development, or results from work performed by Employee for them, as provided in RCW 49.44.140.",
    },
    {
      title: "Paid sick leave",
      text: "Employee accrues paid sick leave at the rate required by RCW 49.46.210 and may use it as that law allows. The Company will give any notice of a post-employment restriction that RCW 49.62 requires.",
    },
  ],
  IL: [
    {
      title: "Inventions excluded by the Illinois Employee Patent Act",
      text: "Section 8 of this Agreement does not apply to an invention that Employee developed entirely on Employee's own time without using the Company's or the Client's equipment, supplies, facilities, trade secrets or confidential information, except for an invention that relates to their business or actual or demonstrably anticipated research or development, or that results from work performed by Employee for them (765 ILCS 1060/2).",
    },
    {
      title: "Paid leave",
      text: "Employee accrues paid leave under the Paid Leave for All Workers Act (820 ILCS 192) and any applicable local ordinance, and may use it as those laws provide.",
    },
  ],
  TX: [
    {
      title: "Payment of wages",
      text: "Wages are paid in accordance with the Texas Payday Law (Texas Labor Code chapter 61). Employment in Texas is at will unless this Agreement states a fixed term.",
    },
  ],
  CO: [
    {
      title: "Paid sick leave",
      text: "Employee accrues paid sick leave under the Colorado Healthy Families and Workplaces Act (C.R.S. 8-13.3-401 et seq.) and may use it for the purposes that law allows. Any post-employment restriction takes effect only if the Company has given Employee the separate notice that C.R.S. 8-2-113 requires.",
    },
  ],
  MA: [
    {
      title: "Earned sick time",
      text: "Employee earns sick time as provided by the Massachusetts Earned Sick Time law (M.G.L. c. 149, section 148C). Wages are paid within the periods set by the Massachusetts Wage Act (M.G.L. c. 149, section 148).",
    },
  ],
  NJ: [
    {
      title: "Earned sick leave and inventions",
      text: "Employee accrues earned sick leave under the New Jersey Earned Sick Leave Law (N.J.S.A. 34:11D-1 et seq.). Section 8 of this Agreement does not apply to an invention that Employee developed entirely on Employee's own time without using the Company's or the Client's equipment, supplies, facilities or trade secret information, unless it relates to their business or research, or results from work performed by Employee for them (N.J.S.A. 34:1B-265).",
    },
  ],
  MN: [
    {
      title: "Inventions and post-employment restrictions",
      text: "Section 8 of this Agreement does not apply to an invention that qualifies for the exclusion in Minnesota Statutes section 181.78. Nothing in this Agreement restricts Employee from working for another employer after employment ends in a way that Minnesota Statutes section 181.988 prohibits.",
    },
  ],
  NC: [
    {
      title: "Inventions excluded by N.C.G.S. 66-57.1",
      text: "Section 8 of this Agreement does not apply to an invention that Employee developed entirely on Employee's own time without using the Company's or the Client's equipment, supplies, facilities or trade secret information, except an invention that relates to their business or research or results from work performed by Employee for them (N.C.G.S. 66-57.1 and 66-57.2).",
    },
  ],
  DC: [
    {
      title: "Accrued sick and safe leave",
      text: "Employee accrues paid sick and safe leave under the District of Columbia Accrued Sick and Safe Leave Act and may use it as that law provides.",
    },
  ],
}

export function stateClausesFor(stateCode: string): readonly StateClause[] {
  return STATE_CLAUSES[stateCode] ?? []
}
