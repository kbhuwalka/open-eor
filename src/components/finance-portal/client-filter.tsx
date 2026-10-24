"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"

import { OptionSelect, type Option } from "@/components/ui/option-select"

const ALL = "all"

export type ClientFilterProps = {
  companies: readonly { id: string; name: string }[]
  /** The selected company id, or `null` for every client. */
  value: string | null
  /** The page the filter belongs to (`/finance`). */
  path: string
  /** The page's other parameters (`bucket=1-30&size=50`), kept when the client changes; the page number is dropped. */
  current?: string
  testId: string
}

/**
 * A Finance page's one client filter (the Home's and Receivables'): all clients, or one. The choice
 * is `?client=<companyId>`, so it can be shared and survives a refresh; "All clients" removes it.
 * The page's other parameters stay and the page number goes back to the first.
 */
export function ClientFilter({ companies, value, path, current = "", testId }: ClientFilterProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const options: Option[] = [{ value: ALL, label: "All clients" }, ...companies.map((company) => ({ value: company.id, label: company.name }))]
  const hrefFor = (client: string | null) => {
    const params = new URLSearchParams(current)
    params.delete("page")
    if (client) params.set("client", client)
    else params.delete("client")
    const text = params.toString()
    return text ? `${path}?${text}` : path
  }
  return (
    <div className="w-52" aria-busy={pending} data-testid={`${testId}-box`}>
      <OptionSelect
        options={options}
        value={value ?? ALL}
        onValueChange={(next) => startTransition(() => router.push(hrefFor(next === ALL || next === "" ? null : next), { scroll: false }))}
        data-testid={testId}
      />
    </div>
  )
}
