"use client"

import { CircleAlert } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

/** Anything unexpected on a Finance page: say so, offer a retry, never show a stack. */
export default function FinanceError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex max-w-xl flex-col gap-4" data-testid="finance-error">
      <Alert variant="destructive">
        <CircleAlert aria-hidden />
        <AlertTitle>This page could not be loaded</AlertTitle>
        <AlertDescription>Something went wrong while reading Finance data. Nothing was changed. Try again, and if it keeps happening tell engineering.</AlertDescription>
      </Alert>
      <Button variant="outline" className="w-fit" onClick={reset}>
        Try again
      </Button>
    </div>
  )
}
