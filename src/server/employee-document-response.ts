import { AuthError, requireRole } from "@/auth"
import { getDb } from "@/db"

import { mimeForFileName } from "./employee-portal"
import { readEmployeeDocument } from "./employee-documents"

const NO_STORE = { "Cache-Control": "private, no-store" }

function problem(status: number, error: string, message: string) {
  return Response.json({ error, message }, { status, headers: NO_STORE })
}

const safeFileName = (name: string) => name.replace(/["\\\r\n]/g, "_")

/**
 * A signed document of the signed-in employee as an HTTP response, for the download (attachment)
 * and the in-browser view (inline) routes. Only the owner may read it (acl F5); the stored bytes
 * are checked against the hash and seals recorded at signing first, and a mismatch is a 409, never
 * the file. 401 without a session, 403 for another role, 404 for a document that is not theirs.
 */
export async function employeeDocumentResponse(documentId: string, disposition: "inline" | "attachment"): Promise<Response> {
  let user
  try {
    user = await requireRole("worker")
  } catch (error) {
    if (error instanceof AuthError) {
      const verb = disposition === "inline" ? "view" : "download"
      return error.code === "unauthenticated"
        ? problem(401, "unauthenticated", `Sign in to ${verb} documents.`)
        : problem(403, "forbidden", `Your role cannot ${verb} this document.`)
    }
    throw error
  }

  const result = await readEmployeeDocument(getDb(), user, documentId)
  if (!result.ok) {
    const status = result.reason === "forbidden" ? 403 : result.reason === "not_found" ? 404 : 409
    return problem(status, result.reason, result.message)
  }

  return new Response(Buffer.from(result.bytes), {
    headers: {
      ...NO_STORE,
      "Content-Type": mimeForFileName(result.fileName),
      "Content-Disposition": `${disposition}; filename="${safeFileName(result.fileName)}"`,
      "X-Content-Type-Options": "nosniff",
      "X-Document-SHA256": result.sha256,
    },
  })
}
