"use client"

import { DirectDepositForm } from "@/components/tax-forms"
import type { EmployeeScreenData } from "@/lib/employee-screen-data"
import { previewDirectDepositAction, submitDirectDepositAction } from "@/app/worker/tasks/actions"

import { CompletedPanel } from "./completed-panel"
import { toPrepared, unwrap } from "./prepared-document"
import { EmployeeTaskFrame } from "./task-frame"
import { useTaskFlow } from "./use-task-flow"

type Data = Extract<EmployeeScreenData, { kind: "direct_deposit" }>

/** Where your net pay is deposited: one account, your whole net pay. The account number is stored encrypted and shown as ••••1234. */
export function DirectDepositScreen({ data }: { data: Data }) {
  const flow = useTaskFlow()
  return (
    <EmployeeTaskFrame
      data={data}
      description="Your pay arrives by direct deposit, every two weeks. Add the account you want it paid into."
    >
      {data.completed ? (
        <CompletedPanel data={{ ...data, completed: data.completed }} />
      ) : (
        <DirectDepositForm
          allowSplit={false}
          initial={{ accountHolderName: data.holderName }}
          signerName={data.holderName}
          renderPreview={async (form) => toPrepared(await unwrap(previewDirectDepositAction(data.taskId, form)))}
          onSubmit={({ data: form, signature, fieldValues }) =>
            flow.settle(() => submitDirectDepositAction(data.taskId, form, { signature, fieldValues }))
          }
        />
      )}
    </EmployeeTaskFrame>
  )
}
