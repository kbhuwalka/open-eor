/**
 * Task types whose completion carries evidence a generic `{ payload }` cannot: a typed e-signature
 * applied to a stored document (`accept_agreement`, `sign_agreement`, `i9_section1`, `w4`,
 * `direct_deposit`), or answers the screen's own action validates and stores encrypted
 * (`personal_details`, `upload_documents`, `benefits_decision`), or the specialist's I-9 Section 2
 * (`verify_i9_section2`: the signed document and its hash-verified copy are stored with the
 * completion). Each has a dedicated Server Action (`signAgreementTaskAction`,
 * `src/app/worker/tasks/actions.ts`; `acceptSection2Action`, `src/app/onboarding/actions.ts`);
 * the shared `completeTaskAction` refuses them, so the only way to finish one is through the flow
 * that produces the evidence.
 *
 * Specialist tasks that are not listed finish through the shared action on purpose: their handler
 * (`DEFAULT_HANDLERS`) requires everything their screen collects (`setup_payroll` a pay frequency,
 * `file_new_hire_report` and `submit_benefit_enrollments` a confirmation number), and
 * `review_order` is an approval with an optional note, so a bare completion is the whole act.
 */
export const DEDICATED_COMPLETION_TYPES: ReadonlySet<string> = new Set([
  "accept_agreement",
  "sign_agreement",
  "personal_details",
  "i9_section1",
  "upload_documents",
  "w4",
  "direct_deposit",
  "benefits_decision",
  "verify_i9_section2",
])
