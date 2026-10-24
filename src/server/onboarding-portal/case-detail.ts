/**
 * The full-fidelity staff view of one case (onboarding-portal.md §3): every task with who and when,
 * the documents and where each stands, the forms the employee filled in (sensitive values masked,
 * never revealed), the order and its money, and the activity log with real actor names.
 *
 * Staff only. The page asks `staffCaseDetail`, which returns null for any other role, so a client or
 * an employee reaches a 404 for the same URL.
 */
import { asc, desc, eq, sql } from "drizzle-orm"

import type { AppDatabase } from "@/db/client"
import {
  caseDocuments,
  caseEvents,
  documentSignatures,
  generatedDocuments,
  invoices,
  users,
} from "@/db/schema"
import { invoiceDisplayStatus } from "@/domain/billing/payments"
import { US_2026 } from "@/domain/cost-rates"
import { todayIso } from "@/domain/employment-term"
import { personStatusFor, type PersonStatus } from "@/domain/person-status"
import { projectStages, projectTasks, type ProjectedStage, type Task, type TaskParty } from "@/domain/tasks"
import { selectActiveIdentityDocuments } from "@/domain/work-auth"
import { W4_FILING_STATUS_LABELS, type W4FilingStatus } from "@/domain/forms"
import type { CaseEventType, DocumentKind, PolicySnapshotV1, QuoteLine, WageUnit } from "@/domain/types"
import { rejectReasonText, atRiskMessage } from "@/lib/task-view"
import { taskUiFor } from "@/lib/task-ui-registry"
import type { UploadedDocumentView } from "@/lib/onboarding-portal/i9-review"
import { decryptFields } from "../field-crypto"
import { maskSsn } from "../documents"
import type { TimelineEntry } from "../queries"
import { loadInvoices, loadPaymentsForInvoices } from "../billing-core"
import { tasksForCase } from "../tasks"

import { caseBasics, isSpecialist, latestForm, safeJson, templateFor, type StaffViewer } from "./core"
import { depositViewFor, type DepositView } from "./order-review"
import { readSignedFile, readStoredFile, sniffUploadType } from "../uploads"

export type StaffTaskItem = {
  id: string
  type: string
  label: string
  status: "blocked" | "ready" | "done"
  party: TaskParty
  /** "Employee", "Client", "Onboarding", "Finance": who owns the step. */
  ownerLabel: string
  dueDate: string | null
  overdue: boolean
  hidden: boolean
  completedAt: string | null
  completedBy: string | null
  /** The open task was created by a rejection; why. */
  rework: string | null
  /** Earlier instances of this step that were sent back. */
  sentBack: { at: string; by: string; reason: string }[]
  /** Present when the specialist may do this task now. */
  action: { href: string; label: string } | null
}

export type StaffStageView = Omit<ProjectedStage, "items"> & { items: StaffTaskItem[] }

export type UploadReview = "accepted" | "awaiting" | "sent_back" | "replaced"

export type CaseUpload = UploadedDocumentView & { review: UploadReview; reviewNote: string | null }

export type CaseGeneratedDocument = {
  id: string
  kind: string
  title: string
  createdAt: string
  /** A stored copy exists to download (and it is hash-verified on download). */
  downloadable: boolean
  signers: { party: string; name: string; signedAt: string }[]
  url: string
}

export type FormField = { label: string; value: string }
export type FormCard = { id: string; title: string; filedAt: string | null; fields: FormField[] }

export type InvoiceLineView = { id: string; number: string; kind: string; issueDate: string; dueDate: string; totalCents: number; status: string }

export type CaseOrderView = {
  stateCode: string
  wageCents: number
  wageUnit: WageUnit
  package: string
  startDate: string | null
  endDate: string | null
  quoteLines: Pick<QuoteLine, "code" | "label" | "group" | "annualCents" | "monthlyCents">[]
  quoteTotals: { committedMonthlyCents: number; withBenefitsMonthlyCents: number; markupPct: number } | null
  deposit: DepositView
  invoices: InvoiceLineView[]
}

