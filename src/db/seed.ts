/**
 * Demo seed (data-model §5, tasks-and-workflow.md K3). The world (company, staff, roles, the
 * signed master agreement) is inserted directly; every person is produced by running the real
 * service operations against a simulated clock with generated fake data from a seeded RNG: create
 * the order, then let each party complete its ready tasks after a random delay, with scenario
 * rules that stall, reject, cancel, terminate or reactivate. Any seeded state is therefore
 * reachable by the real rules, and replaying a seeded case's events through the engine
 * reproduces its tasks (the seed test does).
 *
 * Identity documents go through the real upload service with generated sample files under the
 * uploads root, so every seeded row points at a file that exists (`seed-documents.ts`).
 *
 * `seedIfEmpty` no-ops when users exist unless `force` is set (`pnpm db:seed`).
 */
import { count, eq } from "drizzle-orm"

import type { SessionUser } from "@/auth"
import { addDaysIso } from "@/domain/employment-term"
import { earliestStartDate } from "@/domain/business-days"
import { payPeriodByIndex, payPeriodContaining } from "@/domain/billing"
import { businessDayOf, businessHourOf, businessInstant } from "@/domain/business-time"
import { createRng, sampleRejectReason, samplePayload, type Rng, type Task } from "@/domain/tasks"
import type { BenefitPackage, DocumentKind, UserRole, WageUnit } from "@/domain/types"
import {
  cancelOrder,
  createOrder,
  reactivatePerson,
  terminatePerson,
} from "@/server/cases"
import { initiatePaymentForInvoices, failPayment, runBilling, settlePayment } from "@/server/billing"
import { idFor, type CaseServiceDeps } from "@/server/deps"
import { storeIdentityDocument } from "@/server/employee-tasks"
import { prepareMasterAgreement, signMasterAgreementDocument } from "@/server/master-agreement"
import { encryptFields } from "@/server/field-crypto"
import { handlerPayload, storedSection2Documents } from "@/server/onboarding-portal/i9-review"
import { completeTaskAsActor, rejectTaskAsActor, tasksForCase } from "@/server/tasks"

import type { AppDatabase } from "./client"
import { sampleIdentityFile, type SampleListKind } from "./seed-documents"
import {
  caseDocuments,
  caseEvents,
  clientAgreements,
  companyDocumentSignatures,
  companyDocuments,
  benefitElections,
  benefitElectionVersions,
  clientCompanies,
  documentSignatures,
  formSubmissions,
  generatedDocuments,
  hireRequests,
  invoiceLines,
  invoices,
  onboardingCases,
  paymentAllocations,
  payments,
  payrollEntries,
  providers,
  roles,
  savedPaymentMethods,
  tasks,
  users,
} from "./schema"

export const SEED_IDS = {
  provider: "provider_1",
  client: "client_1",
  agreement: "agreement_1",
  role: "role_software_engineer",
  users: {
    clientHr: "user_client_hr",
    worker: "user_worker",
    worker2: "user_worker_2",
    specialist: "user_specialist_1",
    finance: "user_finance_1",
    clientHr2: "user_client_hr_2",
    clientHr3: "user_client_hr_3",
  },
  client2: "client_2",
  client3: "client_3",
  hire: "hire_1",
  case: "case_pending_1",
  document: "doc_list_a_1",
} as const

/**
 * The seeded client companies. Index 0 is the canonical Acme (Jordan and the generated roster);
 * the others exist so Finance sees receivables across companies and clients are isolated.
 */
export const SEED_COMPANIES = [
  {
    id: SEED_IDS.client,
    name: "Acme Robotics",
    hr: SEED_IDS.users.clientHr,
    agreement: SEED_IDS.agreement,
    markupPct: 15,
    method: { id: "pm_client_1", bankName: "Chase Business Checking", last4: "4821" },
  },
  {
    id: SEED_IDS.client2,
    name: "Brightwave Labs",
    hr: SEED_IDS.users.clientHr2,
    agreement: "agreement_2",
    markupPct: 12,
    method: { id: "pm_client_2", bankName: "Mercury", last4: "0937" },
  },
  {
    id: SEED_IDS.client3,
    name: "Harbor Foods Co.",
    hr: SEED_IDS.users.clientHr3,
    agreement: "agreement_3",
    markupPct: 18,
    method: { id: "pm_client_3", bankName: "Bank of America Business", last4: "6153" },
  },
] as const

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

/** Seed clock: top of the current hour, so a reseed within the hour is stable. */
export const SEED_NOW = new Date(Math.floor(Date.now() / HOUR_MS) * HOUR_MS)

const hoursAgo = (hours: number) => new Date(SEED_NOW.getTime() - hours * HOUR_MS)
const daysAgo = (days: number, hours = 0) => hoursAgo(days * 24 + hours)

/** ISO `YYYY-MM-DD` in local time, `days` from the seed clock. */
export function seedDate(days: number): string {
  return isoDay(new Date(SEED_NOW.getTime() + days * DAY_MS))
}

