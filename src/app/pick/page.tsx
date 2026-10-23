import { Suspense } from "react"
import { redirect } from "next/navigation"

import { pickPersona } from "@/auth/actions"
import { getSessionUser, ROLE_HOME } from "@/auth"
import { getDb, users, type UserRole } from "@/db"

const ROLE_LABEL: Record<UserRole, string> = {
  client_hr: "Client HR",
  worker: "Worker",
  eor_ops: "EOR Ops",
  eor_reviewer: "EOR Reviewer",
}

const AVATAR_TONE: Record<UserRole, string> = {
  client_hr: "bg-sky-700",
  worker: "bg-emerald-700",
  eor_ops: "bg-amber-700",
  eor_reviewer: "bg-rose-800",
}

async function PersonaGrid() {
  const sessionUser = await getSessionUser()
  if (sessionUser) {
    redirect(ROLE_HOME[sessionUser.role])
  }

  const personas = getDb().select().from(users).all()

  return (
    <ul className="grid w-full max-w-3xl grid-cols-2 gap-6 sm:grid-cols-4">
      {personas.map((persona) => {
        const initials = persona.displayName
          .split(" ")
          .map((part) => part[0])
          .join("")
          .slice(0, 2)
        return (
          <li key={persona.id} className="flex flex-col items-center gap-3">
            <form action={pickPersona.bind(null, persona.id)} className="w-full">
              <button
                type="submit"
                className="group flex w-full flex-col items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
              >
                <span
                  className={`flex aspect-square w-full max-w-[9rem] items-center justify-center rounded-md text-3xl font-semibold text-white transition group-hover:scale-[1.03] group-hover:brightness-110 ${AVATAR_TONE[persona.role]}`}
                  aria-hidden
                >
                  {initials}
                </span>
                <span className="text-center">
                  <span className="block text-base font-medium text-zinc-100">
                    {persona.displayName}
                  </span>
                  <span className="block text-sm text-zinc-400">
                    {ROLE_LABEL[persona.role]}
                  </span>
                </span>
              </button>
            </form>
          </li>
        )
      })}
    </ul>
  )
}

export default function PickPage() {
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden bg-zinc-950 px-6 py-16 text-zinc-50">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(82,82,91,0.35),_transparent_55%)]"
      />
      <div className="relative z-10 flex w-full flex-col items-center gap-10">
        <div className="text-center">
          <p className="text-sm font-medium tracking-[0.2em] text-zinc-400 uppercase">
            Northwind EOR
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Who&apos;s working today?
          </h1>
          <p className="mt-2 max-w-md text-sm text-zinc-400">
            Pick a persona to open that portal. No password — demo session only.
          </p>
        </div>
        <Suspense
          fallback={
            <p className="text-sm text-zinc-400">Loading personas…</p>
          }
        >
          <PersonaGrid />
        </Suspense>
      </div>
    </div>
  )
}
