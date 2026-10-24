import Link from "next/link"
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"

/** "Start a hire": the client Home's and the People page's header action, and the People empty state's. */
export function StartHireButton({ variant = "default" }: { variant?: "default" | "outline" }) {
  return (
    <Button
      variant={variant}
      render={<Link href="/client/people/new" />}
      nativeButton={false}
      data-testid="start-hire"
    >
      <Plus data-icon="inline-start" />
      Start a hire
    </Button>
  )
}