export type StaffCaseDetail = {
  caseId: string
  status: PersonStatus
  lifecycle: string
  atRisk: string | null
  person: { name: string; email: string }
  client: { id: string; name: string }
  roleName: string
  startDate: string | null
  progress: { done: number; total: number }
  stages: StaffStageView[]
  uploads: CaseUpload[]
  documents: CaseGeneratedDocument[]
  forms: FormCard[]
  order: CaseOrderView
  activity: TimelineEntry[]
}

const OWNER: Record<TaskParty, string> = {
  client: "Client",
  worker: "Employee",
  specialist: "Onboarding",
  finance: "Finance",
  system: "System",
}

const DOCUMENT_TITLE: Record<string, string> = {
  employment_agreement: "Employment agreement",
  i9_section1: "Form I-9, Section 1",
  i9_section2: "Form I-9, Section 2",
  w4: "Form W-4",
  direct_deposit_authorization: "Direct deposit authorization",
}

const KIND_LABEL: Record<DocumentKind, string> = {
  list_a: "List A document",
  list_b: "List B document",
  list_c: "List C document",
  w4: "W-4",
  other: "Other",
}
export const uploadKindLabel = (kind: DocumentKind) => KIND_LABEL[kind]

const iso = (date: Date) => date.toISOString()

function userNames(db: AppDatabase): Map<string, string> {
  return new Map(db.select({ id: users.id, name: users.displayName }).from(users).all().map((row) => [row.id, row.name]))
}

function stageViews(
  stages: ProjectedStage[],
  tasks: readonly Task[],
  names: Map<string, string>,
  lifecycleOpen: boolean,
): StaffStageView[] {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  return stages.map(({ items, ...stage }) => ({
    ...stage,
    items: items.map((item): StaffTaskItem => {
      const task = byId.get(item.id)
      const ui = taskUiFor(item.type)
      const mayAct = Boolean(task) && lifecycleOpen && item.status === "ready" && task!.actors.includes("specialist") && ui.portals.includes("onboarding")
      const sentBack = tasks
        .filter((candidate) => candidate.key === item.key && candidate.status === "rejected" && candidate.completedAt)
        .map((candidate) => {
          const reason = (candidate.result as { reason?: { code: string; note?: string } } | null)?.reason
          return {
            at: iso(candidate.completedAt!),
            by: candidate.completedByUserId ? (names.get(candidate.completedByUserId) ?? "Northwind") : "Northwind",
            reason: reason ? rejectReasonText(reason) : "Sent back",
          }
        })
      return {
        id: item.id,
        type: item.type,
        label: item.label,
        status: item.status,
        party: item.party,
        ownerLabel: OWNER[item.party],
        dueDate: item.dueDate,
        overdue: item.overdue,
        hidden: item.hidden,
        completedAt: task?.completedAt ? iso(task.completedAt) : null,
        completedBy: task?.completedByUserId ? (names.get(task.completedByUserId) ?? "Northwind") : null,
        rework: item.rework ? rejectReasonText(item.rework) : null,
        sentBack,
        action: mayAct && task ? { href: ui.href({ ...task, context: task.context }, "onboarding"), label: ui.actionLabel({ ...task, context: task.context }) } : null,
      }
    }),
  }))
}

