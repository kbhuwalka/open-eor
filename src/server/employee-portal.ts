/**
 * Read models for the employee portal (employee-portal.md). Everything is scoped by the session
 * user's id: the case is the one whose `worker_user_id` is that user (acl I3), and a task or
 * document that is not theirs reads as absent, never as forbidden (acl I6). Nothing here names a
 * task key; screens are chosen by task `type`, and the wording comes from the template.
 */
import { and, desc, eq, inArray } from "drizzle-orm"

import type { AppDatabase } from "@/db/client"
import { loadTemplateById } from "@/db/workflow-templates"
import {
  benefitElections,
  caseDocuments,
  caseEvents,
  clientCompanies,
  formSubmissions,
  generatedDocuments,
  hireRequests,
  onboardingCases,
  roles,
  tasks as tasksTable,
  users,
} from "@/db/schema"
import { payPeriodContaining } from "@/domain/billing"
import { todayIso } from "@/domain/employment-term"
import { US_2026 } from "@/domain/cost-rates"
import { maskDocumentNumber } from "@/domain/forms"
import { personStatusFor, type PersonStatus } from "@/domain/person-status"
import {
  projectStages,
  projectTasks,
  type ProjectedStage,
  type Task,
  type WorkflowTemplate,
} from "@/domain/tasks"
import type { BenefitPackage, CaseLifecycle, DocumentKind, WageUnit } from "@/domain/types"
import { selectActiveIdentityDocuments } from "@/domain/work-auth"
import {
  grossPerPeriodCents,
  healthTierOptions,
  retirementRule,
  RETIREMENT_DEFERRAL_MAX_PCT,
} from "@/lib/employee-benefits"
import {
  EMPLOYEE_TASK_HREF,
  firstNameOf,
  nextStep,
  stepsFromStages,
  type EmployeeOrderView,
  type EmployeeStep,
} from "@/lib/employee-view"
import type {
  CompletedSummary,
  EmployeePrefill,
  EmployeeScreenData,
  EmployeeScreenSpecific,
  EmployeeUploadView,
} from "@/lib/employee-screen-data"
import { stateName } from "@/lib/us-states"

import { decryptFields, maskSsn } from "./field-crypto"
import { identityDetailsOf } from "./identity-documents"
import { rowToTask } from "./task-store"

export type EmployeeCase = {
  caseId: string
  hireId: string
  lifecycle: CaseLifecycle
  workerUserId: string
  displayName: string
  firstName: string
  email: string
  order: EmployeeOrderView
  template: WorkflowTemplate
  tasks: Task[]
  stages: ProjectedStage[]
  steps: EmployeeStep[]
  goLiveReached: boolean
  status: PersonStatus
  now: Date
}

/** The employee's own case: the one whose worker is the session user. Zero cases reads as null. */
export function loadEmployeeCase(db: AppDatabase, userId: string, now: Date = new Date()): EmployeeCase | null {
  const row = db
    .select({
      caseId: onboardingCases.id,
      hireId: hireRequests.id,
      lifecycle: onboardingCases.lifecycle,
      templateId: onboardingCases.templateId,
      workerUserId: onboardingCases.workerUserId,
      displayName: users.displayName,
      email: users.email,
      clientName: clientCompanies.name,
      roleTitle: roles.name,
      startDate: hireRequests.startDate,
      createdAt: onboardingCases.createdAt,
      endDate: hireRequests.endDate,
      stateCode: hireRequests.stateCode,
      wageCents: hireRequests.wageCents,
      wageUnit: hireRequests.wageUnit,
      benefitPackage: hireRequests.package,
    })
    .from(onboardingCases)
    .innerJoin(hireRequests, eq(hireRequests.id, onboardingCases.hireRequestId))
    .innerJoin(users, eq(users.id, onboardingCases.workerUserId))
    .innerJoin(clientCompanies, eq(clientCompanies.id, hireRequests.clientCompanyId))
    .innerJoin(roles, eq(roles.id, hireRequests.roleId))
    .where(eq(onboardingCases.workerUserId, userId))
    .orderBy(desc(onboardingCases.createdAt))
    .get()
  if (!row) return null

  const { template } = loadTemplateById(db, row.templateId)
  const tasks = db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.caseId, row.caseId))
    .orderBy(tasksTable.seq)
    .all()
    .map(rowToTask)
  const startDate = row.startDate ?? todayIso(row.createdAt)
  const projection = projectTasks(tasks, { now, startDate })
  const stages = projectStages(tasks, template, "worker", now, startDate)
  const steps = stepsFromStages(stages, (item) => EMPLOYEE_TASK_HREF(item.id))

  return {
    caseId: row.caseId,
    hireId: row.hireId,
    lifecycle: row.lifecycle,
    workerUserId: row.workerUserId,
    displayName: row.displayName,
    firstName: firstNameOf(row.displayName),
    email: row.email,
    order: {
      employerName: row.clientName,
      roleTitle: row.roleTitle,
      startDate,
      endDate: row.endDate,
      stateCode: row.stateCode,
      stateName: stateName(row.stateCode),
      wageCents: row.wageCents,
      wageUnit: row.wageUnit as WageUnit,
      benefitPackage: row.benefitPackage as BenefitPackage,
      firstPayDate: payPeriodContaining(startDate).payDate,
    },
    template,
    tasks,
    stages,
    steps,
    goLiveReached: projection.goLiveReached,
    status: personStatusFor({ lifecycle: row.lifecycle, goLiveReached: projection.goLiveReached, endDate: row.endDate, now }),
    now,
  }
}