function isoDay(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** Jordan's order time, the canonical case. */
export const SEED_TIMES = {
  created: daysAgo(6, 3),
} as const

/** Jordan's requested first day: 8 days out, comfortably on track. */
export const SEED_START_DATE = seedDate(8)

export const SEED_CSM = {
  name: "Morgan Patel",
  email: "morgan.patel@northwind.example",
} as const

// ── Entry points ────────────────────────────────────────────────────

/** The people and the billing history, run through the real operations against the seeded world. */
function seedPeople(db: AppDatabase): void {
  const used = new Set<string>()
  // Oldest orders first, so invoice numbers (issued at order time) rise with the calendar.
  const chronological = [...SEED_ROSTER].sort((a, b) => b.orderedHoursAgo - a.orderedHoursAgo)
  for (const person of chronological) runScenario(db, person, used)
  simulateBilling(db)
}

/**
 * The synchronous seed every database opens with (tests, a first run). The master agreements are
 * inserted as signed with no stored document, because producing one is asynchronous: use
 * `seedDemo` for the demo database.
 */
export function seedIfEmpty(db: AppDatabase, options: { force: boolean }): void {
  db.transaction((tx) => {
    const [{ value }] = tx.select({ value: count() }).from(users).all()
    if (value > 0 && !options.force) return
    if (value > 0) wipeDemo(tx)
    seedWorld(tx, "signed")
    seedPeople(tx as unknown as AppDatabase)
  })
}

/**
 * The same world and people as `seedIfEmpty`, with each company's master agreement signed through
 * the production path first (`prepareMasterAgreement`, then `signMasterAgreementDocument`: the
 * generated PDF, the typed e-signature, the SHA-256 and the stored `company_documents` row), so
 * every signed agreement has a document that downloads and verifies. Orders are created only
 * after that, so none of them waits on an agreement. Time and ids are injected, so a reseed in
 * the same hour repeats. If anything fails the demo data is removed again rather than left half
 * seeded. This is what `pnpm db:seed` runs.
 */
export async function seedDemo(db: AppDatabase, options: { force: boolean }): Promise<void> {
  const [{ value }] = db.select({ value: count() }).from(users).all()
  if (value > 0 && !options.force) return
  db.transaction((tx) => {
    if (value > 0) wipeDemo(tx)
    seedWorld(tx, "draft")
  })
  try {
    await signSeedAgreements(db)
    db.transaction((tx) => seedPeople(tx as unknown as AppDatabase))
  } catch (error) {
    db.transaction((tx) => wipeDemo(tx))
    throw error
  }
}

async function signSeedAgreements(db: AppDatabase): Promise<void> {
  const signedAt = hoursAgo(200 * 24 - 2)
  let sequence = 0
  const deps: CaseServiceDeps = {
    db,
    now: () => signedAt,
    newId: (prefix) => `${prefix}_seed_${String((sequence += 1)).padStart(3, "0")}`,
  }
  for (const company of SEED_COMPANIES) {
    const actor = sessionUser(db, company.hr)
    const prepared = await prepareMasterAgreement(deps, actor)
    const field = prepared.fields.find((candidate) => candidate.kind === "signature")
    if (!field) throw new Error("seed: the master agreement has no signature field")
    await signMasterAgreementDocument(deps, {
      actor,
      signature: { typedName: actor.displayName, consentedAt: new Date(signedAt.getTime() - 60_000).toISOString() },
      fieldValues: { [field.id]: { kind: "signature", value: actor.displayName, signedAt: signedAt.toISOString() } },
    })
  }
}

type SeedExecutor = Pick<AppDatabase, "insert" | "delete" | "select">

function wipeDemo(db: SeedExecutor): void {
  db.delete(companyDocumentSignatures).run()
  db.delete(companyDocuments).run()
  db.delete(formSubmissions).run()
  db.delete(documentSignatures).run()
  db.delete(generatedDocuments).run()
  db.delete(paymentAllocations).run()
  db.delete(payments).run()
  db.delete(payrollEntries).run()
  db.delete(invoiceLines).run()
  db.delete(invoices).run()
  db.delete(benefitElectionVersions).run()
  db.delete(benefitElections).run()
  db.delete(savedPaymentMethods).run()
  db.delete(tasks).run()
  db.delete(caseEvents).run()
  db.delete(caseDocuments).run()
  db.delete(onboardingCases).run()
  db.delete(hireRequests).run()
  db.delete(roles).run()
  db.delete(clientAgreements).run()
  db.delete(users).run()
  db.delete(clientCompanies).run()
  db.delete(providers).run()
}

/**
 * Tenancy, staff, the master agreements and the company's roles. People come from scenarios.
 * `agreements: "draft"` leaves signing to `seedDemo`.
 */
function seedWorld(db: SeedExecutor, agreements: "signed" | "draft"): void {
  const worldStart = daysAgo(200)

  db.insert(providers).values({ id: SEED_IDS.provider, name: "Northwind EOR", createdAt: worldStart }).run()
  db.insert(clientCompanies)
    .values(
      SEED_COMPANIES.map((company) => ({
        id: company.id,
        providerId: SEED_IDS.provider,
        name: company.name,
        csmName: SEED_CSM.name,
        csmEmail: SEED_CSM.email,
        createdAt: worldStart,
      }))
    )
    .run()

  db.insert(users)
    .values([
      {
        id: SEED_IDS.users.clientHr,
        role: "client_hr",
        displayName: "Alex Harper",
        email: "hr@acme.example",
        clientCompanyId: SEED_IDS.client,
        providerId: null,
        createdAt: worldStart,
      },
      {
        id: SEED_IDS.users.clientHr2,
        role: "client_hr",
        displayName: "Priya Raman",
        email: "hr@brightwave.example",
        clientCompanyId: SEED_IDS.client2,
        providerId: null,
        createdAt: worldStart,
      },
      {
        id: SEED_IDS.users.clientHr3,
        role: "client_hr",
        displayName: "Marcus Hale",
        email: "hr@harbor.example",
        clientCompanyId: SEED_IDS.client3,
        providerId: null,
        createdAt: worldStart,
      },
      {
        id: SEED_IDS.users.worker2,
        role: "worker",
        displayName: "Taylor Kim",
        email: "taylor@worker.example",
        clientCompanyId: SEED_IDS.client,
        providerId: null,
        createdAt: SEED_TIMES.created,
      },
      {
        id: SEED_IDS.users.specialist,
        role: "onboarding_specialist",
        displayName: "Sam Ortiz",
        email: "sam@northwind.example",
        clientCompanyId: null,
        providerId: SEED_IDS.provider,
        createdAt: worldStart,
      },
      {
        id: SEED_IDS.users.finance,
        role: "finance",
        displayName: "Morgan Reyes",
        email: "morgan@northwind.example",
        clientCompanyId: null,
        providerId: SEED_IDS.provider,
        createdAt: worldStart,
      },
    ])
    .run()

  db.insert(clientAgreements)
    .values(
      SEED_COMPANIES.map((company) => ({
        id: company.agreement,
        clientCompanyId: company.id,
        markupPct: company.markupPct,
        status: agreements,
        signedAt: agreements === "signed" ? worldStart : null,
        createdAt: worldStart,
      }))
    )
    .run()

  db.insert(roles)
    .values(
      SEED_COMPANIES.flatMap((company, index) =>
        (index === 0 ? SEED_ROLE_NAMES : SEED_ROLE_NAMES.slice(0, SECONDARY_ROLE_COUNT)).map((name) => ({
          id: roleIdFor(name, index),
          clientCompanyId: company.id,
          name,
          createdAt: worldStart,
        }))
      )
    )
    .run()

  db.insert(savedPaymentMethods)
    .values(
      SEED_COMPANIES.map((company, index) => ({
        id: company.method.id,
        companyId: company.id,
        type: "us_bank_account" as const,
        bankName: company.method.bankName,
        last4: company.method.last4,
        encryptedAccountNumber: encryptFields({
          routingNumber: `02100${index}021`,
          accountNumber: `${7_700_000_000 + index * 1_111_111}${company.method.last4}`,
        }),
        isDefault: true,
        createdAt: worldStart,
      }))
    )
    .run()
}

// ── Roles ───────────────────────────────────────────────────────────

/** The company's defined roles. The last two are unused. */
export const SEED_ROLE_NAMES = [
  "Software Engineer",
  "Data Engineer",
  "Security Engineer",
  "DevOps Engineer",
  "QA Engineer",
  "QA Lead",
  "Product Designer",
  "Data Analyst",
  "Project Manager",
  "Technical Writer",
  "Content Writer",
  "Marketing Manager",
  "Customer Success Lead",
  "Support Specialist",
  "Account Executive",
  "Sales Representative",
  "Sales Engineer",
  "Recruiter",
  "Finance Analyst",
  "Operations Manager",
  "Legal Counsel",
  "Warehouse Associate",
  "Product Manager",
  "HR Generalist",
] as const

/** Other companies define only the first roles of the list. */
const SECONDARY_ROLE_COUNT = 10

/** Acme keeps the plain id; the other companies' roles carry their company number. */
export const roleIdFor = (name: string, company = 0) =>
  `role_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}${company === 0 ? "" : `_c${company + 1}`}`

// ── Scenarios ───────────────────────────────────────────────────────

/**
 * What happens to one person. Parties complete their ready tasks after a random delay; `stall`
 * entries (`key` or `key#n` for the nth instance of that key) are never completed, which is what
 * leaves a person waiting at that task. Lifecycle steps happen at fixed times after the order.
 */
export type Scenario = {
  /** What this person demonstrates; informational and used by the seed test. */
  kind: string
  orderedHoursAgo: number
  /** Days from the seed clock; raised to the earliest legal start when the order is made. */
  startInDays: number
  /** Last day of a fixed term, days from the seed clock. */
  endInDays?: number
  stall: string[]
  /** Multiplies every party's response delay. */
  speed: number
  /** Reject the first `times` ready instances of `key`. */
  rejections: { key: string; times: number }[]
  /** Cancel this many hours after the order is made. */
  cancelAfterHours?: number
  /** Terminate this many days before the seed clock. */
  terminateDaysAgo?: number
  /** Reactivate this many hours before the seed clock; the plan is the same afterwards. */
  reactivateHoursAgo?: number
  /** Cleared on reactivation. */
  stallAfterReactivate?: string[]
  /** Index into `SEED_COMPANIES`; 0 (Acme) when omitted. */
  company?: number
}

export type RosterPerson = Scenario & {
  key: string
  firstName: string
  lastName: string
  name: string
  email: string
  roleName: string
  wageCents: number
  wageUnit: WageUnit
  stateCode: string
  package: BenefitPackage
  company: number
}

const FIRST_NAMES = [
  "Hana", "Liam", "Sofia", "Ravi", "Chloe", "Jamal", "Anya", "Ethan", "Grace", "Victor", "Tessa", "Isla",
  "Dev", "Nora", "Zoe", "Theo", "Lena", "Owen", "Amara", "Felix", "Maya", "Priya", "Marcus", "Elena",
  "Diego", "Mei", "Omar", "Noah", "Ines", "Kofi", "Sasha", "Mateo", "Leila", "Jonas", "Aiko", "Tomas",
  "Freya", "Callum", "Nadia", "Rohan", "Bianca", "Idris", "Wren", "Soren", "Lucia", "Emeka", "Hugo", "Yara",
]
const LAST_NAMES = [
  "Sato", "O'Connor", "Martins", "Patel", "Dubois", "Carter", "Petrova", "Wright", "Kim", "Nguyen", "Morgan",
  "Fraser", "Mehta", "Ibrahim", "Fischer", "Park", "Kowalski", "Blake", "Okafor", "Lange", "Singh", "Nair",
  "Webb", "Rossi", "Alvarez", "Chen", "Haddad", "Brooks", "Silva", "Mensah", "Volkov", "Reyes", "Haddad",
  "Larsen", "Tanaka", "Novak", "Lindqvist", "Hughes", "Rahman", "Gupta", "Costa", "Bello", "Hart", "Berg",
  "Moreno", "Eze", "Weber", "Aziz",
]
const STATE_CODES = ["CA", "NY", "TX", "WA", "IL", "FL"] as const

const WORKER_TASKS = ["sign_agreement", "personal_details", "i9_section1", "w4", "direct_deposit"]
const AFTER_START = ["file_new_hire_report", "submit_benefit_enrollments"]

type Draft = Partial<Omit<Scenario, "kind">> & { kind: string }

function scenario(draft: Draft): Scenario {
  return { orderedHoursAgo: 48, startInDays: 14, stall: [], speed: 1, rejections: [], ...draft }
}

function between(rng: Rng, min: number, max: number): number {
  return rng.int(min, max)
}

/** Active long enough that onboarding and the first weeks are history. */
function activeBase(rng: Rng, kind: string, minDaysAgo = 40): Draft {
  const orderedDaysAgo = between(rng, minDaysAgo, 150)
  return { kind, orderedHoursAgo: orderedDaysAgo * 24, startInDays: -orderedDaysAgo + between(rng, 14, 20) }
}

type Kind = { count: number; make: (rng: Rng) => Draft }

const KINDS: Kind[] = [
  { count: 3, make: (rng) => ({ kind: "new_order", orderedHoursAgo: between(rng, 2, 20), startInDays: between(rng, 16, 30), stall: ["pay_deposit"], speed: 3 }) },
  { count: 2, make: (rng) => ({ kind: "deposit_overdue", orderedHoursAgo: between(rng, 9, 12) * 24, startInDays: between(rng, 1, 3), stall: ["pay_deposit"] }) },
  { count: 2, make: (rng) => ({ kind: "awaiting_ops_review", orderedHoursAgo: between(rng, 30, 70), startInDays: between(rng, 14, 25), stall: ["review_order"], speed: 0.6 }) },
  { count: 2, make: (rng) => ({ kind: "invited", orderedHoursAgo: between(rng, 3, 5) * 24, startInDays: between(rng, 10, 20), stall: ["accept_invitation"], speed: 0.6 }) },
  { count: 3, make: (rng) => ({ kind: "worker_midway", orderedHoursAgo: between(rng, 4, 8) * 24, startInDays: between(rng, 9, 15), stall: rng.shuffle(WORKER_TASKS.slice(1)).slice(0, between(rng, 1, 2)) }) },
  { count: 2, make: (rng) => ({ kind: "worker_at_risk", orderedHoursAgo: between(rng, 10, 12) * 24, startInDays: between(rng, 1, 2), stall: ["personal_details"] }) },
  { count: 2, make: (rng) => ({ kind: "awaiting_review", orderedHoursAgo: between(rng, 5, 8) * 24, startInDays: between(rng, 6, 12), stall: ["verify_i9_section2"] }) },
  { count: 2, make: (rng) => ({ kind: "rejected_awaiting_fix", orderedHoursAgo: between(rng, 7, 10) * 24, startInDays: between(rng, 7, 12), rejections: [{ key: "verify_i9_section2", times: 1 }], stall: ["fix_documents"] }) },
  { count: 1, make: (rng) => ({ kind: "reworked_awaiting_review", orderedHoursAgo: between(rng, 9, 12) * 24, startInDays: between(rng, 7, 12), rejections: [{ key: "verify_i9_section2", times: 1 }], stall: ["verify_i9_section2#2"] }) },
  { count: 3, make: (rng) => ({ kind: "awaiting_payroll", orderedHoursAgo: between(rng, 6, 10) * 24, startInDays: between(rng, 2, 7), stall: ["setup_payroll", ...AFTER_START] }) },
  { count: 3, make: (rng) => ({ kind: "waiting_for_start", orderedHoursAgo: between(rng, 14, 20) * 24, startInDays: between(rng, 1, 6), stall: AFTER_START }) },
  { count: 8, make: (rng) => ({ ...activeBase(rng, "active"), stall: rng.chance(0.25) ? ["file_new_hire_report"] : [] }) },
  { count: 3, make: (rng) => ({ ...activeBase(rng, "active_fixed_term"), endInDays: between(rng, 30, 200) }) },
  { count: 2, make: (rng) => ({ ...activeBase(rng, "term_ended", 90), endInDays: -between(rng, 3, 40) }) },
  { count: 3, make: (rng) => ({ kind: "cancelled", orderedHoursAgo: between(rng, 8, 30) * 24, startInDays: between(rng, 10, 30), stall: rng.shuffle(["pay_deposit", ...WORKER_TASKS]).slice(0, 3), cancelAfterHours: between(rng, 24, 96) }) },
  { count: 1, make: (rng) => ({ kind: "cancelled_reactivated", orderedHoursAgo: between(rng, 16, 24) * 24, startInDays: between(rng, 14, 24), stall: ["pay_deposit"], cancelAfterHours: 60, reactivateHoursAgo: between(rng, 30, 60), stallAfterReactivate: ["pay_deposit"] }) },
  { count: 3, make: (rng) => ({ ...activeBase(rng, "terminated", 70), terminateDaysAgo: between(rng, 3, 25) }) },
  { count: 1, make: (rng) => ({ ...activeBase(rng, "terminated_reactivated", 70), terminateDaysAgo: between(rng, 12, 25), reactivateHoursAgo: between(rng, 24, 160) }) },
  // Deposit paid by the client, not yet confirmed by Finance.
  { count: 2, make: (rng) => ({ kind: "deposit_processing", orderedHoursAgo: between(rng, 3, 6) * 24, startInDays: between(rng, 12, 20), stall: ["confirm_deposit"], speed: 0.5 }) },
  // Two more client companies, so Finance sees receivables across companies.
  { count: 7, make: (rng) => ({ ...activeBase(rng, "active", 50), company: 1 }) },
  { count: 1, make: (rng) => ({ ...activeBase(rng, "active_fixed_term"), company: 1, endInDays: between(rng, 40, 200) }) },
  { count: 1, make: (rng) => ({ ...activeBase(rng, "terminated", 70), company: 1, terminateDaysAgo: between(rng, 4, 20) }) },
  { count: 1, make: (rng) => ({ kind: "worker_midway", company: 1, orderedHoursAgo: between(rng, 4, 8) * 24, startInDays: between(rng, 9, 15), stall: rng.shuffle(WORKER_TASKS.slice(1)).slice(0, 1) }) },
  { count: 1, make: (rng) => ({ kind: "deposit_processing", company: 1, orderedHoursAgo: between(rng, 3, 6) * 24, startInDays: between(rng, 12, 20), stall: ["confirm_deposit"], speed: 0.5 }) },
  { count: 6, make: (rng) => ({ ...activeBase(rng, "active", 50), company: 2 }) },
  { count: 1, make: (rng) => ({ ...activeBase(rng, "term_ended", 90), company: 2, endInDays: -between(rng, 3, 40) }) },
  { count: 1, make: (rng) => ({ kind: "new_order", company: 2, orderedHoursAgo: between(rng, 2, 20), startInDays: between(rng, 16, 30), stall: ["pay_deposit"], speed: 3 }) },
]

function wageFor(rng: Rng): { wageCents: number; wageUnit: WageUnit } {
  if (rng.chance(0.3)) return { wageCents: rng.int(26, 78) * 100, wageUnit: "hourly" }
  return { wageCents: rng.int(62, 185) * 1_000 * 100, wageUnit: "annual" }
}

function buildRoster(seed: number): RosterPerson[] {
  const rng = createRng(seed)
  const firsts = rng.shuffle(FIRST_NAMES)
  const lasts = rng.shuffle(LAST_NAMES)
  const people: RosterPerson[] = []
  const taken = new Set<string>()
  for (const kind of KINDS) {
    for (let n = 0; n < kind.count; n += 1) {
      const index = people.length
      const firstName = firsts[index % firsts.length]
      const lastName = lasts[(index * 7 + 3) % lasts.length]
      let key = `${firstName}_${lastName}`.toLowerCase().replace(/[^a-z0-9]+/g, "_")
      while (taken.has(key)) key += "_x"
      taken.add(key)
      const base = scenario(kind.make(rng))
      const company = base.company ?? 0
      people.push({
        ...base,
        company,
        key,
        firstName,
        lastName,
        name: `${firstName} ${lastName}`,
        email: `${key}@worker.example`,
        roleName: rng.pick(SEED_ROLE_NAMES.slice(0, company === 0 ? SEED_ROLE_NAMES.length - 2 : SECONDARY_ROLE_COUNT)),
        stateCode: rng.pick(STATE_CODES),
        package: rng.chance(0.4) ? "premium" : "standard",
        ...wageFor(rng),
      })
    }
  }
  // The recently started employee whose benefits choice is still open, so that home is demoable.
  const pending = people
    .filter((person) => person.kind === "active" && person.company === 0)
    .sort((a, b) => a.orderedHoursAgo - b.orderedHoursAgo)[0]
  if (pending) pending.stall = [...pending.stall, "benefits_decision"]
  return people
}

/** Jordan: the canonical case, waiting on the specialist with everything else done. */
const JORDAN: RosterPerson = {
  ...scenario({
    kind: "awaiting_review",
    orderedHoursAgo: 6 * 24 + 3,
    startInDays: 8,
    stall: ["verify_i9_section2"],
    speed: 0.7,
  }),
  key: "jordan",
  firstName: "Jordan",
  lastName: "Lee",
  name: "Jordan Lee",
  email: "jordan@worker.example",
  roleName: "Software Engineer",
  wageCents: 6500,
  wageUnit: "hourly",
  stateCode: "CA",
  package: "standard",
  company: 0,
}

const ROSTER_SEED = 20260101

/** Jordan first (fixed ids), then generated people. Names, wages and dates are fake. */
export const SEED_ROSTER: readonly RosterPerson[] = [JORDAN, ...buildRoster(ROSTER_SEED)]

export const rosterIds = (key: string) =>
  key === "jordan"
    ? { user: SEED_IDS.users.worker, hire: SEED_IDS.hire, case: SEED_IDS.case }
    : { user: `user_worker_${key}`, hire: `hire_${key}`, case: `case_${key}` }

// ── Running a scenario ──────────────────────────────────────────────

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Typical response time per party, in hours: [min, max]. */
const DELAY_HOURS: Record<Task["party"], [number, number]> = {
  client: [2, 30],
  worker: [5, 50],
  specialist: [3, 40],
  finance: [4, 30],
  system: [0, 0],
}

function sessionUser(db: AppDatabase, userId: string): SessionUser {
  const row = db.select().from(users).where(eq(users.id, userId)).get()
  if (!row) throw new Error(`seed: user ${userId} missing`)
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role as UserRole,
    clientCompanyId: row.clientCompanyId,
    providerId: row.providerId,
  }
}

