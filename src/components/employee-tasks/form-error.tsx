"use client"

import { useEffect, useRef } from "react"
import { CircleAlert } from "lucide-react"

/**
 * The error summary of a form (ui-guidelines C36, A3): what went wrong in words, with each field's
 * message listed, announced with `role="alert"` and focused when it mounts. Give it `key={error.seq}`
 * so every new failure mounts it again and keyboard and screen reader users land on it.
 */
export function FormError({
  message,
  fields,
  labels = {},
}: {
  message: string | null
  fields?: Record<string, string>
  labels?: Record<string, string>
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  if (!message) return null
  const entries = Object.entries(fields ?? {})
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      data-testid="form-error"
    >
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="flex flex-col gap-1">
        <span className="font-medium">{message}</span>
        {entries.length > 0 ? (
          <ul className="list-disc pl-4 text-xs">
            {entries.map(([key, text]) => (
              <li key={key}>
                {labels[key] ? `${labels[key]}: ` : ""}
                {text}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
}
