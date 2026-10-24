import { describe, expect, it } from "vitest"

import { expectDomainError } from "../../__tests__/expect-domain-error"
import { DEFAULT_WORKFLOW } from "../default-workflow"
import { DEFAULT_HANDLERS } from "../handlers"
import { assertValidTemplate, parseTemplate, validateTemplate } from "../template"
import type { TaskDefinition, WorkflowTemplate } from "../types"

const def = (key: string, extra: Partial<TaskDefinition> = {}): TaskDefinition => ({
  key,
  title: key,
  description: key,
  phase: "p",
  owner: "specialist",
  blocksGoLive: true,
  ...extra,
})

const base = (tasks: TaskDefinition[], extra: Partial<WorkflowTemplate> = {}): WorkflowTemplate => ({
  key: "t",
  version: 1,
  title: "t",
  phases: [{ id: "p", title: "P" }],
  tasks: [def("go", { owner: "system", blocksGoLive: false, trigger: "go_live" }), ...tasks],
  ...extra,
})

describe("default workflow", () => {
  it("is a valid template with a handler for every task type", () => {
    expect(validateTemplate(DEFAULT_WORKFLOW, { handlerTypes: Object.keys(DEFAULT_HANDLERS) })).toEqual([])
  })

  it("survives a JSON round trip through parseTemplate", () => {
    const { key, version, ...definition } = DEFAULT_WORKFLOW
    expect(parseTemplate({ key, version }, JSON.stringify(definition))).toEqual(DEFAULT_WORKFLOW)
  })
})

describe("validateTemplate", () => {
  it("accepts a minimal template", () => {
    expect(validateTemplate(base([def("a"), def("b", { dependsOn: ["a"] })]))).toEqual([])
  })

  it("reports duplicate keys, bad keys and bad versions", () => {
    const issues = validateTemplate(base([def("a"), def("a"), def("Bad Key")], { version: 0 }))
    expect(issues.join("\n")).toMatch(/duplicate task key "a"/)
    expect(issues.join("\n")).toMatch(/must match/)
    expect(issues.join("\n")).toMatch(/version/)
  })

  it("reports unknown dependencies and dependency cycles", () => {
    expect(validateTemplate(base([def("a", { dependsOn: ["nope"] })])).join()).toMatch(/unknown task "nope"/)
    const cycle = validateTemplate(base([def("a", { dependsOn: ["b"] }), def("b", { dependsOn: ["a"] })]))
    expect(cycle.join()).toMatch(/dependency cycle: a -> b -> a|dependency cycle: b -> a -> b/)
  })

  it("requires exactly one go_live trigger, which is non-blocking with no dependencies", () => {
    const none = base([def("a")])
    none.tasks = none.tasks.filter((task) => task.trigger !== "go_live")
    expect(validateTemplate(none).join()).toMatch(/exactly one go_live trigger/)
    const two = base([def("a", { owner: "system", blocksGoLive: false, trigger: "go_live" })])
    expect(validateTemplate(two).join()).toMatch(/found 2/)
    const bad = base([])
    bad.tasks[0] = { ...bad.tasks[0], blocksGoLive: true, dependsOn: ["x"] }
    expect(validateTemplate(bad).join()).toMatch(/go_live trigger must be/)
  })

  it("rejects dependencies on the trigger or on on_demand tasks", () => {
    const issues = validateTemplate(
      base([
        def("a", { dependsOn: ["go"] }),
        def("b", { rework: { spawn: ["fix"] } }),
        def("fix", { instantiate: "on_demand", dependsOn: [] }),
        def("c", { dependsOn: ["fix"] }),
      ]),
    )
    expect(issues.join("\n")).toMatch(/cannot depend on the go_live trigger/)
    expect(issues.join("\n")).toMatch(/cannot depend on the on_demand task "fix"/)
  })

  it("checks rework wiring", () => {
    expect(validateTemplate(base([def("fix", { instantiate: "on_demand" })])).join()).toMatch(
      /on_demand but no rework spawns it/,
    )
    expect(validateTemplate(base([def("a", { rework: { spawn: ["b"] } }), def("b")])).join()).toMatch(
      /must be on_demand/,
    )
    expect(validateTemplate(base([def("a", { rework: { spawn: ["zzz"] } })])).join()).toMatch(/unknown task "zzz"/)
    expect(
      validateTemplate(
        base([def("a", { owner: "system", rework: { spawn: ["f"] } }), def("f", { instantiate: "on_demand" })]),
      ).join(),
    ).toMatch(/system task cannot be rejected/)
  })

  it("checks phases, parties and system actors", () => {
    const issues = validateTemplate(
      base([
        def("a", { phase: "nope" }),
        def("b", { owner: "martian" as never }),
        def("c", { owner: "system", actors: ["client"] }),
      ]),
    )
    expect(issues.join("\n")).toMatch(/unknown phase "nope"/)
    expect(issues.join("\n")).toMatch(/unknown owner "martian"/)
    expect(issues.join("\n")).toMatch(/system task cannot have human actors/)
  })

  it("checks condition and context facts", () => {
    const issues = validateTemplate(
      base([
        def("a", { condition: { fact: "order.nothing", op: "set" } }),
        def("b", { condition: { fact: "result.a.value", op: "set" } }),
        def("c", { dependsOn: ["a"], condition: { fact: "result.a.value", op: "set" } }),
        def("d", { context: { x: { fact: "order.missing" } } }),
      ]),
    )
    expect(issues.join("\n")).toMatch(/unknown fact "order.nothing"/)
    expect(issues.join("\n")).toMatch(/task "b": condition reads "result.a.value" but "a" is not a dependency/)
    expect(issues.join("\n")).not.toMatch(/task "c"/)
    expect(issues.join("\n")).toMatch(/context reads unknown fact "order.missing"/)
  })

  it("rejects a due offset earlier than a dependency's", () => {
    const issues = validateTemplate(
      base([def("a", { due: { offsetDays: 0 } }), def("b", { dependsOn: ["a"], due: { offsetDays: -3 } })]),
    )
    expect(issues.join()).toMatch(/before its dependency "a"/)
  })

  it("reports task types with no handler when a registry is given", () => {
    const issues = validateTemplate(base([def("mystery")]), { handlerTypes: ["other"] })
    expect(issues.join("\n")).toMatch(/no handler registered for type "mystery"/)
  })

  it("throws INVALID_WORKFLOW_TEMPLATE with the issues", () => {
    const error = expectDomainError(
      () => assertValidTemplate(base([def("a", { dependsOn: ["nope"] })])),
      "INVALID_WORKFLOW_TEMPLATE",
    )
    expect(JSON.stringify(error.details)).toContain("nope")
    expectDomainError(() => parseTemplate({ key: "t", version: 1 }, "{"), "INVALID_WORKFLOW_TEMPLATE")
    expectDomainError(() => parseTemplate({ key: "t", version: 1 }, "{}"), "INVALID_WORKFLOW_TEMPLATE")
  })
})