function uploadsView(db: AppDatabase, caseId: string, tasks: readonly Task[]): CaseUpload[] {
  const rows = db.select().from(caseDocuments).where(eq(caseDocuments.caseId, caseId)).orderBy(desc(caseDocuments.createdAt)).all()
  const active = new Set(selectActiveIdentityDocuments(rows.map((row) => ({ id: row.id, kind: row.kind as DocumentKind, createdAt: row.createdAt.getTime() }))).map((doc) => doc.id))
  const verify = tasks.filter((task) => task.key === "verify_i9_section2")
  const verified = verify.at(-1)?.status === "done"
  const rejections = verify
    .filter((task) => task.status === "rejected" && task.completedAt)
    .map((task) => ({ at: task.completedAt!.getTime(), result: task.result as { reason?: { code: string; note?: string } } | null }))
    .sort((a, b) => a.at - b.at)

  return rows.map((row): CaseUpload => {
    const isActive = active.has(row.id)
    const rejection = rejections.find((entry) => entry.at >= row.createdAt.getTime())
    const reviewNote = rejection?.result?.reason ? rejectReasonText(rejection.result.reason) : null
    const bytes = readStoredFile(row.storagePath)
    const review: UploadReview = !isActive
      ? "replaced"
      : verified && (row.kind === "list_a" || row.kind === "list_b" || row.kind === "list_c")
        ? "accepted"
        : rejection
          ? "sent_back"
          : "awaiting"
    return {
      id: row.id,
      kind: row.kind as DocumentKind,
      fileName: row.fileName,
      uploadedAt: iso(row.createdAt),
      mime: bytes ? sniffUploadType(bytes) : null,
      url: `/api/documents/${row.id}`,
      review,
      reviewNote: review === "sent_back" || review === "replaced" ? reviewNote : null,
    }
  })
}

function generatedView(db: AppDatabase, caseId: string, names: Map<string, string>): CaseGeneratedDocument[] {
  const docs = db.select().from(generatedDocuments).where(eq(generatedDocuments.caseId, caseId)).orderBy(asc(generatedDocuments.createdAt)).all()
  const signatures = db.select().from(documentSignatures).where(eq(documentSignatures.caseId, caseId)).orderBy(asc(documentSignatures.signedAt)).all()
  return docs.map((doc) => ({
    id: doc.id,
    kind: doc.kind,
    title: DOCUMENT_TITLE[doc.kind] ?? doc.kind,
    createdAt: iso(doc.createdAt),
    downloadable: doc.storagePath !== null && readSignedFile(doc.storagePath) !== null,
    signers: signatures
      .filter((signature) => signature.documentId === doc.id)
      .map((signature) => ({ party: signature.party, name: signature.typedName || (names.get(signature.signerUserId) ?? ""), signedAt: iso(signature.signedAt) })),
    url: `/api/staff/documents/${doc.id}`,
  }))
}

const yesNo = (value: unknown) => (value ? "Yes" : "No")
const cents = (value: unknown) => (typeof value === "number" ? `$${(value / 100).toFixed(2)}` : "")

function sensitive(db: AppDatabase, caseId: string, formType: string): Record<string, unknown> {
  const token = latestForm(db, caseId, formType)?.encryptedJson
  if (!token) return {}
  try {
    return decryptFields(token)
  } catch {
    return {}
  }
}

const last4 = (value: unknown) => (typeof value === "string" && value.length >= 4 ? value.slice(-4) : null)

