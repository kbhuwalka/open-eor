/**
 * The data each employee task screen needs, as plain serialisable types. Built on the server
 * (`src/server/employee-portal.ts`), consumed by the components in `src/components/employee-tasks`.
 * Nothing here is sensitive: an SSN or account number never leaves the server in full.
 */
import type { HealthTier } from "@/domain/cost-rates"
import type { BenefitPackage, DocumentKind } from "@/domain/types"

import type { HealthTierOption } from "./employee-benefits"
import type { EmployeeOrderView, EmployeeStep } from "./employee-view"

/** Fields the forms start with, taken from what the employee already told us. Never an SSN or birth date. */
export type EmployeePrefill = {
  legalName: string
  firstName: string
  middleInitial: string
  lastName: string
  email: string
  phone: string
  address: { line1: string; line2: string; city: string; state: string; zip: string } | null
}

export type EmployeeUploadView = {
  id: string
  kind: DocumentKind
  fileName: string
  uploadedAt: string
  mime: "image/png" | "image/jpeg" | "application/pdf"
  /** Streams the file to its owner (acl F5). */
  href: string
  /** `uploaded`: waiting for Northwind; `accepted`: verified; `rejected`: Northwind sent it back; `replaced`: superseded. */
  status: "uploaded" | "accepted" | "rejected"
  /** What the employee entered about the document; null for an upload made before details were asked for. */
  details: UploadDetailsView | null
}

export type UploadDetailsView = {
  title: string
  issuingAuthority: string
  /** `•••• 6789`; the full number never reaches the browser. */
  maskedNumber: string
  /** `YYYY-MM-DD`, null when the document has no expiration date. */
  expiresOn: string | null
}

export type BenefitElectionView = {
  enrolled: boolean
  healthTier: HealthTier | null
  retirementDeferralPct: number | null
  decidedAt: string
}

export type BenefitsScreenData = {
  package: BenefitPackage
  packageLabel: string
  packageDescription: string
  grossPerPeriodCents: number
  tiers: HealthTierOption[]
  match: { ratePct: number; capPct: number; defaultPct: number; maxPct: number }
  election: BenefitElectionView | null
}

/** A finished task: what the employee gave, without anything sensitive, and the signed copy if one is stored. */
export type CompletedSummary = {
  completedAt: string
  rows: { label: string; value: string }[]
  documentId: string | null
}

export type EmployeeScreenCommon = {
  /** The server's clock for this render (ISO), so due labels and the start countdown agree everywhere. */
  nowIso: string
  step: EmployeeStep
  taskId: string
  caseId: string
  order: EmployeeOrderView
  workerName: string
  /** The task is ready and this employee may complete it now. */
  canAct: boolean
  completed: CompletedSummary | null
  /** The next task to do after this one, if any. */
  next: { href: string; label: string } | null
}

export type EmployeeScreenSpecific =
  | { kind: "accept_invitation"; upcoming: string[] }
  | { kind: "sign_agreement" }
  | { kind: "personal_details"; prefill: EmployeePrefill }
  | { kind: "i9_section1"; prefill: EmployeePrefill }
  | { kind: "upload_documents"; uploads: EmployeeUploadView[]; rework: { code: string; note?: string } | null }
  | { kind: "w4"; prefill: EmployeePrefill }
  | { kind: "direct_deposit"; holderName: string }
  | { kind: "benefits_decision"; benefits: BenefitsScreenData }

export type EmployeeScreenData = EmployeeScreenCommon & EmployeeScreenSpecific