function latestSubmission(db: AppDatabase, caseId: string, formType: string) {
  return db
    .select()
    .from(formSubmissions)
    .where(and(eq(formSubmissions.caseId, caseId), eq(formSubmissions.formType, formType)))
    .orderBy(desc(formSubmissions.createdAt))
    .get()
}

function parseRecord(text: string | null): Record<string, unknown> {
  if (!text) return {}
  try {
    const value = JSON.parse(text) as unknown
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

const text = (value: unknown): string => (typeof value === "string" ? value : "")

/** "Maya A. Chen" → first Maya, middle initial A, last Chen. */
export function splitLegalName(name: string): { firstName: string; middleInitial: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length <= 1) return { firstName: parts[0] ?? "", middleInitial: "", lastName: "" }
  const middle = parts.length > 2 ? parts[1].replace(/\.$/, "") : ""
  return { firstName: parts[0], middleInitial: middle.length === 1 ? middle.toUpperCase() : "", lastName: parts[parts.length - 1] }
}

/** What the forms start with: the account name and email, plus the personal details already given. */
export function prefillFor(db: AppDatabase, employee: Pick<EmployeeCase, "caseId" | "displayName" | "email">): EmployeePrefill {
  const saved = latestSubmission(db, employee.caseId, "personal_details")
  const data = parseRecord(saved?.dataJson ?? null)
  const legalName = text(data.legalName) || employee.displayName
  const address = parseRecord(JSON.stringify(data.address ?? {}))
  const hasAddress = text(address.line1) !== ""
  return {
    legalName,
    ...splitLegalName(legalName),
    email: employee.email,
    phone: text(data.phone),
    address: hasAddress
      ? { line1: text(address.line1), line2: text(address.line2), city: text(address.city), state: text(address.state), zip: text(address.zip) }
      : null,
  }
}

const MIME_BY_EXTENSION: Record<string, EmployeeUploadView["mime"]> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  pdf: "application/pdf",
}

export function mimeForFileName(fileName: string): EmployeeUploadView["mime"] {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? ""
  return MIME_BY_EXTENSION[extension] ?? "application/pdf"
}

/**
 * The employee's identity documents as they see them: one active document per kind, with what
 * happened to it. A document is `accepted` once Northwind verified the case, `rejected` when it
 * was uploaded before the latest rejection and the upload task is open again, else `uploaded`.
 */
