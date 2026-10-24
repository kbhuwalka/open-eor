/**
 * Server-only document generation: official-form filling, the employment agreement, direct deposit
 * authorizations, invoice and pay slip PDFs, typed e-signatures and sensitive-field encryption. Import from Server Actions and
 * route handlers only; the Client Components in `src/components` call these through callbacks.
 */

export { fillW4, type FillW4Options } from "./fill-w4"
export { fillI9Section1, fillI9Section2, type FillI9Options } from "./fill-i9"
export {
  generateEmploymentAgreement,
  renderEmploymentAgreement,
  validateAgreementInput,
  AGREEMENT_SIGNATURE_KEYS,
  PAY_FREQUENCIES,
  NORTHWIND_ENTITY,
  type EmploymentAgreementInput,
  type PayFrequency,
} from "./agreement"
export {
  generateMasterAgreement,
  renderMasterAgreement,
  validateMasterAgreementInput,
  MASTER_AGREEMENT_KIND,
  MASTER_AGREEMENT_SIGNATURE_KEYS,
  MASTER_AGREEMENT_SIGNER_ROLE,
  MASTER_AGREEMENT_TITLE,
  type MasterAgreementInput,
} from "./master-agreement"
export { STATE_CLAUSES, stateClausesFor, type StateClause } from "./state-clauses"
export { generateInvoicePdf, paymentMethodLabel, type InvoicePdfInput } from "./invoice-pdf"
export {
  generatePayslipPdf,
  payslipFromWithholding,
  type PayslipContext,
  type PayslipInput,
  type PayslipLine,
} from "./payslip-pdf"
export { buildDirectDepositAuthorization, DIRECT_DEPOSIT_SIGNATURE_KEY, type DirectDepositOptions } from "./direct-deposit"
export {
  applyEsignature,
  verifySignedDocument,
  readSignatureRecords,
  OFFICIAL_SIGNATURE_KEYS,
  DEFAULT_TIME_ZONE,
  type SignatureInput,
  type SignedDocument,
  type VerificationResult,
  type VerifiedSignature,
} from "./esign"
export {
  encryptSecret,
  decryptSecret,
  isEncryptedSecret,
  maskSsn,
  maskEncryptedSsn,
  SecretError,
} from "./secrets"
export { DocumentInputError, SignatureError, type SignatureErrorCode } from "./errors"
export { sha256Hex } from "./pdf-utils"
export { describeSignatureFields, type GeneratedDocument, type DescribeOptions } from "./signature-fields"
