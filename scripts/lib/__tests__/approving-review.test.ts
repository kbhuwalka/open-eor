import { describe, expect, it } from "vitest"
import {
  approvingReviewOnHead,
  latestDecisiveReviewOnHead,
} from "../approving-review.mjs"

const HEAD = "bbb"
const OLD = "aaa"

function review(
  state: string,
  oid: string,
  submittedAt: string,
  login = "cursor",
) {
  return {
    state,
    submittedAt,
    author: { login },
    commit: { oid },
  }
}

describe("approvingReviewOnHead", () => {
  it("rejects when there are no reviews", () => {
    expect(approvingReviewOnHead([], HEAD)).toEqual({
      ok: false,
      state: "NONE",
      author: "",
    })
  })

  it("ignores COMMENTED and DISMISSED", () => {
    const reviews = [
      review("COMMENTED", HEAD, "2026-01-01T00:00:00Z"),
      review("DISMISSED", HEAD, "2026-01-02T00:00:00Z"),
    ]
    expect(approvingReviewOnHead(reviews, HEAD).ok).toBe(false)
    expect(latestDecisiveReviewOnHead(reviews, HEAD)).toBeNull()
  })

  it("rejects APPROVED on a stale SHA when head has moved", () => {
    const reviews = [review("APPROVED", OLD, "2026-01-01T00:00:00Z")]
    expect(approvingReviewOnHead(reviews, HEAD)).toEqual({
      ok: false,
      state: "NONE",
      author: "",
    })
  })

  it("accepts APPROVED on the current head", () => {
    const reviews = [review("APPROVED", HEAD, "2026-01-01T00:00:00Z", "alice")]
    expect(approvingReviewOnHead(reviews, HEAD)).toEqual({
      ok: true,
      state: "APPROVED",
      author: "alice",
    })
  })

  it("prefers later CHANGES_REQUESTED on head over earlier APPROVED on head", () => {
    const reviews = [
      review("APPROVED", HEAD, "2026-01-01T00:00:00Z"),
      review("CHANGES_REQUESTED", HEAD, "2026-01-02T00:00:00Z"),
    ]
    expect(approvingReviewOnHead(reviews, HEAD)).toEqual({
      ok: false,
      state: "CHANGES_REQUESTED",
      author: "cursor",
    })
  })

  it("prefers later APPROVED on head over earlier CHANGES_REQUESTED on head", () => {
    const reviews = [
      review("CHANGES_REQUESTED", HEAD, "2026-01-01T00:00:00Z"),
      review("APPROVED", HEAD, "2026-01-02T00:00:00Z"),
    ]
    expect(approvingReviewOnHead(reviews, HEAD).ok).toBe(true)
  })

  it("ignores APPROVED on old SHA even when it is the chronologically latest", () => {
    const reviews = [
      review("CHANGES_REQUESTED", HEAD, "2026-01-01T00:00:00Z"),
      review("APPROVED", OLD, "2026-01-03T00:00:00Z"),
    ]
    expect(approvingReviewOnHead(reviews, HEAD)).toEqual({
      ok: false,
      state: "CHANGES_REQUESTED",
      author: "cursor",
    })
  })
})
