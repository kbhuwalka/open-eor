import { Suspense } from "react"
import { redirect } from "next/navigation"

import { getSessionUser, ROLE_HOME } from "@/auth"

async function HomeRedirect() {
  const user = await getSessionUser()
  if (user) {
    redirect(ROLE_HOME[user.role])
  }
  redirect("/pick")
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
