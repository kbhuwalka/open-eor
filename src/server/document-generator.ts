/**
 * The seam for producing documents (tasks-and-workflow.md §10). The default generator only
 * records metadata; a real one can render a PDF, store it and return its path without any change
 * to the engine or the `generate_document` effect.
 */
import type { Facts, JsonRecord } from "@/domain/tasks"

export type DocumentGenerationInput = {
  kind: string
  caseId: string
  taskId: string
  facts: Facts
  now: Date
}

export type GeneratedDocumentRecord = {
  fileName: string
  /** Null while nothing is stored. */
  storagePath: string | null
  metadata: JsonRecord
}

export interface DocumentGenerator {
  generate(input: DocumentGenerationInput): GeneratedDocumentRecord
}

export const placeholderDocumentGenerator: DocumentGenerator = {
  generate({ kind, facts, now }) {
    const worker = typeof facts["order.workerName"] === "string" ? facts["order.workerName"] : "worker"
    const slug = worker.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "worker"
    return {
      fileName: `${kind.replace(/_/g, "-")}-${slug}.pdf`,
      storagePath: null,
      metadata: {
        generator: "placeholder",
        generatedAt: now.toISOString(),
        startDate: typeof facts["order.startDate"] === "string" ? facts["order.startDate"] : null,
        stateCode: typeof facts["order.stateCode"] === "string" ? facts["order.stateCode"] : null,
      },
    }
  },
}
