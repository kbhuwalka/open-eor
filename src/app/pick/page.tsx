import { Suspense } from "react"
import { redirect } from "next/navigation"

import { pickPersona } from "@/auth/actions"
import { getSessionUser, ROLE_HOME } from "@/auth"
import { EmployeesTile } from "@/components/employee-picker"
import { PersonaTileFace } from "@/components/persona-tile"
import { ThemeRoot } from "@/components/theme-root"
import { getDb } from "@/db"
import { countEmployees, listNonEmployeePersonas } from "@/server/personas"

const ROLE_LABEL = {
  client_hr: "Client HR",
  onboarding_specialist: "Onboarding Specialist",
  finance: "Finance",
} as const

async function PersonaGrid() {
  const sessionUser = await getSessionUser()
  if (sessionUser) {
    redirect(ROLE_HOME[sessionUser.role])
  }

  const db = getDb()
  const personas = listNonEmployeePersonas(db)
  const employeeCount = countEmployees(db)

  return (
    <ul className="flex w-full max-w-5xl flex-wrap justify-center gap-x-6 gap-y-8">
      {personas.map((persona) => {
        const initials = persona.displayName
          .split(" ")
          .map((part) => part[0])
          .join("")
          .slice(0, 2)
        return (
          <li key={persona.id} className="flex w-36 flex-col items-center gap-3">
            <form action={pickPersona.bind(null, persona.id)} className="w-full">
              <button
                type="submit"
                className="group flex w-full cursor-pointer flex-col items-center gap-3 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <PersonaTileFace
                  role={persona.role}
                  title={persona.displayName}
                  subtitle={ROLE_LABEL[persona.role]}
                >
                  {initials}
                </PersonaTileFace>
              </button>
            </form>
          </li>
        )
      })}
      <li className="flex w-36 flex-col items-center gap-3">
        <EmployeesTile count={employeeCount} />
      </li>
    </ul>
  )
}

export default function PickPage() {
  return (
    <ThemeRoot
      force="dark"
      className="relative items-center justify-center overflow-hidden px-6 py-16"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,var(--muted),transparent_55%)]"
      />
      <div className="relative z-10 flex w-full flex-col items-center gap-10">
        <div className="text-center">
          <p className="text-sm font-medium tracking-[0.2em] text-muted-foreground uppercase">
            Northwind EOR
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Who&apos;s working today?
          </h1>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Pick a persona to open that portal, or search for an employee. No password — demo session only.
          </p>
        </div>
        <Suspense
          fallback={
            <p className="text-sm text-muted-foreground">Loading personas…</p>
          }
        >
          <PersonaGrid />
        </Suspense>
      </div>
    </ThemeRoot>
  )
}
