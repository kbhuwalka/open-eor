"use client"

import { ArrowRight } from "lucide-react"
import { cn } from "cn"

import type { SignatureField } from "@/domain/forms"

import type { PdfPageSize } from "./pdf-loader"
import { signatureFont } from "./signature-font"
import { MIN_TAG_HEIGHT, fieldBox } from "./signing-utils"

type TagProps = {
  field: SignatureField
  page: PdfPageSize
  /** What the field holds once completed; `undefined` while unsigned. */
  value: string | undefined
  /** The field Start/Next last pointed at. */
  active: boolean
  /** True until the signer has consented to electronic records. */
  locked: boolean
  onActivate: (field: SignatureField) => void
}

/**
 * One tag on a page. Signature and initials tags are buttons: a yellow "Sign here" flag until
 * completed, then the typed name in the script face on the line (click to change it). Date tags are
 * read-only and fill themselves in when their signature is applied.
 */
export function SignatureTag({ field, page, value, active, locked, onActivate }: TagProps) {
  const signed = value !== undefined
  const box = fieldBox(field, page, field.kind === "date" ? 0 : MIN_TAG_HEIGHT)
  const placement = { left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, height: `${box.height}%` }

  if (field.kind === "date") {
    return (
      <div
        className={cn(
          "absolute flex items-end overflow-hidden px-[0.4em] pb-[0.1em] font-sans whitespace-nowrap text-signing-foreground",
          signed ? "" : "border border-dashed border-signing bg-signing/20"
        )}
        style={{ ...placement, fontSize: `${Math.min(box.heightCqw * 0.62, 2.1)}cqw` }}
        data-testid="signature-tag"
        data-field-id={field.id}
        data-kind="date"
        data-state={signed ? "signed" : "unsigned"}
        role="img"
        aria-label={signed ? `${field.label}: ${value}` : `${field.label}: fills in when you sign`}
      >
        {signed ? value : <span className="opacity-70">{field.label}</span>}
      </div>
    )
  }

  const noun = field.kind === "initials" ? "initials" : "signature"
  const description = signed
    ? `${field.label}, signed as ${value}. Press Enter to change your ${noun}.`
    : `${field.label}${field.required ? ", required" : ", optional"}, not signed. Press Enter to sign.`

  return (
    <button
      type="button"
      className={cn(
        "absolute flex items-end overflow-hidden text-left outline-none focus-visible:ring-3 focus-visible:ring-ring",
        signed
          ? "cursor-pointer rounded-sm px-[0.4%] text-signing-foreground hover:bg-signing/25"
          : "cursor-pointer rounded-sm border-2 border-signing bg-signing/30 hover:bg-signing/50",
        active && !signed ? "ring-3 ring-ring" : "",
        locked && !signed ? "opacity-70" : ""
      )}
      style={placement}
      onClick={() => onActivate(field)}
      aria-label={description}
      data-testid="signature-tag"
      data-field-id={field.id}
      data-kind={field.kind}
      data-state={signed ? "signed" : "unsigned"}
      data-active={active || undefined}
    >
      {signed ? (
        <span
          className={cn(signatureFont.className, "block max-w-full truncate leading-none")}
          style={{ fontSize: `${Math.min(box.heightCqw * 0.8, 3.4)}cqw` }}
        >
          {value}
        </span>
      ) : (
        <span
          className="flex h-full items-center gap-[0.35em] bg-signing px-[0.6em] font-sans font-semibold whitespace-nowrap text-signing-foreground"
          style={{ fontSize: `${Math.min(box.heightCqw * 0.5, 1.7)}cqw` }}
        >
          <ArrowRight className="size-[1.1em] shrink-0" aria-hidden />
          {field.kind === "initials" ? "Initial here" : "Sign here"}
        </span>
      )}
    </button>
  )
}