export function uploadsFor(db: AppDatabase, employee: EmployeeCase): EmployeeUploadView[] {
  const rows = db.select().from(caseDocuments).where(eq(caseDocuments.caseId, employee.caseId)).all()
  const active = selectActiveIdentityDocuments(rows.map((row) => ({ ...row, createdAt: row.createdAt.getTime() })))
  const verified = employee.tasks.filter((task) => task.type === "verify_i9_section2" && task.status === "done")
  const reviewedAt = verified.reduce<number>((latest, task) => Math.max(latest, task.completedAt?.getTime() ?? 0), 0)
  const rejections = db
    .select({ createdAt: caseEvents.createdAt })
    .from(caseEvents)
    .where(and(eq(caseEvents.caseId, employee.caseId), eq(caseEvents.type, "task_rejected")))
    .orderBy(desc(caseEvents.createdAt))
    .all()
  const sentBackAt = rejections[0]?.createdAt.getTime() ?? null
  const reworkOpen = employee.steps.some((step) => step.type === "upload_documents" && step.rework !== null && step.status !== "done")
  return active.map((doc) => {
    const status: EmployeeUploadView["status"] =
      reworkOpen && sentBackAt !== null && doc.createdAt <= sentBackAt
        ? "rejected"
        : verified.length > 0 && doc.createdAt <= reviewedAt
          ? "accepted"
          : "uploaded"
    const details = identityDetailsOf(doc)
    return {
      id: doc.id,
      kind: doc.kind as DocumentKind,
      fileName: doc.fileName,
      uploadedAt: new Date(doc.createdAt).toISOString(),
      mime: mimeForFileName(doc.fileName),
      href: `/api/documents/${doc.id}`,
      status,
      details: details && {
        title: details.title,
        issuingAuthority: details.issuingAuthority,
        maskedNumber: maskDocumentNumber(details.number),
        expiresOn: details.expiresOn,
      },
    }
  })
}

export function electionFor(db: AppDatabase, caseId: string) {
  const row = db.select().from(benefitElections).where(eq(benefitElections.caseId, caseId)).get()
  if (!row) return null
  return {
    enrolled: row.enrolled,
    healthTier: row.healthTier,
    retirementDeferralPct: row.retirementDeferralPct,
    decidedAt: row.decidedAt.toISOString(),
  }
}

const SIGNED_KINDS: Record<string, string> = {
  sign_agreement: "employment_agreement",
  i9_section1: "i9_section1",
  w4: "w4",
  direct_deposit: "direct_deposit_authorization",
}

/** The generated-document kind a signing task produces, or null for tasks that sign nothing. */
export function signedKindFor(taskType: string): string | null {
  return SIGNED_KINDS[taskType] ?? null
}

function completedFor(db: AppDatabase, employee: EmployeeCase, task: Task): CompletedSummary | null {
  if (task.status !== "done" || !task.completedAt) return null
  const rows: CompletedSummary["rows"] = []
  const result = task.result ?? {}
  const kind = signedKindFor(task.type)
  const doc = kind
    ? db
        .select({ id: generatedDocuments.id, storagePath: generatedDocuments.storagePath })
        .from(generatedDocuments)
        .where(and(eq(generatedDocuments.caseId, employee.caseId), eq(generatedDocuments.kind, kind)))
        .orderBy(desc(generatedDocuments.createdAt))
        .get()
    : undefined

  switch (task.type) {
    case "sign_agreement":
      rows.push({ label: "Signed as", value: text(result.signedAs) })
      break
    case "personal_details": {
      const saved = latestSubmission(db, employee.caseId, "personal_details")
      const data = parseRecord(saved?.dataJson ?? null)
      const address = parseRecord(JSON.stringify(data.address ?? {}))
      rows.push({ label: "Legal name", value: text(data.legalName) })
      rows.push({ label: "Phone", value: text(data.phone) })
      if (text(address.line1)) {
        rows.push({
          label: "Address",
          value: [text(address.line1), text(address.line2), `${text(address.city)}, ${text(address.state)} ${text(address.zip)}`]
            .filter(Boolean)
            .join(", "),
        })
      }
      const emergency = parseRecord(JSON.stringify(data.emergencyContact ?? {}))
      if (text(emergency.name)) {
        rows.push({ label: "Emergency contact", value: `${text(emergency.name)} (${text(emergency.relationship)}), ${text(emergency.phone)}` })
      }
      if (saved?.encryptedJson) {
        try {
          const ssn = decryptFields(saved.encryptedJson).ssn
          if (typeof ssn === "string") rows.push({ label: "Social Security number", value: maskSsn(ssn) })
        } catch {
          /* an unreadable value is simply not shown */
        }
      }
      break
    }
    case "i9_section1":
      rows.push({ label: "Attestation", value: text(result.citizenshipStatus).replace(/_/g, " ") })
      break
    case "upload_documents": {
      const ids = Array.isArray(result.documentIds) ? (result.documentIds as string[]) : []
      const files = ids.length
        ? db
            .select({ fileName: caseDocuments.fileName, kind: caseDocuments.kind })
            .from(caseDocuments)
            .where(inArray(caseDocuments.id, ids))
            .all()
        : []
      rows.push({ label: "Submitted", value: files.map((file) => file.fileName).join(", ") || "Documents" })
      break
    }
    case "w4":
      rows.push({ label: "Filing status", value: text(result.filingStatus).replace(/_/g, " ") })
      break
    case "direct_deposit":
      rows.push({ label: "Account", value: `••••${text(result.last4)}` })
      break
    case "benefits_decision": {
      const decision = text(result.decision)
      rows.push({ label: "Decision", value: decision === "decline" ? "Declined benefits" : "Enrolled" })
      break
    }
  }
  return { completedAt: task.completedAt.toISOString(), rows: rows.filter((row) => row.value !== ""), documentId: doc?.storagePath ? doc.id : null }
}

