/**
 * How a persona reads on the picker tiles and in the in-portal switcher (ui-guidelines C14): the
 * title, subtitle, avatar initials and role cue. Pure; the rows come from `src/server/personas.ts`.
 */
import type { UserRole } from "@/domain/types"
import type { Persona, RecentEmployee } from "@/server/personas"

/** Companies get a square avatar, people a round one. */
export type AvatarShape = "company" | "person"

export type PersonaTileView = {
  title: string
  subtitle: string
  initials: string
  /** A short muted fact beside the title ("Started Oct 5"), when the tile has one. */
  meta?: string
  shape: AvatarShape
  /** Picks the role cue (a status-token dot, ui-guidelines §6 S3). */
  role: UserRole
}

export const STAFF_ROLE_LABEL: Record<"onboarding_specialist" | "finance", string> = {
  onboarding_specialist: "Onboarding specialist",
  finance: "Finance",
}

/** Up to two letters: the first of the first two words ("Harbor Foods Co." → "HF"), "?" for none. */
export function initialsOf(name: string): string {
  const letters = name
    .split(/\s+/)
    .map((word) => word.match(/[\p{L}\p{N}]/u)?.[0] ?? "")
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase()
  return letters || "?"
}

/**
 * A client HR user is shown as their company ("Acme Robotics", subtitle "Alex Harper, HR"); one with
 * no company falls back to their own name with the subtitle "Client HR". Staff are their name with
 * the role as subtitle; an employee is their name over "Employee, <company>".
 */
export function personaTile(persona: Persona): PersonaTileView {
  if (persona.kind === "employee") {
    return {
      title: persona.displayName,
      subtitle: persona.companyName === null ? "Employee" : `Employee, ${persona.companyName}`,
      initials: initialsOf(persona.displayName),
      shape: "person",
      role: "worker",
    }
  }
  if (persona.kind === "client") {
    if (persona.companyName === null) {
      return {
        title: persona.displayName,
        subtitle: "Client HR",
        initials: initialsOf(persona.displayName),
        shape: "person",
        role: "client_hr",
      }
    }
    return {
      title: persona.companyName,
      subtitle: `${persona.displayName}, HR`,
      initials: initialsOf(persona.companyName),
      shape: "company",
      role: "client_hr",
    }
  }
  return {
    title: persona.displayName,
    subtitle: STAFF_ROLE_LABEL[persona.role],
    initials: initialsOf(persona.displayName),
    shape: "person",
    role: persona.role,
  }
}

/** "Jordan Lee" over "Acme Robotics", with "Started Oct 5" as meta (the year only when not `now`'s). */
export function recentEmployeeTile(employee: RecentEmployee, now: Date): PersonaTileView {
  const [year, month, day] = employee.startDate.split("-").map(Number)
  const started = new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(year === now.getFullYear() ? {} : { year: "numeric" }),
  })
  return {
    title: employee.displayName,
    subtitle: employee.companyName,
    initials: initialsOf(employee.displayName),
    meta: `Started ${started}`,
    shape: "person",
    role: "worker",
  }
}

/** "Search 69 employees by name, email or company" (singular for one, plain for none). */
export function employeeSearchLabel(count: number): string {
  if (count === 0) return "Search employees by name, email or company"
  const noun = count === 1 ? "employee" : "employees"
  return `Search ${count.toLocaleString("en-US")} ${noun} by name, email or company`
}
