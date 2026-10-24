"use client"

import { W4Wizard } from "@/components/tax-forms"
import type { EmployeeScreenData } from "@/lib/employee-screen-data"
import { previewW4Action, submitW4Action } from "@/app/worker/tasks/actions"

import { CompletedPanel } from "./completed-panel"
import { toPrepared, unwrap } from "./prepared-document"
import { EmployeeTaskFrame } from "./task-frame"
import { useTaskFlow } from "./use-task-flow"

type Data = Extract<EmployeeScreenData, { kind: "w4" }>

/** The federal W-4 (state withholding is not part of this form); fills the official IRS PDF and signs it. */
export function W4Screen({ data }: { data: Data }) {
  const flow = useTaskFlow()
  const { prefill } = data
  return (
    <EmployeeTaskFrame
      data={data}
      description="Tells Northwind how much federal income tax to withhold from your pay. Answer for your own situation; you can change it later."
    >
      {data.completed ? (
        <CompletedPanel data={{ ...data, completed: data.completed }} />
      ) : (
        <W4Wizard
          initial={{
            firstName: prefill.firstName,
            middleInitial: prefill.middleInitial,
            lastName: prefill.lastName,
            address: prefill.address?.line1 ?? "",
            city: prefill.address?.city ?? "",
            state: prefill.address?.state ?? "",
            zip: prefill.address?.zip ?? "",
          }}
          renderPreview={async (form) => toPrepared(await unwrap(previewW4Action(data.taskId, form)))}
          onSubmit={({ data: form, signature, fieldValues }) =>
            flow.settle(() => submitW4Action(data.taskId, form, { signature, fieldValues }))
          }
        />
      )}
    </EmployeeTaskFrame>
  )
}