function runScenario(db: AppDatabase, person: RosterPerson, used: Set<string>): void {
  const ids = rosterIds(person.key)
  const rng = createRng(hash(`${ROSTER_SEED}:${person.key}`))
  let clock = hoursAgo(person.orderedHoursAgo)

  const overrides: Record<string, string> = {
    user_worker: ids.user,
    hire: ids.hire,
    case: ids.case,
    ...(person.key === "jordan" ? { doc: SEED_IDS.document } : {}),
  }
  const deps: CaseServiceDeps = {
    db,
    now: () => clock,
    newId: (prefix) => {
      const fixed = overrides[prefix]
      if (fixed && !used.has(`${prefix}:${fixed}`)) {
        used.add(`${prefix}:${fixed}`)
        return fixed
      }
      let id: string
      do id = `${prefix}_${rng.int(0, 0xffffff).toString(16).padStart(6, "0")}`
      while (used.has(id))
      used.add(id)
      return id
    },
  }

  const company = SEED_COMPANIES[person.company]
  const client = sessionUser(db, company.hr)
  const specialist = sessionUser(db, SEED_IDS.users.specialist)
  const finance = sessionUser(db, SEED_IDS.users.finance)

  const earliest = earliestStartDate(clock)
  const requestedStart = seedDate(person.startInDays)
  const startDate = requestedStart < earliest ? earliest : requestedStart
  const endDate = person.endInDays !== undefined ? seedDate(person.endInDays) : null

  const { caseId, workerUserId } = createOrder(deps, {
    actor: client,
    hire: {
      firstName: person.firstName,
      lastName: person.lastName,
      email: person.email,
      roleId: roleIdFor(person.roleName, person.company),
      workerType: "w2_employee",
      wageCents: person.wageCents,
      wageUnit: person.wageUnit,
      stateCode: person.stateCode,
      package: person.package,
      startDate,
      endDate,
      acceptAgreement: false,
    },
  })
  const worker = sessionUser(db, workerUserId)
  const actors: Record<Exclude<Task["party"], "system">, SessionUser> = { client, worker, specialist, finance }

  let stall = person.stall
  let fileNo = 0
  const rejections = new Map(person.rejections.map((r) => [r.key, r.times]))

  const instanceNo = (all: readonly Task[], task: Task) =>
    all.filter((other) => other.key === task.key && other.seq <= task.seq).length

  function simulate(until: Date): void {
    for (let guard = 0; guard < 200; guard += 1) {
      const all = tasksForCase(db, caseId)
      const ready = all
        .filter((task) => task.status === "ready" && task.party !== "system" && task.trigger === null)
        .filter((task) => !stall.includes(task.key) && !stall.includes(`${task.key}#${instanceNo(all, task)}`))
        .map((task) => {
          const [min, max] = DELAY_HOURS[task.party]
          const delay = createRng(hash(`${person.key}:${task.key}:${task.seq}`))
          const hours = (min + delay.next() * (max - min)) * person.speed
          return { task, at: new Date(task.updatedAt.getTime() + hours * HOUR_MS) }
        })
        .sort((a, b) => a.at.getTime() - b.at.getTime() || a.task.seq - b.task.seq)
      const next = ready[0]
      if (!next || next.at.getTime() > until.getTime()) return

      clock = new Date(Math.max(clock.getTime(), next.at.getTime()))
      const { task } = next
      const actor = actors[task.party as keyof typeof actors]
      const remaining = rejections.get(task.key) ?? 0

      if (remaining > 0) {
        rejections.set(task.key, remaining - 1)
        rejectTaskAsActor(deps, { actor, taskId: task.id, reason: sampleRejectReason(rng) })
        continue
      }
      if (task.type === "upload_documents") {
        uploadIdentityDocuments(
          { ...deps, newId: (prefix) => (prefix === "file" ? `file_${person.key}_${(fileNo += 1)}` : idFor(deps, prefix)) },
          { worker, taskId: task.id, holder: person.name, attempt: instanceNo(all, task), rng, listAOnly: person.key === "jordan" },
        )
      }
      const documents = db
        .select({ id: caseDocuments.id, kind: caseDocuments.kind, createdAt: caseDocuments.createdAt })
        .from(caseDocuments)
        .where(eq(caseDocuments.caseId, caseId))
        .all()
        .map((doc) => ({ id: doc.id, kind: doc.kind as DocumentKind, createdAt: doc.createdAt.getTime() }))
      const payload = samplePayload(task, {
        rng,
        actor: { userId: actor.id, role: actor.role, clientCompanyId: actor.clientCompanyId },
        env: { documents },
        today: isoDay(clock),
        workerName: person.name,
        savedMethodId: company.method.id,
      })
      completeTaskAsActor(deps, {
        actor,
        taskId: task.id,
        payload: task.type === "verify_i9_section2" ? verifiedSection2Payload(db, caseId, isoDay(clock)) : payload,
      })
    }
    throw new Error(`seed: scenario ${person.key} did not settle`)
  }

  if (person.cancelAfterHours !== undefined) {
    const cancelAt = new Date(hoursAgo(person.orderedHoursAgo).getTime() + person.cancelAfterHours * HOUR_MS)
    simulate(cancelAt)
    clock = cancelAt
    cancelOrder(deps, { actor: client, caseId, note: "Role put on hold" })
  } else if (person.terminateDaysAgo !== undefined) {
    const terminateAt = daysAgo(person.terminateDaysAgo)
    simulate(terminateAt)
    clock = terminateAt
    terminatePerson(deps, { actor: client, caseId, effectiveOn: isoDay(clock), note: "Contract ended" })
  } else {
    simulate(SEED_NOW)
  }

  if (person.reactivateHoursAgo !== undefined) {
    clock = hoursAgo(person.reactivateHoursAgo)
    reactivatePerson(deps, { actor: client, caseId })
    stall = person.stallAfterReactivate ?? []
    simulate(SEED_NOW)
  }
}

