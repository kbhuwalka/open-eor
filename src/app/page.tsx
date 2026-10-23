import { Suspense } from "react"
import { redirect } from "next/navigation"

import { getSessionUser, homePathForSession } from "@/auth"

async function HomeRedirect() {
  const user = await getSessionUser()
  redirect(homePathForSession(user))
  return null
}

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <main className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
          Loading…
        </main>
      }
    >
      <HomeRedirect />
    </Suspense>
  )
}
