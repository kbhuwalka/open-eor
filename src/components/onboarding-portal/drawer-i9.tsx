"use client"

import { useState } from "react"
import { TriangleAlert } from "lucide-react"

import { acceptSection2Action, prepareSection2Action } from "@/app/onboarding/actions"
import { SigningDialog } from "@/components/signing"
import { SummaryCard, SummaryRow } from "@/components/summary-card"
import { signerFrom } from "@/components/tax-forms/wizard"
import { Button } from "@/components/ui/button"
import { SSN_CARD_TITLE } from "@/domain/forms"
import { formatDay } from "@/lib/format"
import { LIST_LABEL, REJECT_CODE_LABEL, type ReviewedDocumentView } from "@/lib/onboarding-portal/i9-review"
import { rejectTaskAction } from "@/server/task-actions"
import type { I9ReviewData } from "@/server/onboarding-portal/i9-review"

import { DocumentViewer } from "./document-viewer"
import { DoneNote, PanelActions, PanelBody, PanelError, WaitingNote, type DrawerAct } from "./drawer-parts"
import { I9RejectForm } from "./i9-reject-form"
import { useSection2Signing } from "./use-section2-signing"

const onDay = (iso: string, now: Date) => formatDay(new Date(`${iso}T00:00:00`), now)

function DocumentDetails({ doc, today, now }: { doc: ReviewedDocumentView; today: string; now: Date }) {
  if (!doc.details) return null
  const { title, issuingAuthority, number, expiresOn } = doc.details
  const list = doc.kind === "list_a" || doc.kind === "list_b" || doc.kind === "list_c" ? LIST_LABEL[doc.kind] : null
  const ending = /[*•]/.test(number) ? number.replace(/\D/g, "") : ""
  const spoken = ending ? `${title === SSN_CARD_TITLE ? "Social Security number" : "Document number"} ending in ${ending}` : undefined
  return (
    <SummaryCard data-testid={`document-details-${doc.kind}`}>
      <SummaryRow label={<span className="font-medium">{title}</span>}>
        <span className="text-muted-foreground">{list}</span>
      </SummaryRow>
      <SummaryRow label="Issued by">{issuingAuthority}</SummaryRow>
      <SummaryRow label="Document number">
        <span className="font-mono" data-testid="document-number" aria-label={spoken} role={spoken ? "img" : undefined}>
          {number}
        </span>
      </SummaryRow>
      <SummaryRow label="Expires">
        {expiresOn === null ? (
          "No expiration date"
        ) : expiresOn < today ? (
          <span className="text-status-danger-foreground">Expired {onDay(expiresOn, now)}</span>
        ) : (
          onDay(expiresOn, now)
        )}
      </SummaryRow>
    </SummaryCard>
  )
}

/**
 * "Verify I-9 Section 2" in the drawer: the uploads, what the employee entered about each one (read
 * only), and the Section 1 facts they are compared with. "Verify & sign" fills Section 2 from the
 * employee's entries on the server and opens the signature step; "Send back" names the problem
 * documents. The specialist never edits the employee's entries: a wrong entry goes back to them.
 */
export function I9Panel({
  data,
  nowIso,
  status,
  waitingOn,
  act,
}: {
  data: I9ReviewData
  nowIso: string
  status: string
  waitingOn: string
  act: DrawerAct
}) {
  const [sendingBack, setSendingBack] = useState(false)
  const signing = useSection2Signing({
    taskId: data.taskId,
    prepare: prepareSection2Action,
    accept: acceptSection2Action,
    onSigned: () => act.finish("Section 2 verified"),
  })
  const now = new Date(nowIso)
  const first = data.person.split(" ")[0]
  const open = data.canAct && !data.done
  const lastRejection = data.history[0]
  const undescribed = data.documents.filter((doc) => doc.details === null).length

  return (
    <>
      <PanelBody>
        <PanelError error={sendingBack ? null : signing.error} />
        {open && sendingBack ? (
          <I9RejectForm
            documents={data.documents}
            pending={act.pending}
            error={act.error}
            onSubmit={(reason) => act.run(() => rejectTaskAction(data.taskId, reason), `Sent back to ${first}`)}
            onCancel={() => setSendingBack(false)}
          />
        ) : null}

        <DocumentViewer documents={data.documents} nowIso={nowIso} compact />
        {data.documents.map((doc) => (
          <DocumentDetails key={doc.id} doc={doc} today={data.today} now={now} />
        ))}

        {data.readiness === "invalid_combo" ? (
          <p role="note" className="flex items-start gap-2 text-sm text-status-danger-foreground" data-testid="combo-warning">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            These uploads are not an acceptable combination: one List A document, or one List B and one List C.
          </p>
        ) : null}
        {undescribed > 0 && !data.done ? (
          <p role="note" className="text-sm text-muted-foreground" data-testid="missing-details">
            {first} uploaded {undescribed === 1 ? "a document" : "these documents"} without the document number and
            expiration date, so send {undescribed === 1 ? "it" : "them"} back to be uploaded again.
          </p>
        ) : null}

        <SummaryCard data-testid="employee-details">
          <SummaryRow label="Name on Section 1">{data.section1.legalName ?? "Not provided"}</SummaryRow>
          <SummaryRow label="Attested status">{data.section1.citizenship ?? "Not completed"}</SummaryRow>
          {data.section1.workAuthExpiresOn ? (
            <SummaryRow label="Work authorization expires">{onDay(data.section1.workAuthExpiresOn, now)}</SummaryRow>
          ) : null}
        </SummaryCard>

        {lastRejection ? (
          <p className="text-xs text-muted-foreground" data-testid="rejection-history">
            Sent back before: {REJECT_CODE_LABEL[lastRejection.code]}
            {lastRejection.note ? `. ${lastRejection.note}` : ""}
            {data.history.length > 1 ? ` (${data.history.length} times in all)` : ""}
          </p>
        ) : null}

        {data.done ? (
          <DoneNote testId="i9-verified">
            Section 2 is complete{data.verifiedAs ? `: ${data.verifiedAs.title} (${data.verifiedAs.authority})` : ""}.
          </DoneNote>
        ) : null}
        {!open && !data.done ? (
          <WaitingNote>{status === "blocked" ? `This step opens once ${first} has uploaded their documents.` : `Waiting on ${waitingOn}.`}</WaitingNote>
        ) : null}
      </PanelBody>

      {open ? (
        <PanelActions>
          {data.rejectable ? (
            <Button
              variant="outline"
              aria-expanded={sendingBack}
              disabled={act.pending}
              onClick={() => setSendingBack((value) => !value)}
              data-testid="open-send-back"
            >
              Send back
            </Button>
          ) : null}
          {data.readiness === "ready" ? (
            <Button disabled={signing.preparing || act.pending} onClick={signing.start} data-testid="verify-and-sign">
              {signing.preparing ? "Preparing…" : "Verify & sign"}
            </Button>
          ) : null}
        </PanelActions>
      ) : null}

      {signing.prepared ? (
        <SigningDialog
          open={signing.open}
          onOpenChange={signing.setOpen}
          title={signing.prepared.title}
          document={signing.prepared.document}
          fields={signing.prepared.fields}
          signer={signerFrom(signing.prepared.signer.name, signing.prepared.signer.role)}
          onComplete={signing.sign}
        />
      ) : null}
    </>
  )
}