/** A seeded Section 2 records the documents as the worker entered them, like the drawer does. */
function verifiedSection2Payload(db: AppDatabase, caseId: string, today: string) {
  const stored = storedSection2Documents(db, caseId, today)
  if (stored.state !== "ready") throw new Error(`seed: case ${caseId} cannot be verified (${stored.state})`)
  return handlerPayload(stored)
}

/**
 * The worker's identity upload through the real upload service: type and content are checked, the
 * file lands under the uploads root (`UPLOADS_ROOT`, default `data/uploads`) and the row is
 * recorded. The sample files are generated, so a reseed recreates them. The caller derives file ids
 * from the person rather than the scenario's random stream, so the rest of the seed is unchanged
 * and a reseed overwrites the same files.
 */
function uploadIdentityDocuments(
  deps: CaseServiceDeps,
  input: { worker: SessionUser; taskId: string; holder: string; attempt: number; rng: Rng; listAOnly: boolean },
): void {
  const upload = (kind: SampleListKind) =>
    storeIdentityDocument(deps, input.worker, {
      taskId: input.taskId,
      kind,
      ...sampleIdentityFile(kind, input.holder, input.attempt),
    })
  if (input.listAOnly || input.rng.chance(0.55)) {
    upload("list_a")
  } else {
    upload("list_b")
    upload("list_c")
  }
}