function formCards(db: AppDatabase, caseId: string): FormCard[] {
  const cards: FormCard[] = []
  const compact = (fields: (FormField | null)[]) => fields.filter((field): field is FormField => field !== null && field.value !== "")

  const personal = latestForm(db, caseId, "personal_details")
  if (personal) {
    const secret = sensitive(db, caseId, "personal_details")
    const address = personal.data.address as { line1?: string; line2?: string; city?: string; state?: string; zip?: string } | undefined
    const emergency = personal.data.emergencyContact as { name?: string; relationship?: string; phone?: string } | undefined
    cards.push({
      id: "personal_details",
      title: "Personal details",
      filedAt: iso(personal.createdAt),
      fields: compact([
        { label: "Legal name", value: String(personal.data.legalName ?? "") },
        { label: "Phone", value: String(personal.data.phone ?? "") },
        {
          label: "Address",
          value: address ? [address.line1, address.line2, `${address.city ?? ""}, ${address.state ?? ""} ${address.zip ?? ""}`.trim()].filter(Boolean).join(", ") : "",
        },
        { label: "Social Security number", value: typeof secret.ssn === "string" ? maskSsn(secret.ssn) : "" },
        { label: "Date of birth", value: typeof secret.dateOfBirth === "string" ? "On file (hidden)" : "" },
        { label: "Emergency contact", value: emergency?.name ? `${emergency.name} (${emergency.relationship ?? ""}) ${emergency.phone ?? ""}`.trim() : "" },
      ]),
    })
  }

  const w4 = latestForm(db, caseId, "w4")
  if (w4) {
    const secret = sensitive(db, caseId, "w4")
    const status = w4.data.filingStatus as W4FilingStatus
    cards.push({
      id: "w4",
      title: "Form W-4",
      filedAt: iso(w4.createdAt),
      fields: compact([
        { label: "Filing status", value: W4_FILING_STATUS_LABELS[status] ?? String(status ?? "") },
        { label: "Social Security number", value: typeof secret.ssn === "string" ? maskSsn(secret.ssn) : "" },
        { label: "Multiple jobs", value: yesNo(w4.data.multipleJobs) },
        { label: "Qualifying children", value: String(w4.data.qualifyingChildren ?? 0) },
        { label: "Other dependents", value: String(w4.data.otherDependents ?? 0) },
        { label: "Other income", value: cents(w4.data.otherIncomeCents) },
        { label: "Deductions", value: cents(w4.data.deductionsCents) },
        { label: "Extra withholding", value: cents(w4.data.extraWithholdingCents) },
        { label: "Exempt from withholding", value: yesNo(w4.data.exemptFromWithholding) },
      ]),
    })
  }

  const i9 = latestForm(db, caseId, "i9_section1")
  const i9b = latestForm(db, caseId, "i9_section2")
  if (i9 || i9b) {
    const secret = i9b ? sensitive(db, caseId, "i9_section2") : {}
    cards.push({
      id: "i9",
      title: "Form I-9",
      filedAt: iso((i9b ?? i9)!.createdAt),
      fields: compact([
        i9 ? { label: "Section 1: status", value: String(i9.data.citizenshipStatus ?? "").replace(/_/g, " ") } : null,
        i9?.data.workAuthExpiresOn ? { label: "Work authorization expires", value: String(i9.data.workAuthExpiresOn) } : null,
        i9b ? { label: "Section 2: documents", value: String(i9b.data.documentTitle ?? "") } : null,
        i9b ? { label: "Issuing authority", value: String(i9b.data.issuingAuthority ?? "") } : null,
        i9b ? { label: "Document number", value: last4(secret.documentNumber) ? `Ending ${last4(secret.documentNumber)}` : "" } : null,
        i9b?.data.expiresOn ? { label: "Document expires", value: String(i9b.data.expiresOn) } : null,
      ]),
    })
  }

  const deposit = latestForm(db, caseId, "direct_deposit")
  if (deposit) {
    cards.push({
      id: "direct_deposit",
      title: "Direct deposit",
      filedAt: iso(deposit.createdAt),
      fields: compact([
        { label: "Account holder", value: String(deposit.data.accountHolderName ?? "") },
        { label: "Bank", value: String(deposit.data.bankName ?? "") },
        { label: "Account type", value: String(deposit.data.accountType ?? "") },
        { label: "Account number", value: deposit.data.last4 ? `•••• ${deposit.data.last4}` : "" },
        { label: "Routing number", value: "On file (hidden)" },
      ]),
    })
  }
  return cards
}

