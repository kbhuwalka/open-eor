/**
 * The People & cases directory, the clients list and the home summary (onboarding-portal.md §5).
 *
 * Every case across every client: staff see all of them, nobody else sees any (`isSpecialist` is
 * checked in each exported function, which returns null for other roles). At-risk and the current
 * stage are derived from tasks, not stored, so filtering happens in memory over one load of the
 * cases; the demo's scale makes that cheaper than a second SQL form of the same rules.
 */
import { asc, eq } from "drizzle-orm"

import type { AppDatabase } from "@/db/client"
import {
  clientAgreements,
  clientCompanies,
  hireRequests,
  onboardingCases,
  roles,
  users,
} from "@/db/schema"
import { addDaysIso, todayIso } from "@/domain/employment-term"
import { personStatusFor, type PersonStatus } from "@/domain/person-status"
import { projectStages, projectTasks, type WorkflowTemplate } from "@/domain/tasks"
import type { CaseLifecycle } from "@/domain/types"
import { compareCases, type CasesQuery } from "@/lib/onboarding-portal/cases-query"
import { totalPagesFor } from "@/lib/pagination"
import { stageProgress } from "@/lib/stage-view"
import { atRiskMessage } from "@/lib/task-view"

import { depositState } from "../billing-core"
import { loadTemplateById } from "@/db/workflow-templates"
import { tasksForCases } from "../tasks"
import { inboxTotals } from "../task-inbox"

import { isSpecialist, type StaffViewer } from "./core"

export type StaffCaseRow = {
  caseId: string
  person: string
  email: string
  clientId: string
  clientName: string
  roleName: string
  lifecycle: CaseLifecycle
  status: PersonStatus
  atRisk: string | null
  startDate: string | null
  /** The stage the case is in now, or null when onboarding has no current stage (done, cancelled). */
  stage: { id: string; title: string } | null
  stageProgress: { done: number; total: number }
  deposit: "none" | "open" | "processing" | "paid" | "cancelled"
}

export type CasesPage = {
  rows: StaffCaseRow[]
  /** Rows matching the filters, across pages. */
  total: number
  /** Every case, ignoring filters. */
  overall: number
  page: number
  pageSize: number
  totalPages: number
  clients: { id: string; name: string }[]
  stages: { id: string; title: string }[]
}

/** Every case with what the directory and the home summary derive from it. */
export function loadStaffCaseRows(db: AppDatabase, now: Date = new Date()): { rows: StaffCaseRow[]; stages: { id: string; title: string }[] } {
  const base = db
    .select({
      caseId: onboardingCases.id,
      hireId: hireRequests.id,
      lifecycle: onboardingCases.lifecycle,
      templateId: onboardingCases.templateId,
      person: users.displayName,
      email: users.email,
      clientId: clientCompanies.id,
      clientName: clientCompanies.name,
      roleName: roles.name,
      startDate: hireRequests.startDate,
      endDate: hireRequests.endDate,
    })
    .from(onboardingCases)
    .innerJoin(hireRequests, eq(hireRequests.id, onboardingCases.hireRequestId))
    .innerJoin(clientCompanies, eq(clientCompanies.id, hireRequests.clientCompanyId))
    .innerJoin(users, eq(users.id, onboardingCases.workerUserId))
    .innerJoin(roles, eq(roles.id, hireRequests.roleId))
    .orderBy(asc(onboardingCases.id))
    .all()

  const tasks = tasksForCases(db, base.map((row) => row.caseId))
  const templates = new Map<string, WorkflowTemplate>()
  const stageOptions = new Map<string, string>()

  const rows = base.map((row): StaffCaseRow => {
    if (!templates.has(row.templateId)) {
      const template = loadTemplateById(db, row.templateId).template
      templates.set(row.templateId, template)
      for (const stage of template.stages ?? []) if (!stageOptions.has(stage.id)) stageOptions.set(stage.id, stage.title)
    }
    const caseTasks = tasks.get(row.caseId) ?? []
    const projection = projectTasks(caseTasks, { now, startDate: row.startDate })
    const status = personStatusFor({ lifecycle: row.lifecycle, goLiveReached: projection.goLiveReached, endDate: row.endDate, now })
    const stages = projectStages(caseTasks, templates.get(row.templateId)!, "staff", now, row.startDate)
    const current = status === "onboarding" ? stages.find((stage) => stage.status === "current" && !stage.quiet) : undefined
    return {
      caseId: row.caseId,
      person: row.person,
      email: row.email,
      clientId: row.clientId,
      clientName: row.clientName,
      roleName: row.roleName,
      lifecycle: row.lifecycle,
      status,
      atRisk: status === "onboarding" ? atRiskMessage(projection, now) : null,
      startDate: row.startDate,
      stage: current ? { id: current.id, title: current.title } : null,
      stageProgress: stageProgress(stages),
      deposit: depositState(db, row.hireId).state,
    }
  })
  return { rows, stages: [...stageOptions].map(([id, title]) => ({ id, title })) }
}

