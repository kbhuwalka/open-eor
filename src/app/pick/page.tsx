import { Suspense } from "react"
import { redirect } from "next/navigation"

import { searchEmployeesAction } from "@/app/pick/actions"
import { pickEmployee, pickPersona } from "@/auth/actions"
import { getSessionUser, ROLE_HOME } from "@/auth"
import { PersonaPicker, PickerFrame } from "@/components/persona-picker"
import { ThemeRoot } from "@/components/theme-root"
import { Skeleton } from "@/components/ui/skeleton"
import { getDb } from "@/db"
import {
  countEmployees,
  listPickerPersonas,
  listRecentlyStartedEmployees,
} from "@/server/personas"

async function Picker() {
  const sessionUser = await getSessionUser()
  if (sessionUser) {
    redirect(ROLE_HOME[sessionUser.role])
  }

  const db = getDb()
  const now = new Date()
  return (
    <ThemeRoot>
      <PersonaPicker
        personas={listPickerPersonas(db)}
        employeeCount={countEmployees(db)}
        recentEmployees={listRecentlyStartedEmployees(db, undefined, now)}
        now={now}
        actions={{ pickPersona, pickEmployee, search: searchEmployeesAction }}
      />
    </ThemeRoot>
  )
}

function PickerSkeleton() {
  return (
    <PickerFrame>
      {[3, 2, 1].map((tiles, section) => (
        <div key={section} className="flex flex-col gap-3" aria-hidden>
          <Skeleton className="h-5 w-24" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: tiles }, (_, index) => (
              <Skeleton key={index} className="h-[4.875rem] rounded-lg" />
            ))}
          </div>
        </div>
      ))}
    </PickerFrame>
  )
}

export default function PickPage() {
  return (
    <Suspense fallback={<PickerSkeleton />}>
      <Picker />
    </Suspense>
  )
}