function orderView(db: AppDatabase, basics: NonNullable<ReturnType<typeof caseBasics>>, now: Date): CaseOrderView {
  const snapshot: PolicySnapshotV1 | null = basics.snapshot
  const rows = db.select().from(invoices).where(eq(invoices.hireId, basics.hireId)).orderBy(asc(invoices.issueDate), asc(invoices.number)).all()
  const loaded = new Map(loadInvoices(db, rows.map((row) => row.id)).map((invoice) => [invoice.id, invoice]))
  const payments = loadPaymentsForInvoices(db, rows.map((row) => row.id))
  const today = todayIso(now)
  return {
    stateCode: snapshot?.comp.stateCode ?? basics.stateCode,
    wageCents: snapshot?.comp.wageCents ?? basics.wageCents,
    wageUnit: snapshot?.comp.wageUnit ?? basics.wageUnit,
    package: US_2026.packages[snapshot?.package ?? basics.package].label,
    startDate: basics.startDate,
    endDate: basics.endDate,
    quoteLines: (snapshot?.quote?.lines ?? []).map((line) => ({ code: line.code, label: line.label, group: line.group, annualCents: line.annualCents, monthlyCents: line.monthlyCents })),
    quoteTotals: snapshot?.quote
      ? {
          committedMonthlyCents: snapshot.quote.totals.committed.monthlyCents,
          withBenefitsMonthlyCents: snapshot.quote.totals.withBenefits.monthlyCents,
          markupPct: snapshot.quote.markupPct,
        }
      : null,
    deposit: depositViewFor(db, basics.hireId),
    invoices: rows.map((row) => ({
      id: row.id,
      number: row.number,
      kind: row.kind,
      issueDate: row.issueDate,
      dueDate: row.dueDate,
      totalCents: row.totalCents,
      status: loaded.has(row.id) ? invoiceDisplayStatus(loaded.get(row.id)!, payments, today) : row.status,
    })),
  }
}

function activityView(db: AppDatabase, caseId: string): TimelineEntry[] {
  return db
    .select({
      id: caseEvents.id,
      type: caseEvents.type,
      actorName: users.displayName,
      actorRole: users.role,
      payloadJson: caseEvents.payloadJson,
      createdAt: caseEvents.createdAt,
    })
    .from(caseEvents)
    .leftJoin(users, eq(users.id, caseEvents.actorUserId))
    .where(eq(caseEvents.caseId, caseId))
    .orderBy(asc(caseEvents.createdAt), asc(sql`${caseEvents}.rowid`))
    .all()
    .map((event) => ({
      id: event.id,
      type: event.type as CaseEventType,
      actorName: event.actorName ?? "System",
      actorRole: event.actorRole ?? "system",
      payload: event.payloadJson ? safeJson(event.payloadJson) : null,
      createdAt: iso(event.createdAt),
    }))
}

/** The case for a specialist; null for anyone else or a case that does not exist. */
export function staffCaseDetail(
  db: AppDatabase,
  viewer: StaffViewer,
  caseId: string,
  now: Date = new Date(),
): StaffCaseDetail | null {
  if (!isSpecialist(viewer)) return null
  const basics = caseBasics(db, caseId)
  if (!basics) return null

  const tasks = tasksForCase(db, caseId)
  const projection = projectTasks(tasks, { now, startDate: basics.startDate })
  const status = personStatusFor({ lifecycle: basics.lifecycle, goLiveReached: projection.goLiveReached, endDate: basics.endDate, now })
  const names = userNames(db)
  const stages = projectStages(tasks, templateFor(db, basics.templateId), "staff", now, basics.startDate)

  return {
    caseId,
    status,
    lifecycle: basics.lifecycle,
    atRisk: status === "onboarding" ? atRiskMessage(projection, now) : null,
    person: { name: basics.workerName, email: basics.workerEmail },
    client: { id: basics.clientCompanyId, name: basics.clientName },
    roleName: basics.roleName,
    startDate: basics.startDate,
    progress: projection.progress,
    stages: stageViews(stages, tasks, names, basics.lifecycle === "open"),
    uploads: uploadsView(db, caseId, tasks),
    documents: generatedView(db, caseId, names),
    forms: formCards(db, caseId),
    order: orderView(db, basics, now),
    activity: activityView(db, caseId),
  }
}

