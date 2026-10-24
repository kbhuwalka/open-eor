"use client"

import { I9Section1Wizard } from "@/components/tax-forms"
import { todayIso } from "@/domain/employment-term"
import type { EmployeeScreenData } from "@/lib/employee-screen-data"
import { previewI9Action, submitI9Action } from "@/app/worker/tasks/actions"

import { CompletedPanel } from "./completed-panel"
import { toPrepared, unwrap } from "./prepared-document"
import { EmployeeTaskFrame } from "./task-frame"
import { useTaskFlow } from "./use-task-flow"

type Data = Extract<EmployeeScreenData, { kind: "i9_section1" }>

/** Section 1 of the federal I-9: fills the official USCIS form and signs it. */
export function I9Screen({ data }: { data: Data }) {
  const flow = useTaskFlow()
  const { prefill } = data
  return (
    <EmployeeTaskFrame
      data={data}
      description="Federal law requires every new employee to confirm they may work in the US. This is Section 1 of the official Form I-9; Northwind completes Section 2 after reviewing your ID."
    >
      {data.completed ? (
        <CompletedPanel data={{ ...data, completed: data.completed }} />
      ) : (
        <I9Section1Wizard
          initial={{
            firstName: prefill.firstName,
            middleInitial: prefill.middleInitial,
            lastName: prefill.lastName,
            address: prefill.address?.line1 ?? "",
            aptNumber: prefill.address?.line2 ?? "",
            city: prefill.address?.city ?? "",
            state: prefill.address?.state ?? "",
            zip: prefill.address?.zip ?? "",
            email: prefill.email,
            phone: prefill.phone,
          }}
          today={todayIso(new Date(data.nowIso))}
          renderPreview={async (form) => toPrepared(await unwrap(previewI9Action(data.taskId, form)))}
          onSubmit={({ data: form, signature, fieldValues }) =>
            flow.settle(() => submitI9Action(data.taskId, form, { signature, fieldValues }))
          }
        />
      )}
    </EmployeeTaskFrame>
  )
}