function matches(row: StaffCaseRow, query: CasesQuery): boolean {
  if (query.status && row.status !== query.status) return false
  if (query.atRisk && !row.atRisk) return false
  if (query.stage && row.stage?.id !== query.stage) return false
  if (query.client && row.clientId !== query.client) return false
  if (query.startFrom && (row.startDate === null || row.startDate < query.startFrom)) return false
  if (query.startTo && (row.startDate === null || row.startDate > query.startTo)) return false
  for (const word of query.q.toLowerCase().split(/\s+/).filter(Boolean)) {
    if (!`${row.person} ${row.clientName} ${row.email}`.toLowerCase().includes(word)) return false
  }
  return true
}

const byRisk = (a: StaffCaseRow, b: StaffCaseRow) =>
  compareCases(
    { name: a.person, status: a.status, atRisk: a.atRisk !== null, startDate: a.startDate },
    { name: b.person, status: b.status, atRisk: b.atRisk !== null, startDate: b.startDate },
  )

/** One page of the directory; null for anyone who is not an onboarding specialist. */
export function casesDirectory(db: AppDatabase, viewer: StaffViewer, query: CasesQuery, now: Date = new Date()): CasesPage | null {
  if (!isSpecialist(viewer)) return null
  const { rows: all, stages } = loadStaffCaseRows(db, now)
  const filtered = all.filter((row) => matches(row, query)).sort(byRisk)
  const totalPages = totalPagesFor(filtered.length, query.size)
  const page = Math.min(query.page, totalPages)
  const clients = [...new Map(all.map((row) => [row.clientId, row.clientName])).entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return {
    rows: filtered.slice((page - 1) * query.size, page * query.size),
    total: filtered.length,
    overall: all.length,
    page,
    pageSize: query.size,
    totalPages,
    clients,
    stages,
  }
}

// ── Clients ─────────────────────────────────────────────────────────

export type ClientRow = {
  id: string
  name: string
  csm: string | null
  activePeople: number
  onboarding: number
  agreement: "signed" | "draft" | "none"
  /** Plain words for the deposits of people still onboarding. */
  deposit: string
}

function depositSummary(rows: StaffCaseRow[]): string {
  const onboarding = rows.filter((row) => row.status === "onboarding")
  const open = onboarding.filter((row) => row.deposit === "open").length
  const processing = onboarding.filter((row) => row.deposit === "processing").length
  if (open > 0) return `${open} unpaid`
  if (processing > 0) return `${processing} processing`
  return onboarding.length > 0 ? "All received" : "None pending"
}

export function clientsDirectory(db: AppDatabase, viewer: StaffViewer, now: Date = new Date()): ClientRow[] | null {
  if (!isSpecialist(viewer)) return null
  const { rows } = loadStaffCaseRows(db, now)
  const agreements = new Map(db.select({ id: clientAgreements.clientCompanyId, status: clientAgreements.status }).from(clientAgreements).all().map((row) => [row.id, row.status]))
  return db
    .select({ id: clientCompanies.id, name: clientCompanies.name, csm: clientCompanies.csmName })
    .from(clientCompanies)
    .orderBy(asc(clientCompanies.name))
    .all()
    .map((client) => {
      const cases = rows.filter((row) => row.clientId === client.id)
      return {
        id: client.id,
        name: client.name,
        csm: client.csm,
        activePeople: cases.filter((row) => row.status === "active").length,
        onboarding: cases.filter((row) => row.status === "onboarding").length,
        agreement: agreements.get(client.id) ?? "none",
        deposit: depositSummary(cases),
      }
    })
}

export type ClientDetailView = { client: ClientRow; cases: StaffCaseRow[] }

export function clientDetail(db: AppDatabase, viewer: StaffViewer, clientId: string, now: Date = new Date()): ClientDetailView | null {
  const clients = clientsDirectory(db, viewer, now)
  const client = clients?.find((candidate) => candidate.id === clientId)
  if (!client) return null
  const { rows } = loadStaffCaseRows(db, now)
  return { client, cases: rows.filter((row) => row.clientId === clientId).sort(byRisk) }
}

// ── Home ────────────────────────────────────────────────────────────

export type HomeSummary = {
  /** Ready tasks assigned to the viewer or waiting in the onboarding queue: what the home lists. */
  open: number
  overdue: number
  atRisk: number
  /** People still onboarding whose start date falls in the next seven days (today included). */
  startingThisWeek: number
}

export function homeSummary(db: AppDatabase, viewer: StaffViewer, now: Date = new Date()): HomeSummary | null {
  if (!isSpecialist(viewer)) return null
  const totals = inboxTotals(db, viewer, now)
  const { rows } = loadStaffCaseRows(db, now)
  const today = todayIso(now)
  const weekEnd = addDaysIso(today, 6)
  const onboarding = rows.filter((row) => row.status === "onboarding")
  return {
    open: totals.open,
    overdue: totals.overdue,
    atRisk: onboarding.filter((row) => row.atRisk).length,
    startingThisWeek: onboarding.filter((row) => row.startDate !== null && row.startDate >= today && row.startDate <= weekEnd).length,
  }
}