// ── Billing history ─────────────────────────────────────────────────

/** How each company's payments end, so the demo shows every invoice status. */
const BILLING_POLICY: readonly { unpaidLatest: number; processingLatest: boolean; failedBefore: boolean }[] = [
  { unpaidLatest: 1, processingLatest: false, failedBefore: true },
  { unpaidLatest: 2, processingLatest: false, failedBefore: false },
  { unpaidLatest: 0, processingLatest: true, failedBefore: true },
]

/** `hour`:00 on a business day, never later than the seed clock (nothing in the history is in the future). */
function at(day: string, hour: number): Date {
  const instant = businessInstant(day, hour)
  return instant.getTime() > SEED_NOW.getTime() ? SEED_NOW : instant
}

/**
 * Replays the billing calendar from the earliest start to the seed clock through the real
 * operations: `runBilling` on every invoice issue day, each company's client paying that day's
 * invoices in one ACH payment a few days later and Finance settling it a few days after that.
 * The latest invoices per company are left open, overdue or processing (`BILLING_POLICY`), and
 * one payment fails once before it is paid again.
 */
function simulateBilling(db: AppDatabase): void {
  const today = businessDayOf(SEED_NOW)
  const first = db
    .select({ startDate: hireRequests.startDate })
    .from(hireRequests)
    .all()
    .map((row) => row.startDate)
    .filter((day): day is string => day !== null)
    .sort()[0]
  if (!first) return

  const issueDays: string[] = []
  for (let index = payPeriodContaining(first).index; ; index += 1) {
    const { issueDate } = payPeriodByIndex(index)
    if (issueDate > today) break
    issueDays.push(issueDate)
  }
  if (issueDays.length === 0) return
  const runDays = new Set([...issueDays, today])

  const rng = createRng(hash("billing-history"))
  let clock = at(issueDays[0], 6)
  let sequence = 0
  const deps: CaseServiceDeps = { db, now: () => clock, newId: (prefix) => `${prefix}_seed_${String(++sequence).padStart(5, "0")}` }
  const finance = sessionUser(db, SEED_IDS.users.finance)
  const clients = SEED_COMPANIES.map((company) => sessionUser(db, company.hr))
  const companyIndex = new Map<string, number>(SEED_COMPANIES.map((company, index) => [company.id, index]))
  const pending = new Map<string, (() => void)[]>()
  const schedule = (day: string, hour: number, step: () => void) => {
    pending.set(day, [
      ...(pending.get(day) ?? []),
      () => {
        clock = at(day, hour)
        step()
      },
    ])
  }

  type Outcome = "settle" | "hold" | "fail_then_settle"
  const startPayment = (index: number, day: string, invoiceIds: string[], settleAfterDays: number, outcome: Outcome) => {
    schedule(day, 10, () => {
      const { paymentId } = initiatePaymentForInvoices(deps, {
        actor: clients[index],
        invoiceIds,
        savedMethodId: SEED_COMPANIES[index].method.id,
      })
      if (outcome === "hold") return
      const settleDay = addDaysIso(day, settleAfterDays)
      if (outcome === "settle") {
        schedule(settleDay, 15, () => settlePayment(deps, { actor: finance, paymentId }))
        return
      }
      schedule(settleDay, 15, () => {
        failPayment(deps, { actor: finance, paymentId, reason: "ACH return R01: insufficient funds" })
        startPayment(index, addDaysIso(settleDay, 2), invoiceIds, 2, "settle")
      })
    })
  }

  const groupDays = issueDays
  const latest = groupDays[groupDays.length - 1]
  const failedGroupDay = groupDays[Math.max(0, groupDays.length - 3)]
  const lastDay = (count: number) => groupDays.slice(Math.max(0, groupDays.length - count))

  for (let day = issueDays[0]; day <= today; day = addDaysIso(day, 1)) {
    for (const step of pending.get(day) ?? []) step()
    pending.delete(day)
    if (!runDays.has(day)) continue

    clock = at(day, day === today ? Math.max(6, businessHourOf(SEED_NOW)) : 6)
    const run = runBilling(deps)
    for (let index = 0; index < SEED_COMPANIES.length; index += 1) {
      const ids = run.invoices
        .filter((invoice) => invoice.kind === "payroll" && companyIndex.get(invoice.companyId) === index)
        .map((invoice) => invoice.id)
      if (ids.length === 0) continue
      const policy = BILLING_POLICY[index]
      if (lastDay(policy.unpaidLatest).includes(day)) continue
      const paidOn = addDaysIso(day, rng.int(1, 4))
      if (policy.processingLatest && day === latest) {
        startPayment(index, paidOn <= today ? paidOn : today, ids, 0, "hold")
      } else if (policy.failedBefore && day === failedGroupDay) {
        startPayment(index, paidOn, ids, 2, "fail_then_settle")
      } else {
        startPayment(index, paidOn, ids, rng.int(1, 3), "settle")
      }
    }
  }
}

// ── Personas ────────────────────────────────────────────────────────

/** The canonical personas for `/pick`, in a stable demo order. Roster workers are not personas. */
export function listPersonas(db: AppDatabase) {
  const order: readonly string[] = [
    SEED_IDS.users.clientHr,
    SEED_IDS.users.clientHr2,
    SEED_IDS.users.clientHr3,
    SEED_IDS.users.worker,
    SEED_IDS.users.worker2,
    SEED_IDS.users.specialist,
    SEED_IDS.users.finance,
  ]
  return db
    .select()
    .from(users)
    .all()
    .filter((u) => order.includes(u.id))
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
}

/** Rows for `userId`, used by tests that prove a cold worker has no case. */
export function casesForWorker(db: AppDatabase, userId: string) {
  return db
    .select()
    .from(onboardingCases)
    .where(eq(onboardingCases.workerUserId, userId))
    .all()
}