function benefitsData(db: AppDatabase, employee: EmployeeCase): EmployeeScreenSpecific & { kind: "benefits_decision" } {
  const pkg = employee.order.benefitPackage
  const rate = retirementRule(pkg)
  const info = US_2026.packages[pkg]
  return {
    kind: "benefits_decision",
    benefits: {
      package: pkg,
      packageLabel: info.label,
      packageDescription: info.description,
      grossPerPeriodCents: grossPerPeriodCents(employee.order.wageCents, employee.order.wageUnit),
      tiers: healthTierOptions(pkg),
      match: { ratePct: rate.matchRatePct, capPct: rate.matchCapPct, defaultPct: rate.defaultPct, maxPct: RETIREMENT_DEFERRAL_MAX_PCT },
      election: electionFor(db, employee.caseId),
    },
  }
}

function nextOf(steps: EmployeeStep[], exceptId: string) {
  const next = nextStep(steps, exceptId)
  return next ? { href: next.href, label: next.label } : null
}

/**
 * Everything one task screen renders, or null when the task is not this employee's (another
 * person's task, a specialist task, a system task and an unknown id are all the same answer).
 */
export function loadEmployeeScreen(
  db: AppDatabase,
  userId: string,
  taskId: string,
  now: Date = new Date(),
): EmployeeScreenData | null {
  const employee = loadEmployeeCase(db, userId, now)
  if (!employee) return null
  const task = employee.tasks.find((candidate) => candidate.id === taskId)
  if (!task || !task.actors.includes("worker")) return null
  const step = employee.steps.find((candidate) => candidate.id === taskId)
  // Skipped and replaced tasks have no place in the employee's list.
  if (!step) return null

  const common = {
    nowIso: now.toISOString(),
    step,
    taskId: task.id,
    caseId: employee.caseId,
    order: employee.order,
    workerName: employee.displayName,
    canAct: step.status === "ready" && step.canAct && employee.lifecycle === "open",
    completed: completedFor(db, employee, task),
    next: nextOf(employee.steps, task.id),
  }

  switch (task.type) {
    case "accept_invitation":
      return {
        ...common,
        kind: "accept_invitation",
        upcoming: employee.steps.filter((candidate) => candidate.id !== task.id && candidate.status !== "done").map((candidate) => candidate.label),
      }
    case "sign_agreement":
      return { ...common, kind: "sign_agreement" }
    case "personal_details":
    case "i9_section1":
    case "w4":
      return { ...common, kind: task.type, prefill: prefillFor(db, employee) }
    case "upload_documents":
      return { ...common, kind: "upload_documents", uploads: uploadsFor(db, employee), rework: step.rework }
    case "direct_deposit":
      return { ...common, kind: "direct_deposit", holderName: prefillFor(db, employee).legalName }
    case "benefits_decision":
      return { ...common, ...benefitsData(db, employee) }
    default:
      return null
  }
}

