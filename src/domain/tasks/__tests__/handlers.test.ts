import { describe, expect, it } from "vitest"

import { expectDomainError } from "../../__tests__/expect-domain-error"
import { todayIso } from "../../employment-term"
import { DEFAULT_WORKFLOW } from "../default-workflow"
import { DEFAULT_HANDLERS } from "../handlers"
import { createRng } from "../rng"
import { samplePayload } from "../sample-data"
import { taskTypeOf } from "../template"
import type { DocumentRef, Task, TaskActor } from "../types"
import { ACTORS, NOW } from "./helpers"

const fakeTask = (type: string): Task => ({ type, context: {} }) as unknown as Task
const env = (documents: DocumentRef[]) => ({ documents })
const parse = (type: string, raw: unknown, actor: TaskActor | null = ACTORS.worker, docs: DocumentRef[] = []) =>
  DEFAULT_HANDLERS[type].parse(raw, { task: fakeTask(type), actor, env: env(docs) })

describe("handler registry", () => {
  it("has a handler for every task type the default workflow can create", () => {
    for (const def of DEFAULT_WORKFLOW.tasks) {
      if (def.trigger) continue
      expect(DEFAULT_HANDLERS[taskTypeOf(def)], def.key).toBeDefined()
    }
  })

  it("accepts a generated sample payload for every type, for every actor that can complete it", () => {
    const docs: DocumentRef[] = [
      { id: "a", kind: "list_a", createdAt: 1 },
      { id: "b", kind: "list_b", createdAt: 1 },
      { id: "c", kind: "list_c", createdAt: 1 },
    ]
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const rng = createRng(seed)
      for (const type of Object.keys(DEFAULT_HANDLERS)) {
        for (const actor of Object.values(ACTORS)) {
          const payload = samplePayload(fakeTask(type), { rng, actor, env: env(docs), today: todayIso(NOW) })
          if (type === "pay_deposit" && actor.role !== "client_hr" && (payload as { resolution: string }).resolution === "paid") continue
          expect(() => parse(type, payload, actor, docs), `${type} ${seed}`).not.toThrow()
        }
      }
    }
  })

  it("rejects obviously bad payloads for every type", () => {
    for (const type of Object.keys(DEFAULT_HANDLERS)) {
      if (type === "generate_agreement" || type === "invite_worker") continue
      expect(() => parse(type, "not an object"), type).toThrow()
    }
  })
})

describe("payload validation", () => {
  const goodPersonal = samplePayload(fakeTask("personal_details"), {
    rng: createRng(1),
    actor: ACTORS.worker,
    env: env([]),
    today: todayIso(NOW),
  }) as Record<string, unknown>

  it("rejects malformed personal details", () => {
    expect(() => parse("personal_details", goodPersonal)).not.toThrow()
    expectDomainError(() => parse("personal_details", { ...goodPersonal, ssn: "123" }), "INVALID_TASK_PAYLOAD")
    expectDomainError(() => parse("personal_details", { ...goodPersonal, phone: "x" }), "INVALID_TASK_PAYLOAD")
    expectDomainError(() => parse("personal_details", { ...goodPersonal, dateOfBirth: "tomorrow" }), "INVALID_TASK_PAYLOAD")
    expectDomainError(
      () => parse("personal_details", { ...goodPersonal, address: { line1: "1 Main", city: "X", state: "Texas", zip: "1" } }),
      "INVALID_TASK_PAYLOAD",
    )
  })

  it("keeps sensitive values out of the stored form data and the task result", () => {
    const task = fakeTask("personal_details")
    const payload = parse("personal_details", goodPersonal)
    const out = DEFAULT_HANDLERS.personal_details.complete({ task, payload, actor: ACTORS.worker, now: NOW, facts: {} })
    expect(JSON.stringify(out.result)).not.toContain(String(goodPersonal.ssn))
    const effect = out.effects![0]
    expect(effect.type).toBe("store_form")
    if (effect.type === "store_form") {
      expect(JSON.stringify(effect.data)).not.toContain(String(goodPersonal.ssn))
      expect(effect.sensitive).toMatchObject({ ssn: goodPersonal.ssn })
    }
  })

  it("keeps only the last four digits of the bank account outside the sensitive blob", () => {
    const payload = parse("direct_deposit", {
      accountHolderName: "Alex Sample",
      routingNumber: "021000021",
      accountNumber: "123456789012",
      accountType: "checking",
    })
    const out = DEFAULT_HANDLERS.direct_deposit.complete({
      task: fakeTask("direct_deposit"),
      payload,
      actor: ACTORS.worker,
      now: NOW,
      facts: {},
    })
    expect(out.result).toEqual({ last4: "9012" })
    expect(JSON.stringify(out.effects)).toContain("123456789012")
    const effect = out.effects![0]
    if (effect.type === "store_form") expect(JSON.stringify(effect.data)).not.toContain("123456789012")
  })

  it("requires an expiry date for authorized aliens on I-9 section 1", () => {
    expect(() => parse("i9_section1", { citizenshipStatus: "citizen" })).not.toThrow()
    expectDomainError(() => parse("i9_section1", { citizenshipStatus: "alien_authorized" }), "INVALID_TASK_PAYLOAD")
    expect(() =>
      parse("i9_section1", { citizenshipStatus: "alien_authorized", workAuthExpiresOn: "2030-01-01" }),
    ).not.toThrow()
  })

  it("accepts documents only from this person and only valid list combinations", () => {
    const docs: DocumentRef[] = [
      { id: "a", kind: "list_a", createdAt: 1 },
      { id: "b", kind: "list_b", createdAt: 1 },
      { id: "c", kind: "list_c", createdAt: 1 },
    ]
    expect(() => parse("upload_documents", { documentIds: ["a"] }, ACTORS.worker, docs)).not.toThrow()
    expect(() => parse("upload_documents", { documentIds: ["b", "c"] }, ACTORS.worker, docs)).not.toThrow()
    expectDomainError(() => parse("upload_documents", { documentIds: ["b"] }, ACTORS.worker, docs), "INVALID_LIST_COMBO")
    expectDomainError(() => parse("upload_documents", { documentIds: ["a", "b"] }, ACTORS.worker, docs), "INVALID_LIST_COMBO")
    expectDomainError(() => parse("upload_documents", { documentIds: ["zzz"] }, ACTORS.worker, docs), "INVALID_TASK_PAYLOAD")
    expectDomainError(() => parse("upload_documents", { documentIds: [] }, ACTORS.worker, docs), "INVALID_TASK_PAYLOAD")
  })

  it("requires the typed name to sign and an explicit acceptance to accept", () => {
    expectDomainError(() => parse("sign_agreement", {}), "INVALID_TASK_PAYLOAD")
    expectDomainError(() => parse("accept_agreement", { accepted: false }, ACTORS.client), "INVALID_TASK_PAYLOAD")
    expect(() => parse("accept_agreement", { accepted: true }, ACTORS.client)).not.toThrow()
  })
})
