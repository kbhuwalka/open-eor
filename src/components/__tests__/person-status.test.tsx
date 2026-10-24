import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { PERSON_STATUSES } from "@/domain/person-status"

import { PersonStatusBadge } from "../person-status"

describe("PersonStatusBadge", () => {
  const tokens = ["info", "success", "neutral"] as const

  it("maps each person status to exactly one status token", () => {
    const used = PERSON_STATUSES.map((status) => {
      const html = renderToStaticMarkup(<PersonStatusBadge status={status} />)
      const matches = tokens.filter((token) => html.includes(`bg-status-${token} `))
      expect(matches).toHaveLength(1)
      return matches[0]
    })
    expect(used).toEqual(["info", "success", "neutral"])
  })
})
